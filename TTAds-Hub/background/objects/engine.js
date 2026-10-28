// Массовое изменение объектов по снятым контрактам: вкл/выкл, имя, бюджет.
// preflight (контракт + свежее чтение) → повтор запросов → повторное чтение → журнал; откат по сохранённому «до».
import { ORIGIN } from '../lib/constants.js';
import { HubError, runInPageGuarded, wait } from '../lib/page.js';
import { log } from '../lib/storage.js';
import { keepAlive } from '../lib/tabs.js';
import * as accountsEngine from '../accounts/engine.js';
import { ID_RE, LEVELS, readiness, variantFor, buildRequest, renderName, budgetAfter, maskBody } from './contract.js';
import { getContracts, clearContracts, getSession, getJob, setJob, pickAdsTab, readRows, stateOf } from './store.js';
import { replayMutationInPage } from './page-scripts.js';

const ACTIONS = ['disable', 'enable', 'rename', 'budget'];
const INVERSE = { disable: 'enable', enable: 'disable', rename: 'rename', budget: 'budget' };
const LEVEL_TITLE = { campaign: 'кампаний', adgroup: 'адсетов', ad: 'объявлений' };
const ACTION_TITLE = { disable: 'выключить', enable: 'включить', rename: 'переименовать', budget: 'изменить бюджет' };
const MAX_ITEMS = 300;
const MAX_ACCOUNTS = 50;
const CONCURRENCY = 3;
let active = null;

function normalize(input = {}) {
  const action = ACTIONS.includes(input.action) ? input.action : null;
  if (!action) throw new HubError('Выберите действие.');
  const level = LEVELS.includes(input.level) ? input.level : 'campaign';
  if (action === 'budget' && level === 'ad') throw new HubError('У объявлений нет собственного бюджета.');
  const accounts = [...new Set((Array.isArray(input.accounts) ? input.accounts : []).map(String).filter((id) => ID_RE.test(id)))].slice(0, MAX_ACCOUNTS);
  if (!accounts.length) throw new HubError('Не выбраны кабинеты.');
  const ids = {};
  for (const [account, list] of Object.entries(input.ids && typeof input.ids === 'object' ? input.ids : {})) {
    if (ID_RE.test(account) && Array.isArray(list)) ids[account] = new Set(list.map(String).filter((id) => ID_RE.test(id)));
  }
  const state = ['all', 'enabled', 'disabled'].includes(input.filter?.state) ? input.filter.state : action === 'enable' ? 'disabled' : action === 'disable' ? 'enabled' : 'all';
  const nameTemplate = String(input.nameTemplate || '').slice(0, 100);
  if (action === 'rename' && !nameTemplate.trim()) throw new HubError('Введите шаблон имени.');
  const budget = { mode: input.budget?.mode === 'multiply' ? 'multiply' : 'set', value: Number(input.budget?.value) };
  if (action === 'budget' && !(budget.value > 0)) throw new HubError('Введите бюджет больше нуля.');
  return { action, level, accounts, ids, filter: { state, q: String(input.filter?.q || '').trim().toLowerCase().slice(0, 80) }, nameTemplate, budget, confirmSpend: input.confirmSpend === true };
}

const matchesFilter = (row, { state, q }) => {
  if (state === 'enabled' && row.enabled !== true) return false;
  if (state === 'disabled' && row.enabled !== false) return false;
  return !q || row.name.toLowerCase().includes(q) || row.id.includes(q);
};

function makeItem(plan, account, row, n) {
  const base = { aadvid: account, id: row.id, name: row.name, before: stateOf(row), after: null };
  if (plan.action === 'disable') return row.enabled === true ? { ...base, after: { enabled: false } } : null;
  if (plan.action === 'enable') return row.enabled === false ? { ...base, after: { enabled: true } } : null;
  if (plan.action === 'rename') {
    const name = renderName(plan.nameTemplate, { name: row.name, n });
    return name && name !== row.name ? { ...base, after: { name } } : null;
  }
  if (!(row.budget > 0)) return null;
  const budget = budgetAfter(row.budget, plan.budget);
  return budget !== null && budget !== row.budget ? { ...base, after: { budget } } : null;
}

async function resolveTargets(plan) {
  const list = await accountsEngine.cached().catch(() => null);
  const known = new Map((list?.accounts || []).map((account) => [account.id, account]));
  const out = [];
  for (const account of plan.accounts) {
    const info = known.get(account);
    const entry = { id: account, name: info?.name || account, currency: info?.currency || '', total: 0, items: [], skipped: 0, error: '', truncated: false };
    try {
      const read = await readRows(account, plan.level);
      entry.total = read.rows.length;
      entry.truncated = read.truncated;
      const explicit = plan.ids[account];
      let n = 0;
      for (const row of read.rows) {
        if (explicit ? !explicit.has(row.id) : !matchesFilter(row, plan.filter)) continue;
        const item = makeItem(plan, account, row, ++n);
        if (item) entry.items.push(item); else entry.skipped += 1;
      }
    } catch (error) {
      entry.error = String(error?.message || error).slice(0, 200);
    }
    out.push(entry);
  }
  return out;
}

const noContract = (plan) => new HubError(`Расширение ещё не знает, как ${ACTION_TITLE[plan.action]} ${LEVEL_TITLE[plan.level]} в этой версии TikTok. Обучите действие: выполните его один раз в TikTok на тестовом объекте.`, 'no_contract');

export async function plan(input) {
  const p = normalize(input);
  const variant = variantFor(await getContracts(), p.level, p.action);
  const entries = await resolveTargets(p);
  return {
    action: p.action, level: p.level, ready: Boolean(variant),
    accounts: entries.map((entry) => ({
      id: entry.id, name: entry.name, currency: entry.currency, total: entry.total, targets: entry.items.length, skipped: entry.skipped, error: entry.error, truncated: entry.truncated,
      sample: entry.items.slice(0, 5).map(({ id, name, before, after }) => ({ id, name, before, after }))
    })),
    totals: { targets: entries.reduce((sum, entry) => sum + entry.items.length, 0), skipped: entries.reduce((sum, entry) => sum + entry.skipped, 0), accounts: entries.length }
  };
}

const saveJob = (job) => { job.heartbeat = Date.now(); return setJob(job); };

const confirmed = (action, row, item) => {
  if (action === 'disable') return row.enabled === false;
  if (action === 'enable') return row.enabled === true;
  if (action === 'rename') return row.name === item.after.name;
  return Math.abs(row.budget - item.after.budget) < 0.01;
};

async function run(job) {
  const release = keepAlive();
  try {
    const variant = variantFor(await getContracts(), job.level, job.action);
    if (!variant) throw noContract(job);
    const tab = await pickAdsTab();
    const queue = job.items.map((_, index) => index);
    let streak = 0, successes = 0, aborted = '';
    const worker = async () => {
      while (queue.length && !active?.cancel && !aborted) {
        const item = job.items[queue.shift()];
        let result;
        try {
          const request = buildRequest(variant, { aadvid: item.aadvid, id: item.id, value: item.after?.name ?? item.after?.budget });
          result = await runInPageGuarded(tab.id, replayMutationInPage, [{ ...request, timeoutMs: 15000 }], { stayOn: `${ORIGIN}/`, timeoutMs: 30000 });
        } catch (error) {
          result = { error: String(error?.message || error).slice(0, 200) };
        }
        const ok = Boolean(result) && !result.error && !result.lost && result.http === 200 && result.code === 0;
        item.request = { ok, http: result?.http ?? null, code: result?.code ?? null, msg: result?.msg || result?.error || (result?.lost ? 'вкладка TikTok недоступна' : '') };
        job.done += 1;
        if (ok) { successes += 1; streak = 0; } else {
          job.failed += 1; streak += 1;
          // Если TikTok отклоняет запрос с самого начала, остальные не отправляем: так не засоряем журнал и не нагружаем аккаунт.
          if (!successes && streak >= 3) aborted = item.request.msg || 'TikTok отклоняет запрос';
        }
        if (job.done % 5 === 0 || !ok) await saveJob(job);
        await wait(120);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    for (const item of job.items) if (!item.request) item.request = { ok: false, skipped: true, msg: aborted ? `пропущено: ${aborted}` : 'остановлено' };

    job.phase = 'verify';
    await saveJob(job);
    await wait(1200);
    const byAccount = new Map();
    for (const item of job.items) byAccount.set(item.aadvid, [...(byAccount.get(item.aadvid) || []), item]);
    for (const [account, items] of byAccount) {
      try {
        const { rows } = await readRows(account, job.level, tab.id);
        const map = new Map(rows.map((row) => [row.id, row]));
        for (const item of items) {
          const row = map.get(item.id);
          item.now = row ? stateOf(row) : null;
          item.verified = item.request.ok && row ? confirmed(job.action, row, item) : false;
        }
      } catch (error) {
        job.note = `Не удалось перечитать кабинет ${account}: ${String(error?.message || error).slice(0, 120)}`;
        for (const item of items) item.verified = null;
      }
    }
    const verified = job.items.filter((item) => item.verified === true).length;
    job.verified = verified;
    job.state = active?.cancel ? 'cancelled' : verified === job.total ? 'complete' : verified ? 'partial' : 'error';
    if (aborted) job.error = aborted;
    job.phase = null;
    job.completedAt = Date.now();
    await saveJob(job);
    log(job.state === 'complete' ? 'info' : 'warn', 'objects', `${ACTION_TITLE[job.action]} (${LEVEL_TITLE[job.level]}): подтверждено ${verified} из ${job.total} в ${byAccount.size} РК — ${job.state}${job.rollbackOf ? ' (откат)' : ''}`);
  } catch (error) {
    job.state = 'error';
    job.error = String(error?.message || error).slice(0, 300);
    job.phase = null;
    job.completedAt = Date.now();
    await saveJob(job);
    log('warn', 'objects', `Массовое действие остановлено: ${job.error}`);
  } finally {
    release();
  }
}

async function startJob({ action, level, items, accounts, rollbackOf = null }) {
  const job = { id: crypto.randomUUID(), state: 'running', action, level, startedAt: Date.now(), total: items.length, done: 0, failed: 0, items, accounts, rollbackOf };
  await saveJob(job);
  active = { id: job.id, cancel: false };
  run(job).finally(() => { if (active?.id === job.id) active = null; });
  return job;
}

export async function apply(input) {
  if (active) throw new HubError('Другая операция уже выполняется — дождитесь окончания.');
  const p = normalize(input);
  if (['enable', 'budget'].includes(p.action) && !p.confirmSpend) throw new HubError('Включение и бюджет могут увеличить расход — подтвердите действие.');
  const session = await getSession();
  if (session?.state === 'waiting' && Date.now() < session.expiresAt) throw new HubError('Идёт обучение действия — завершите или остановите его.');
  if (!variantFor(await getContracts(), p.level, p.action)) throw noContract(p);
  const entries = await resolveTargets(p);
  const items = entries.flatMap((entry) => entry.items);
  if (!items.length) throw new HubError(entries.find((entry) => entry.error)?.error || 'Менять нечего: объекты уже в нужном состоянии или не подходят под фильтр.');
  if (items.length > MAX_ITEMS) throw new HubError(`За один раз можно изменить не более ${MAX_ITEMS} объектов (выбрано ${items.length}). Сузьте выбор.`);
  return startJob({ action: p.action, level: p.level, items, accounts: entries.map(({ id, name, error }) => ({ id, name, error })) });
}

export async function rollback() {
  if (active) throw new HubError('Другая операция уже выполняется.');
  const job = await getJob();
  if (!job || job.state === 'running') throw new HubError('Нет завершённой операции для отката.');
  const changed = job.items.filter((item) => item.verified === true);
  if (!changed.length) throw new HubError('В последней операции нет подтверждённых изменений.');
  const action = INVERSE[job.action];
  if (!variantFor(await getContracts(), job.level, action)) throw new HubError(`Для отката нужно обучить обратное действие: ${ACTION_TITLE[action]} ${LEVEL_TITLE[job.level]}.`, 'no_contract');
  const back = (item) => (job.action === 'rename' ? { name: item.before.name } : job.action === 'budget' ? { budget: item.before.budget } : { enabled: item.before.enabled });
  const items = changed.map((item) => ({ aadvid: item.aadvid, id: item.id, name: item.now?.name || item.name, before: item.now || item.after, after: back(item) }));
  return startJob({ action, level: job.level, items, accounts: job.accounts, rollbackOf: job.id });
}

export async function cancel() {
  if (active) active.cancel = true;
  return jobStatus();
}

export async function jobStatus() {
  const job = await getJob();
  return job?.state === 'running' && active?.id !== job.id ? { ...job, state: 'interrupted' } : job;
}

export async function status() {
  const session = await getSession();
  return {
    ready: readiness(await getContracts()),
    session: session?.state === 'waiting' && Date.now() > session.expiresAt ? { ...session, state: 'expired' } : session,
    job: await jobStatus()
  };
}

// Для разработчика: форма запросов без ID, текста и секретов (тела маскируются, видны ключи и enum-значения).
export async function diagnostics() {
  const store = await getContracts();
  const contracts = {};
  for (const [id, entry] of Object.entries(store)) {
    contracts[id] = {
      updatedAt: entry.updatedAt,
      variants: Object.fromEntries(Object.entries(entry.variants || {}).map(([key, variant]) => [key, {
        at: variant.at, path: variant.path, query: variant.query, headers: Object.keys(variant.headers || {}), riskInfo: variant.riskInfo, slot: variant.slot, body: maskBody(variant.body)
      }]))
    };
  }
  const session = await getSession();
  const job = await getJob();
  return {
    contracts,
    session: session ? { state: session.state, level: session.level, kind: session.kind, message: session.message, other: session.other || [] } : null,
    job: job ? { action: job.action, level: job.level, state: job.state, total: job.total, verified: job.verified, error: job.error || '', failedMessages: [...new Set(job.items.filter((item) => item.request && !item.request.ok).map((item) => `${item.request.http ?? ''} ${item.request.code ?? ''} ${item.request.msg}`.trim()))].slice(0, 5) } : null
  };
}

export const reset = () => clearContracts();
