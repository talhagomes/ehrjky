// Оркестрация массовых апелляций в сервис-воркере: сканирование, загрузка вложенных объявлений,
// пачечная отправка с ограничением параллелизма, проверка результата и локальная история.
import { HubError, requireAdsTab, runInPage } from '../lib/page.js';
import { getSettings, log, withLock } from '../lib/storage.js';
import {
  key, normalize, latestJob, blocked, syncAppeals, applyCurrentAppeal, verifySubmission,
  expireStale, pruneJobs, summarize, runPool
} from './core.js';
import { sendAppealInPage, resolveAdsInPage } from './page-scripts.js';

const STORE = 'appeals';
const BATCH_KEY = 'tth:appeals:batch';
const VERIFIABLE = ['submitted', 'submitted_manual', 'accepted', 'unknown'];

let cancelRequested = false;
let batchRunning = false;

const readState = async () => {
  const stored = (await chrome.storage.local.get(STORE))[STORE];
  return Array.isArray(stored?.jobs) ? stored : { jobs: [] };
};

const mutate = (fn) => withLock('tth-appeals', async () => {
  const state = await readState();
  const result = await fn(state);
  await chrome.storage.local.set({ [STORE]: pruneJobs(state) });
  return result;
});

function annotate(rows, state, account) {
  return rows.map((row) => {
    const job = latestJob(state, account, row);
    const isBlocked = blocked(state, account, row);
    let note = '';
    if (isBlocked) note = job.status === 'limited' ? (job.message || 'Лимит апелляций TikTok') : 'Апелляция отправлена или ожидает подтверждения';
    else if (job?.serverStatus === 'rejected') note = 'Апелляция отклонена — можно подать повторно';
    return { ...row, blocked: isBlocked, jobStatus: job?.status ?? null, note };
  });
}

async function statusRequest(tabId, account, rows) {
  const result = await runInPage(tabId, resolveAdsInPage, [account, rows.map(({ id, level }) => ({ id, level })), true]);
  if (result?.error) throw new HubError(result.error);
  if (result?.account !== account) throw new HubError('Кабинет изменился.');
  return result.rows;
}

export async function scan(tabId) {
  await requireAdsTab(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/scanner.js'] });
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__tthScanAppeals() });
  const data = frame?.result;
  if (!data?.account) throw new HubError('Откройте рекламный кабинет TikTok (в адресе должен быть aadvid).');
  const { account, pageLevel } = data;
  const rows = pageLevel === 'campaign' ? [] : normalize(data.rows).filter((r) => r.level !== 'campaign');

  let warning = '';
  const saved = await readState();
  const toVerify = rows.filter((row) => row.level === 'ad' && VERIFIABLE.includes(latestJob(saved, account, row)?.status));
  let statuses = [];
  if (toVerify.length) {
    try { statuses = await statusRequest(tabId, account, toVerify); } catch (e) { warning = 'Не удалось проверить статус в TikTok: ' + e.message; }
  }
  await mutate((state) => {
    expireStale(state);
    for (const status of statuses) {
      const row = toVerify.find((r) => r.id === status.id);
      if (!row) continue;
      const job = latestJob(state, account, row);
      if (!VERIFIABLE.includes(job?.status)) continue;
      row.appealVersion = status.appealVersion;
      if (Number(status.appealStatus) === 4) applyCurrentAppeal(job, status);
      else if (/appeal.{0,20}(pending|review|progress)|under.review/i.test(status.evidence)) { job.sawPending = true; job.serverStatus = 'pending'; }
      else if (/appeal[ _-]*(reject|fail)|апелляци.{0,20}отклон/i.test(status.evidence)) {
        job.previousStatus = job.status; job.status = 'retry_allowed'; job.serverStatus = 'rejected'; job.retryAllowedAt = new Date().toISOString();
      } else if (Number.isFinite(Number(status.appealStatus))) {
        // Есть запись апелляции с неотказным кодом — апелляция в работе; блокировка повтора сохраняется.
        job.serverStatus = 'in_progress';
        job.lastServerStatus = status;
      } else { job.serverStatus = 'unrecognized'; warning = 'Не все статусы апелляций удалось определить по ответу TikTok — такие объявления пока заблокированы.'; }
    }
    syncAppeals(state, account, [], data.observations);
  });
  const state = await readState();
  return {
    account, pageLevel, warning,
    unresolved: data.unresolved?.length ?? 0,
    rows: annotate(rows, state, account)
  };
}

// Для выбранных адсетов подгружаем вложенные объявления с проблемами проверки.
export async function resolveNested(tabId, account, rows) {
  await requireAdsTab(tabId);
  const list = Array.isArray(rows) ? rows : [];
  const ads = normalize(list.filter((r) => r.level === 'ad'));
  const parents = list.filter((r) => r.level !== 'ad').map(({ id, level }) => ({ id, level }));
  let resolved = [];
  if (parents.length) {
    const result = await runInPage(tabId, resolveAdsInPage, [account, parents]);
    if (result?.error) throw new HubError(result.error);
    if (result?.account !== account) throw new HubError('Кабинет изменился.');
    resolved = normalize(result.rows);
  }
  const merged = new Map();
  for (const row of [...ads, ...resolved]) merged.set(row.id, row);
  return annotate([...merged.values()], await readState(), account);
}

async function writeBatch(patch) {
  const current = (await chrome.storage.session.get(BATCH_KEY))[BATCH_KEY] ?? {};
  const next = { ...current, ...patch };
  await chrome.storage.session.set({ [BATCH_KEY]: next });
  return next;
}

export async function getBatch() {
  const batch = (await chrome.storage.session.get(BATCH_KEY))[BATCH_KEY] ?? null;
  // «running» без живого исполнителя: сервис-воркер перезапустился посреди пачки — не оставляем окно висеть.
  if (batch?.state === 'running' && !batchRunning) {
    await mutate((state) => {
      for (const job of state.jobs) {
        if (job.status === 'sending' && Date.parse(job.created) >= (batch.startedAt ?? 0) - 1000) {
          job.status = 'unknown';
          job.message = 'Отправка была прервана. Проверьте статус апелляции в TikTok.';
        }
      }
    });
    return writeBatch({
      state: 'error', phase: 'done', finishedAt: Date.now(),
      error: 'Отправка прервана: фоновый процесс был перезапущен. Незавершённые записи помечены как «не подтверждено» — проверьте их в TikTok.'
    });
  }
  return batch;
}

export async function cancelBatch() {
  cancelRequested = true;
  await writeBatch({ cancelRequested: true });
  return { ok: true };
}

async function sendOne(tabId, account, row, text, reason) {
  let job;
  await mutate((state) => {
    if (blocked(state, account, row)) return;
    job = {
      ...row, key: key(account, row), account, jobId: crypto.randomUUID(), status: 'sending',
      sentFromRejected: /appeal[ _-]*reject/i.test(row.reason || ''), text: text.slice(0, 400), appealReason: reason,
      created: new Date().toISOString()
    };
    state.jobs.push(job);
  });
  if (!job) return { id: row.id, name: row.name, status: 'skipped', message: 'Повтор заблокирован' };
  let outcome = { status: 'unknown', message: 'Ответ не получен. Повтор заблокирован: проверьте апелляцию в TikTok.' };
  try {
    const reply = await runInPage(tabId, sendAppealInPage, [account, row, text, reason]);
    if (reply) outcome = reply;
  } catch {
    // Вкладка закрыта или перезагружена: результат не подтверждён, продолжать пачку нельзя.
    outcome = { status: 'unknown', stop: true, message: 'Связь со вкладкой TikTok потеряна. Проверьте статус апелляции в TikTok перед повтором.' };
  }
  const { stop, ...persisted } = outcome;
  await mutate((state) => {
    const saved = state.jobs.find((j) => j.jobId === job.jobId);
    if (saved) Object.assign(saved, persisted, { updated: new Date().toISOString() });
  });
  return { id: row.id, name: row.name, jobId: job.jobId, ...persisted, stop };
}

async function runBatch(tabId, account, rows, text, reason, batchId) {
  let stopAll = false;
  let completed = 0;
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
  try {
    const settings = await getSettings();
    const raw = await runPool(rows, settings.appeals.concurrency, async (row) => {
      const result = await sendOne(tabId, account, row, text, reason);
      if (result.stop) stopAll = true;
      completed++;
      await writeBatch({ completed, last: { id: row.id, status: result.status } });
      return result;
    }, () => cancelRequested || stopAll);

    const results = Array.from(raw, (r, i) => r ?? {
      id: rows[i].id, name: rows[i].name, status: 'skipped',
      message: stopAll ? 'Остановлено: проблема с сессией или кабинетом' : 'Остановлено пользователем'
    });

    const accepted = results.filter((r) => r.status === 'accepted');
    if (accepted.length) {
      await writeBatch({ phase: 'verifying' });
      let statuses = [];
      try { statuses = await statusRequest(tabId, account, accepted.map((r) => rows.find((x) => x.id === r.id))); } catch { /* останется «не подтверждено» */ }
      await mutate((state) => {
        for (const result of accepted) {
          const job = state.jobs.find((j) => j.jobId === result.jobId);
          if (!job) continue;
          const outcome = verifySubmission(job, statuses.find((s) => s.id === result.id));
          Object.assign(job, outcome, { lastServerStatus: statuses.find((s) => s.id === result.id), updated: new Date().toISOString() });
          Object.assign(result, outcome);
        }
      });
    }
    const summary = summarize(results);
    await writeBatch({
      state: cancelRequested ? 'cancelled' : 'done', phase: 'done', finishedAt: Date.now(), completed,
      counts: summary.counts, problems: summary.problems,
      results: results.slice(0, 500).map(({ id, name, status, message }) => ({ id, name, status, message }))
    });
    log(summary.counts.failed || summary.counts.unknown ? 'warn' : 'info', 'appeals',
      `Апелляции: отправлено ${summary.counts.submitted}, лимит ${summary.counts.limited}, отказ ${summary.counts.retry_allowed}, ошибок ${summary.counts.failed}, не подтверждено ${summary.counts.unknown}, пропущено ${summary.counts.skipped}`);
  } catch (e) {
    await writeBatch({ state: 'error', phase: 'done', finishedAt: Date.now(), error: e.message });
    log('error', 'appeals', 'Сбой пачки апелляций: ' + e.message);
  } finally {
    clearInterval(keepAlive);
    batchRunning = false;
  }
}

export async function startBatch({ tabId, account, rows, text, reason }) {
  if (batchRunning) throw new HubError('Отправка уже идёт. Дождитесь завершения.');
  const { info } = await requireAdsTab(tabId);
  if (info.account !== account) throw new HubError('Кабинет на вкладке изменился. Обновите список.');
  const cleanText = String(text ?? '').trim();
  if (!cleanText || cleanText.length > 2000) throw new HubError('Введите текст апелляции (до 2000 символов).');
  if (![1, 2, 3, 4, 5].includes(reason)) throw new HubError('Выберите причину апелляции.');
  const checked = normalize(rows || []);
  if (checked.some((r) => r.level !== 'ad' || !r.adgroupId)) throw new HubError('Не у всех объявлений определён адсет. Обновите список.');
  const state = await readState();
  const todo = checked.filter((r) => !blocked(state, account, r));
  if (!todo.length) throw new HubError('Нет доступных объявлений: проблемные не найдены или апелляции уже отправлены.');

  batchRunning = true;
  cancelRequested = false;
  const batchId = crypto.randomUUID();
  try {
    await chrome.storage.session.set({
      [BATCH_KEY]: { id: batchId, account, total: todo.length, skippedBlocked: checked.length - todo.length, completed: 0, state: 'running', phase: 'sending', startedAt: Date.now(), cancelRequested: false }
    });
  } catch (e) { batchRunning = false; throw e; }
  log('info', 'appeals', `Старт пачки: ${todo.length} объявлений, причина ${reason}`);
  runBatch(tabId, account, todo, cleanText, reason, batchId);
  return { batchId, total: todo.length, skippedBlocked: checked.length - todo.length };
}

export async function history() {
  const state = await readState();
  return state.jobs.slice(-300).reverse().map((j) => ({
    jobId: j.jobId, id: j.id, level: j.level, name: j.name, account: j.account, status: j.status,
    message: j.message || '', created: j.created, updated: j.updated, appealReason: j.appealReason, serverStatus: j.serverStatus || ''
  }));
}

export async function unblock(jobId) {
  return mutate((state) => {
    const job = state.jobs.find((j) => j.jobId === jobId);
    if (!job) throw new HubError('Запись не найдена.');
    if (!['unknown', 'sending', 'accepted', 'limited'].includes(job.status)) throw new HubError('Эту запись снимать с блокировки не нужно.');
    job.previousStatus = job.status;
    job.status = 'cancelled';
    job.message = (job.message ? job.message + ' ' : '') + '(блокировка снята вручную)';
    return { ok: true };
  });
}

export async function clearHistory() {
  await withLock('tth-appeals', () => chrome.storage.local.remove(STORE));
  return { ok: true };
}
