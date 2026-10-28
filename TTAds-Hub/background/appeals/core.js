// Чистая логика апелляций (порт Appeal Desk 0.29): ключи, блокировки повторов, проверка результата.
// Модуль без обращений к chrome.* — покрыт юнит-тестами.

export const key = (account, row) => JSON.stringify([account, row.level, row.id]);

export function normalize(rows) {
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('Нужен массив, максимум 5000 строк');
  return rows.map((r) => {
    if (!r || typeof r.id !== 'string' || !/^\d{5,30}$/.test(r.id) ||
        !['ad', 'adgroup', 'campaign'].includes(r.level) || !['rejected', 'review_issue'].includes(r.status)) {
      throw new Error('Каждая строка: id строкой цифр, level ad/adgroup/campaign, status rejected/review_issue');
    }
    return {
      id: r.id,
      level: r.level,
      appealVersion: r.appealVersion,
      adgroupId: typeof r.adgroupId === 'string' ? r.adgroupId : undefined,
      campaignId: typeof r.campaignId === 'string' ? r.campaignId : undefined,
      status: r.status,
      thumbnail: typeof r.thumbnail === 'string' && /^https:\/\/[^/]*tiktokcdn\.com\//.test(r.thumbnail) ? r.thumbnail : '',
      name: String(r.name || r.id).slice(0, 300),
      reason: String(r.reason || 'Причина не указана').slice(0, 2000)
    };
  });
}

export function latestJob(state, account, row) {
  return state.jobs.filter((j) => j.key === key(account, row)).at(-1);
}

// Повтор блокируется, пока предыдущая отправка не завершилась явным отказом/ошибкой.
export function blocked(state, account, row) {
  const job = latestJob(state, account, row);
  return !!job && !['cancelled', 'failed', 'retry_allowed'].includes(job.status);
}

const APPEAL_REJECTED = /appeal[ _-]*reject(?:ed)?|апелляци.{0,20}отклон|отклон.{0,20}апелляци/i;
const APPEAL_PENDING = /appeal.{0,15}(pending|review|progress)|under review|на рассмотрении/i;

export function canRetry(state, account, row) {
  const job = latestJob(state, account, row);
  return Boolean(APPEAL_REJECTED.test(row.reason || '') && ['submitted', 'submitted_manual'].includes(job?.status) && (!job.sentFromRejected || job.sawPending));
}

export function syncAppeals(state, account, rows, observations = []) {
  for (const o of observations) {
    const job = latestJob(state, account, { level: 'ad', id: o.id });
    if (job && ['submitted', 'submitted_manual'].includes(job.status) && APPEAL_PENDING.test(o.status)) job.sawPending = true;
  }
  for (const row of rows) {
    if (canRetry(state, account, row)) {
      const job = latestJob(state, account, row);
      job.previousStatus = job.status;
      job.status = 'retry_allowed';
      job.retryAllowedAt = new Date().toISOString();
    }
  }
  return state;
}

// code=0 сам по себе не доказывает отправку: нужна обновлённая запись апелляции на стороне TikTok.
export function verifySubmission(job, server) {
  const changed = server && Number.isFinite(Number(server.appealVersion)) &&
    (job.appealVersion != null ? String(server.appealVersion) !== String(job.appealVersion)
      : Number(server.appealVersion) * 1000 >= Date.parse(job.created) - 5000);
  if (!changed) return { status: 'unknown', message: 'Запрос получил code=0, но новая апелляция в статусе TikTok пока не подтверждена.' };
  if (Number(server.appealStatus) === 4) return { status: 'retry_allowed', message: 'TikTok уже вернул отказ по обновлённой записи апелляции.' };
  if (Number.isInteger(Number(server.appealStatus)) && Number(server.appealStatus) > 0) return { status: 'submitted', message: 'TikTok обновил запись апелляции после отправки.' };
  return { status: 'unknown', message: 'Статус после отправки не удалось подтвердить.' };
}

export function applyCurrentAppeal(job, server) {
  if (!job || ['sending', 'limited'].includes(job.status)) return;
  if (Number(server.appealStatus) === 4) {
    job.previousStatus = job.status;
    job.status = 'retry_allowed';
    job.serverStatus = 'rejected';
    job.retryAllowedAt = new Date().toISOString();
  }
  job.lastServerStatus = server;
}

// Незавершённая отправка (например, закрыли браузер) превращается в «unknown» — повтор остаётся заблокированным.
export function expireStale(state, now = Date.now(), maxAgeMs = 10 * 60 * 1000) {
  let changed = 0;
  for (const job of state.jobs) {
    if (job.status === 'sending' && now - Date.parse(job.created || 0) > maxAgeMs) {
      job.status = 'unknown';
      job.message = 'Отправка была прервана. Проверьте статус апелляции в TikTok.';
      changed++;
    }
  }
  return changed;
}

export function pruneJobs(state, max = 3000) {
  if (state.jobs.length > max) state.jobs.splice(0, state.jobs.length - max);
  return state;
}

export const FINAL_STATUSES = ['submitted', 'limited', 'retry_allowed', 'failed', 'unknown', 'skipped'];

// Сводка результатов пачки: счётчики + сгруппированные проблемы по тексту сообщения.
export function summarize(results) {
  const counts = Object.fromEntries(FINAL_STATUSES.map((s) => [s, 0]));
  const groups = new Map();
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (['submitted', 'skipped'].includes(r.status)) continue;
    const g = groups.get(r.message) ?? { status: r.status, message: r.message, ids: [] };
    g.ids.push(r.id);
    groups.set(r.message, g);
  }
  return { counts, problems: [...groups.values()] };
}

// Пул с ограничением параллелизма. Прерывается флагом stop() — уже запущенные запросы завершаются.
export async function runPool(items, limit, worker, stop = () => false) {
  const results = new Array(items.length).fill(undefined); // плотный массив: map/forEach не пропускают нестартовавшие
  let next = 0;
  const lane = async () => {
    for (;;) {
      if (stop()) return;
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); } catch (e) {
        results[index] = { status: 'unknown', message: 'Результат не подтверждён: ' + String(e?.message || e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, lane));
  return results;
}
