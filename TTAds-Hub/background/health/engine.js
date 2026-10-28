// Проверка РК в один клик: статус, билл (порог автоплатежа), долг, баланс и карта по каждому кабинету.
// Сначала читает таблицы Business Center (Payment management, при отсутствии финансовых прав — Accounts),
// затем платёжные страницы Ads Manager в фоновых вкладках. Прогресс — в storage, popup можно закрыть.
import { HubError, runInPageGuarded, wait } from '../lib/page.js';
import { getSettings, log, withLock } from '../lib/storage.js';
import { closeTab, keepAlive, navigate, openTab } from '../lib/tabs.js';
import * as accounts from '../accounts/engine.js';
import { readAdsBillingPageInPage, readBcTableInPage } from './page-scripts.js';
import { parseBillingPage, parseBcRows } from './parse.js';
import { flagMap, newProblems, alertText } from './model.js';

const ADS = 'https://ads.tiktok.com';
const BC = 'https://business.tiktok.com';
const CACHE = 'healthCache';
const JOB = 'healthJob';
const ID = /^\d{5,30}$/;
export const FRESH_MS = 30 * 60 * 1000;
const MAX_ACCOUNTS = 300;
const CACHE_LIMIT = 1500;

const billingUrl = (id) => `${ADS}/i18n/account/payment?aadvid=${encodeURIComponent(id)}`;
const bcPaymentUrl = (bcId) => `${BC}/manage/payment/v2?org_id=${encodeURIComponent(bcId)}`;
const bcAccountsUrl = (bcId) => `${BC}/manage/accounts/adv?org_id=${encodeURIComponent(bcId)}`;
const idList = (values) => [...new Set((Array.isArray(values) ? values : String(values ?? '').split(/[^\d]+/)).map(String).filter((id) => ID.test(id)))];

let active = null;
const completionHooks = [];
const finished = (job) => { for (const hook of completionHooks) Promise.resolve(hook(job)).catch(() => {}); };

export async function cached() {
  const value = (await chrome.storage.local.get(CACHE))[CACHE];
  return { accounts: value?.accounts && typeof value.accounts === 'object' ? value.accounts : {}, bcs: value?.bcs && typeof value.bcs === 'object' ? value.bcs : {} };
}

function patchCache(mutate) {
  return withLock(CACHE, async () => {
    const cache = await cached();
    mutate(cache);
    const entries = Object.entries(cache.accounts);
    if (entries.length > CACHE_LIMIT) {
      entries.sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
      cache.accounts = Object.fromEntries(entries.slice(0, CACHE_LIMIT));
    }
    await chrome.storage.local.set({ [CACHE]: cache });
    return cache;
  });
}

export async function clear() {
  await withLock(CACHE, () => chrome.storage.local.remove(CACHE));
  return { accounts: {}, bcs: {} };
}

async function save(job) {
  job.heartbeat = Date.now();
  await chrome.storage.local.set({ [JOB]: job });
  return job;
}

export async function status() {
  const job = (await chrome.storage.local.get(JOB))[JOB] ?? null;
  if (job?.state === 'running' && active?.id !== job.id) return { ...job, state: 'interrupted' };
  return job;
}

export async function cancel() {
  if (active) active.cancel = true;
  const job = await status();
  if (job?.state === 'interrupted') { job.state = 'cancelled'; job.completedAt = Date.now(); await save(job); }
  return job;
}

// Без сырых текстов: в кэш попадают только разобранные поля.
function adsEntry(page) {
  if (!page || page.lost) return { ok: false, error: page?.error || 'TikTok не ответил вовремя.' };
  if (page.error) return { ok: false, error: page.error };
  if (page.login) return { ok: false, error: 'TikTok просит войти в аккаунт.', login: true };
  if (page.redirectedToBc) return { ok: false, managedByBc: true, error: 'Оплатой этого РК управляет Business Center.' };
  return { ok: true, ...parseBillingPage(page) };
}

// Полная навигация на тот же путь другого РК: убеждаемся, что вкладка уже на новом aadvid, а не на старой странице.
async function openBilling(tabId, id, prefixes) {
  await navigate(tabId, billingUrl(id), prefixes);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = String(tab?.url || '');
    if (!url.startsWith(`${ADS}/`) || url.includes(`aadvid=${id}`)) return;
    await wait(300);
  }
}

const PAYMENT_RETRY_MS = 6 * 60 * 60 * 1000;

async function scanBc(tabId, bcId, previous = null) {
  const read = (url, waitMs = 25000) => navigate(tabId, url, `${BC}/`)
    .then(() => runInPageGuarded(tabId, readBcTableInPage, [bcId, waitMs, 15], { stayOn: `${BC}/`, timeoutMs: 120000 }));
  // Finance → Payment management иногда бесконечно крутит spinner: после таймаута статусы берём из Accounts,
  // а саму страницу Finance в ближайшие часы не дёргаем (иначе каждая проверка теряла бы по 25 секунд).
  const skipPayment = previous?.paymentTimeout && Date.now() - (previous.at || 0) < PAYMENT_RETRY_MS;
  let table = skipPayment ? null : await read(bcPaymentUrl(bcId));
  let source = 'payment';
  const financeAccessRequired = Boolean(table?.financeAccessRequired);
  const paymentTimeout = skipPayment || Boolean(table && !table.lost && !table.error && !table.rows?.length && !table.financeAccessRequired && !table.noAccess);
  if (!table || table.lost || table.error || !table.rows?.length) {
    const fallback = await read(bcAccountsUrl(bcId), 20000);
    if (!fallback?.rows?.length) return { ok: false, error: fallback?.error || table?.error || 'Business Center не показал список РК.', financeAccessRequired, noAccess: Boolean(fallback?.noAccess || table?.noAccess), paymentTimeout };
    table = fallback;
    source = 'accounts';
  }
  return { ok: true, source, rows: parseBcRows(table), financeAccessRequired, paymentTimeout };
}

async function run(job, { bcIds, adsTargets }) {
  const release = keepAlive();
  const tabs = new Set();
  const prefixes = [`${ADS}/`, `${BC}/`];
  try {
    if (bcIds.length) {
      job.phase = 'bc';
      const tab = await openTab(bcPaymentUrl(bcIds[0]), `${BC}/`);
      tabs.add(tab.id);
      for (const bcId of bcIds) {
        if (active?.cancel) break;
        job.current = { bcId };
        await save(job);
        let outcome;
        try { outcome = await scanBc(tab.id, bcId, (await cached()).bcs[bcId]); } catch (error) {
          if (error?.code === 'login') { job.fatal = error.message; break; }
          outcome = { ok: false, error: String(error?.message || error).slice(0, 240) };
        }
        const at = Date.now();
        await patchCache((cache) => {
          cache.bcs[bcId] = { at, ok: outcome.ok, error: outcome.error || '', source: outcome.source || '', financeAccessRequired: outcome.financeAccessRequired === true, paymentTimeout: outcome.paymentTimeout === true, count: outcome.rows?.length || 0 };
          for (const row of outcome.rows || []) {
            const prev = cache.accounts[row.id] || { id: row.id };
            cache.accounts[row.id] = { ...prev, id: row.id, at, bc: { at, bcId, source: outcome.source, name: row.name, status: row.status, threshold: row.threshold, billingDate: row.billingDate, balance: row.balance, spend: row.spend } };
          }
        });
        job.done += 1;
        if (!outcome.ok) job.failed += 1;
        await save(job);
      }
    }

    if (!job.fatal && !active?.cancel && adsTargets.length) {
      job.phase = 'ads';
      job.current = null;
      await save(job);
      const queue = [...adsTargets];
      const reuse = [...tabs][0] || null;
      const worker = async (index) => {
        let tabId = index === 0 ? reuse : null;
        while (queue.length && !active?.cancel && !job.fatal) {
          const id = queue.shift();
          job.current = { accountId: id };
          let entry;
          try {
            if (tabId) await openBilling(tabId, id, prefixes);
            else { tabId = (await openTab(billingUrl(id), prefixes)).id; tabs.add(tabId); }
            entry = adsEntry(await runInPageGuarded(tabId, readAdsBillingPageInPage, [id, 15000], { stayOn: prefixes, timeoutMs: 45000 }));
          } catch (error) {
            if (error?.code === 'login') { job.fatal = error.message; break; }
            if (error?.code === 'tab_closed') { tabs.delete(tabId); tabId = null; }
            entry = { ok: false, error: String(error?.message || error).slice(0, 240) };
          }
          if (entry.login) { job.fatal = entry.error; break; }
          const at = Date.now();
          await patchCache((cache) => { cache.accounts[id] = { ...(cache.accounts[id] || { id }), id, at, ads: { at, ...entry } }; });
          job.done += 1;
          if (!entry.ok) job.failed += 1;
          await save(job);
          await wait(250);
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(job.concurrency, adsTargets.length)) }, (_, index) => worker(index)));
    }

    job.current = null;
    job.completedAt = Date.now();
    job.state = job.fatal ? 'error' : active?.cancel ? 'cancelled' : job.failed ? 'partial' : 'complete';
    if (job.fatal) job.error = job.fatal;
    await save(job);
    log(job.state === 'complete' ? 'info' : 'warn', 'health', `Проверка РК: ${job.done - job.failed}/${job.total} без ошибок — ${job.state}${job.error ? ` (${job.error})` : ''}`);
    finished(job);
  } catch (error) {
    job.state = 'error';
    job.error = String(error?.message || error).slice(0, 300);
    job.completedAt = Date.now();
    await save(job);
    log('warn', 'health', `Проверка РК остановлена: ${job.error}`);
  } finally {
    for (const tabId of tabs) await closeTab(tabId);
    release();
  }
}

// input: { accountIds?, force?, skipBc?, skipAds?, concurrency? }. Без accountIds — все кабинеты из кэша списка.
export async function start(input = {}) {
  if (active) throw new HubError('Проверка уже идёт — дождитесь окончания или остановите её.');
  const list = await accounts.cached();
  const known = new Map((list?.accounts || []).map((a) => [a.id, a]));
  let ids = idList(input.accountIds);
  if (!ids.length) ids = [...known.keys()];
  if (!ids.length) throw new HubError('Нет кабинетов для проверки. Откройте Ads Manager и обновите вкладку «Обзор».');
  ids = ids.slice(0, MAX_ACCOUNTS);
  const force = input.force === true;
  const cache = await cached();
  const fresh = (at) => !force && at && Date.now() - at < FRESH_MS;
  const extraBc = idList(input.businessCenterIds);
  const bcIds = input.skipBc ? [] : [...new Set([...ids.map((id) => known.get(id)?.bcId || cache.accounts[id]?.bc?.bcId || ''), ...extraBc].filter((id) => ID.test(id)))]
    .filter((bcId) => !fresh(cache.bcs[bcId]?.at));
  const adsTargets = input.skipAds ? [] : ids.filter((id) => !fresh(cache.accounts[id]?.ads?.at));
  const job = {
    id: crypto.randomUUID(), state: 'running', phase: bcIds.length ? 'bc' : 'ads', startedAt: Date.now(),
    total: bcIds.length + adsTargets.length, done: 0, failed: 0, bcTotal: bcIds.length, adsTotal: adsTargets.length,
    accounts: ids.length, concurrency: Math.min(3, Math.max(1, Math.round(Number(input.concurrency) || 2)))
  };
  if (!job.total) {
    Object.assign(job, { state: 'complete', completedAt: Date.now(), note: 'Данные свежие (моложе 30 мин). Для перепроверки используйте «Перепроверить».' });
    return save(job);
  }
  await save(job);
  active = { id: job.id, cancel: false };
  run(job, { bcIds, adsTargets }).finally(() => { if (active?.id === job.id) active = null; });
  return job;
}

/* ---------- автопроверка по расписанию ---------- */

export const ALARM = 'tth-health';
const BASELINE = 'healthBaseline';
const AUTO_JOB = 'healthAutoJob';

export async function applyAlarm(settings) {
  if (!chrome.alarms) return;
  const { enabled, intervalMin } = settings.health.auto;
  if (!enabled) { await chrome.alarms.clear(ALARM); return; }
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== intervalMin) await chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: intervalMin });
}

async function autoTick() {
  const settings = await getSettings();
  if (!settings.health.auto.enabled || active) return;
  const list = await accounts.cached();
  const ids = (list?.accounts || []).map((account) => account.id);
  if (!ids.length) return;
  const job = await start({ accountIds: ids, force: true, concurrency: settings.health.concurrency, skipBc: !settings.health.includeBc });
  await chrome.storage.local.set({ [AUTO_JOB]: job.id });
}

// Базовая линия обновляется после каждой проверки, а оповещение — только после автоматической: так ручная проверка не порождает «новых» проблем.
async function afterJob(job) {
  const list = await accounts.cached();
  const cache = await cached();
  const next = flagMap(list?.accounts || [], cache.accounts);
  const stored = (await chrome.storage.local.get([BASELINE, AUTO_JOB]));
  await chrome.storage.local.set({ [BASELINE]: next });
  if (stored[AUTO_JOB] !== job.id || !stored[BASELINE]) return;
  const problems = newProblems(stored[BASELINE], next);
  if (!problems.length) return;
  const names = Object.fromEntries((list?.accounts || []).map((account) => [account.id, account.name]));
  const message = alertText(problems, names);
  log('warn', 'health', `Новые проблемы: ${message.replace(/\n/g, '; ')}`);
  const settings = await getSettings();
  if (settings.health.auto.notify && chrome.notifications?.create) {
    await chrome.notifications.create(`tth-health-${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon-128.png'), title: 'TTAds Hub: проблемы с РК', message, priority: 1 }).catch(() => {});
  }
}

export function registerHealthMonitor() {
  completionHooks.push(afterJob);
  chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) autoTick().catch((error) => log('warn', 'health', `Автопроверка: ${String(error?.message || error).slice(0, 200)}`)); });
  getSettings().then(applyAlarm).catch(() => {});
}
