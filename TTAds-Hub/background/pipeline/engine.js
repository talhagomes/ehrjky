// Конвейер «в один клик»: создать N рекламных кабинетов → (опц.) связать с Payment Portfolio → (опц.) расшарить в BC партнёра.
// Прогресс пишется в storage (pipelineJob), поэтому popup можно закрыть и открыть снова — работа продолжится.
import { HubError } from '../lib/page.js';
import { getSettings, log } from '../lib/storage.js';
import * as registry from '../lib/registry.js';
import { closeTab, focusTab, keepAlive } from '../lib/tabs.js';
import * as creation from '../creation/engine.js';
import * as share from '../share/engine.js';
import { DEFAULT_NAME_TEMPLATES as DEFAULT_TEMPLATES } from '../lib/constants.js';

const KEY = 'pipelineJob';
const ID = /^\d{5,30}$/;
const MAX_COUNT = 20;

let active = null;

const text = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pad = (n) => String(n).padStart(2, '0');
const idList = (values, max = 10) => [...new Set((Array.isArray(values) ? values : String(values ?? '').split(/[^\d]+/))
  .map(String).filter((id) => ID.test(id)))].slice(0, max);

// {date} → ММДД, {time} → ЧЧММ, {n} → номер в пачке, {rand} → 4 случайных символа (общие для пары BC/РК).
export function renderName(template, { n = 1, rand = '', now = new Date() } = {}) {
  const value = String(template || '')
    .replaceAll('{date}', `${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
    .replaceAll('{time}', `${pad(now.getHours())}${pad(now.getMinutes())}`)
    .replaceAll('{n}', String(n))
    .replaceAll('{rand}', rand);
  return text(value, 100);
}

const randomTail = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(-4).toUpperCase().padStart(4, 'X');

function buildPlan(input = {}, settings) {
  const auto = settings.automation;
  const shareInput = input.share ?? auto.share;
  const mode = (input.mode ?? auto.mode) === 'existing-bc' ? 'existing-bc' : 'new-bc';
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(input.count ?? auto.count) || 1)));
  const businessCenterId = text(input.businessCenterId ?? auto.businessCenterId, 30);
  if (mode === 'existing-bc' && !ID.test(businessCenterId)) throw new HubError('Выберите Business Center, в котором создавать РК.');
  const plan = {
    mode, count, businessCenterId,
    businessCenterName: text(input.businessCenterName),
    bcTemplate: text(input.bcTemplate ?? auto.bcTemplate, 80) || DEFAULT_TEMPLATES.bc,
    adTemplate: text(input.adTemplate ?? auto.adTemplate, 80) || DEFAULT_TEMPLATES.ad,
    linkPortfolio: (input.linkPortfolio ?? auto.linkPortfolio) === true,
    closeTabs: (input.closeTabs ?? auto.closeTabs) !== false,
    share: {
      enabled: shareInput?.enabled === true,
      targets: idList(shareInput?.targets),
      permission: ['Admin', 'Operator', 'Analyst'].includes(shareInput?.permission) ? shareInput.permission : 'Admin',
      autoAccept: shareInput?.autoAccept !== false
    },
    company: {
      companyMode: input.company?.companyMode === 'new' ? 'new' : 'existing',
      companyName: text(input.company?.companyName),
      companyWebsite: text(input.company?.companyWebsite, 240),
      contactName: text(input.company?.contactName),
      phone: text(input.company?.phone, 40),
      email: text(input.company?.email, 160)
    }
  };
  if (plan.share.enabled && !plan.share.targets.length) throw new HubError('Укажите ID Business Center, куда расшаривать, или выключите шаринг.');
  if (plan.share.enabled && mode === 'existing-bc' && plan.share.targets.includes(businessCenterId)) {
    throw new HubError('BC получателя совпадает с BC, в котором создаются РК.');
  }
  return plan;
}

function makeItems(plan) {
  const now = new Date();
  return Array.from({ length: plan.count }, (_, index) => {
    const rand = randomTail();
    return {
      index: index + 1,
      state: 'queued',
      businessCenterName: plan.mode === 'new-bc' ? renderName(plan.bcTemplate, { n: index + 1, rand, now }) : plan.businessCenterName,
      adAccountName: renderName(plan.adTemplate, { n: index + 1, rand, now })
    };
  });
}

async function save(job) {
  job.heartbeat = Date.now();
  await chrome.storage.local.set({ [KEY]: job });
  return job;
}

const creationInput = (plan, item) => ({
  mode: plan.mode,
  businessCenterId: plan.businessCenterId,
  businessCenterName: item.businessCenterName,
  adAccountName: item.adAccountName,
  ...plan.company
});

const ids = (result = {}) => ({
  businessCenterId: String(result.businessCenterId || ''),
  adAccountId: String(result.adAccountId || ''),
  companyId: String(result.companyId || '')
});

async function linkPayment(job, item, result) {
  if (!job.plan.linkPortfolio) return;
  if (!result.paymentSetupPending) { item.payment = { skipped: true, note: 'TikTok не показал шаг Payment setup' }; return; }
  if (!result.paymentSetup?.portfolio?.id) { item.payment = { skipped: true, note: 'TikTok не предложил существующий Payment Portfolio' }; return; }
  item.state = 'paying';
  await save(job);
  const paid = await creation.confirmPaymentOnTab(item.tabId, { businessCenterId: item.result.businessCenterId, adAccountId: item.result.adAccountId, portfolio: result.paymentSetup.portfolio });
  item.payment = paid?.success
    ? { success: true, portfolio: paid.portfolio || null }
    : { error: paid?.error || (paid?.pending ? 'TikTok ещё обрабатывает привязку' : 'Не удалось связать Portfolio') };
}

async function afterCreated(job, item, created) {
  item.result = ids(created.result);
  item.state = 'created';
  await save(job);
  await registry.upsert({ ...item.result, adAccountName: item.adAccountName, businessCenterName: item.businessCenterName, source: 'created' }).catch(() => {});
  await linkPayment(job, item, created.result || {});
  item.state = 'created';
  await save(job);
}

// Шаринг всех созданных, но ещё не расшаренных РК — группами по исходному BC (одна операция на BC).
async function flushShares(job) {
  const pending = job.items.filter((item) => item.state === 'created');
  if (!pending.length) return 'ok';
  if (!job.plan.share.enabled) {
    for (const item of pending) {
      item.state = 'done';
      if (job.plan.closeTabs && !item.payment?.error) await closeTab(item.tabId);
    }
    await save(job);
    return 'ok';
  }
  const groups = new Map();
  for (const item of pending) {
    const bcId = item.result?.businessCenterId || job.plan.businessCenterId;
    if (!ID.test(bcId) || !ID.test(item.result?.adAccountId || '')) {
      item.state = 'done';
      item.share = { state: 'error', warnings: ['TikTok не вернул ID BC/РК — расшарьте этот кабинет вручную из списка «Созданные РК».'] };
      continue;
    }
    if (!groups.has(bcId)) groups.set(bcId, []);
    groups.get(bcId).push(item);
  }
  for (const [bcId, items] of groups) {
    for (const item of items) item.state = 'sharing';
    await save(job);
    const reuse = items.at(-1).tabId;
    const alive = reuse ? await chrome.tabs.get(reuse).catch(() => null) : null;
    const outcome = await share.runShare({
      sourceBusinessCenterId: bcId,
      accountIds: items.map((item) => item.result.adAccountId),
      targets: job.plan.share.targets,
      permission: job.plan.share.permission,
      autoAccept: job.plan.share.autoAccept
    }, { tabId: alive ? reuse : null, onStep: (step) => { job.step = step; return save(job); } });
    job.step = null;
    const summary = {
      state: outcome.state,
      warnings: outcome.warnings,
      targets: outcome.results.map((entry) => ({
        targetBusinessCenterId: entry.targetBusinessCenterId,
        shared: Boolean(entry.share?.success),
        accepted: Boolean(entry.accept?.success),
        error: entry.share?.error || '',
        hint: entry.share?.hint || entry.accept?.hint || entry.accept?.error || ''
      })),
      tabId: outcome.tabId
    };
    if (outcome.state === 'needs-user') {
      for (const item of items) { item.state = 'share-paused'; item.share = summary; }
      job.state = 'paused';
      job.pause = { phase: 'share', tabId: outcome.tabId, hint: outcome.results.at(-1)?.share?.hint || 'Завершите шаг во вкладке TikTok.' };
      await save(job);
      if (outcome.tabId) { await focusTab(outcome.tabId); await share.hint(outcome.tabId, job.pause.hint); }
      return 'paused';
    }
    for (const item of items) { item.share = summary; item.state = 'done'; }
    if (job.plan.closeTabs && outcome.state === 'complete') {
      for (const tabId of new Set([outcome.tabId, ...items.map((item) => item.tabId)])) if (tabId) await closeTab(tabId);
    }
    await save(job);
  }
  return 'ok';
}

function finish(job) {
  const done = job.items.filter((item) => item.state === 'done');
  const failed = job.items.filter((item) => item.state === 'error');
  const cancelled = job.items.filter((item) => item.state === 'cancelled');
  const warnings = done.filter((item) => item.payment?.error || (item.share && item.share.state !== 'complete'));
  job.state = cancelled.length && !failed.length ? 'cancelled'
    : failed.length ? (done.length ? 'partial' : 'error')
      : warnings.length ? 'partial' : 'complete';
  job.completedAt = Date.now();
  job.pause = null;
  return job;
}

async function run(job) {
  const release = keepAlive();
  active = { id: job.id, cancel: false };
  try {
    for (const item of job.items) {
      if (item.state !== 'queued') continue;
      if (active.cancel) { item.state = 'cancelled'; continue; }
      item.state = 'creating';
      job.current = item.index;
      await save(job);
      const created = await creation.runCreation(creationInput(job.plan, item), { submit: true, focus: false });
      item.tabId = created.tabId;
      if (created.state === 'needs-user') {
        item.state = 'paused';
        job.state = 'paused';
        job.pause = {
          phase: 'create', index: item.index, tabId: created.tabId,
          hint: created.result?.reason === 'identity-verification' ? 'TikTok запросил проверку телефона/кода. Завершите её во вкладке и нажмите «Продолжить».' : 'TikTok запросил проверку. Завершите её во вкладке и нажмите «Продолжить».'
        };
        await save(job);
        await focusTab(created.tabId);
        await share.hint(created.tabId, job.pause.hint);
        return;
      }
      if (created.state !== 'complete') {
        item.state = 'error';
        item.error = created.result?.error || `Мастер TikTok остановился в состоянии «${created.state}»`;
        job.stopReason = item.error;
        await save(job);
        if (created.tabId) await focusTab(created.tabId);
        for (const rest of job.items) if (rest.state === 'queued') rest.state = 'cancelled';
        break;
      }
      await afterCreated(job, item, created);
      // Для «новый BC + РК» у каждого кабинета свой BC — шарим сразу, переиспользуя вкладку мастера.
      if (job.plan.mode === 'new-bc' && await flushShares(job) === 'paused') return;
    }
    if (await flushShares(job) === 'paused') return;
    finish(job);
    await save(job);
    const done = job.items.filter((item) => item.state === 'done').length;
    log(job.state === 'complete' ? 'info' : 'warn', 'create', `Конвейер: создано ${done}/${job.items.length} РК${job.plan.linkPortfolio ? ', Portfolio' : ''}${job.plan.share.enabled ? `, шаринг → ${job.plan.share.targets.join(', ')}` : ''} — ${job.state}`);
  } catch (error) {
    job.state = 'error';
    job.stopReason = String(error?.message || error).slice(0, 300);
    job.completedAt = Date.now();
    await save(job);
    log('warn', 'create', `Конвейер остановлен: ${job.stopReason}`);
  } finally {
    active = null;
    release();
  }
}

export async function start(input = {}) {
  if (active) throw new HubError('Конвейер уже выполняется — дождитесь окончания или остановите его.');
  const settings = await getSettings();
  const plan = buildPlan(input, settings);
  const job = { id: crypto.randomUUID(), plan, state: 'running', items: makeItems(plan), startedAt: Date.now() };
  await save(job);
  run(job);
  return job;
}

export async function status() {
  const job = (await chrome.storage.local.get(KEY))[KEY] ?? null;
  // Сервис-воркер перезапускался посреди работы — честно показываем, что процесс прерван.
  if (job?.state === 'running' && active?.id !== job.id) return { ...job, state: 'interrupted' };
  return job;
}

export async function cancel() {
  if (active) active.cancel = true;
  const job = await status();
  if (job && ['paused', 'interrupted'].includes(job.state)) {
    for (const item of job.items) if (['queued', 'paused', 'creating', 'share-paused', 'sharing'].includes(item.state)) item.state = 'cancelled';
    finish(job);
    await save(job);
  }
  return job;
}

export async function resume() {
  if (active) throw new HubError('Конвейер уже выполняется.');
  const job = await status();
  if (!job || !['paused', 'interrupted'].includes(job.state)) throw new HubError('Нет приостановленного конвейера.');
  const stuck = job.items.find((item) => ['paused', 'creating'].includes(item.state));
  if (stuck) {
    const check = await creation.inspectTab(stuck.tabId, creationInput(job.plan, stuck));
    if (check.state === 'needs-user') throw new HubError('TikTok всё ещё ждёт подтверждения во вкладке. Завершите проверку и повторите.');
    if (check.state === 'complete' && ID.test(String(check.result?.adAccountId || ''))) {
      await afterCreated(job, stuck, check);
    } else if (check.state === 'closed' || check.state === 'error') {
      stuck.state = 'queued';
    } else {
      throw new HubError('Мастер TikTok ещё не завершён. Проверьте вкладку и повторите.');
    }
  }
  for (const item of job.items) if (['share-paused', 'sharing', 'paying'].includes(item.state)) item.state = 'created';
  job.state = 'running';
  job.pause = null;
  await save(job);
  run(job);
  return job;
}

export async function openTab(index) {
  const job = await status();
  const item = job?.items?.find((entry) => entry.index === Number(index)) || job?.items?.find((entry) => entry.tabId);
  const tabId = job?.pause?.tabId || item?.tabId;
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) throw new HubError('Вкладка TikTok уже закрыта.');
  await focusTab(tab.id);
  return { ok: true, tabId: tab.id };
}

export const listCreated = () => registry.list();
