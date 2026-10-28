// Управление владением/доступом к РК и массовой связью с Payment Portfolio.
import { HubError, runInPage, wait } from '../lib/page.js';
import { log } from '../lib/storage.js';
import {
  inspectAccountManagementInPage,
  requestAdvertiserAccessInPage,
  transferAdvertisersInPage,
  linkAccountsToPortfolioInPage
} from './page-scripts.js';

const BC = 'https://business.tiktok.com';
const KEY = 'accessLastJob';
const ID = /^\d{5,30}$/;
const accountUrl = (bcId) => `${BC}/manage/accounts/adv?org_id=${encodeURIComponent(bcId)}`;
const financeUrl = (bcId) => `${BC}/manage/financeRole?org_id=${encodeURIComponent(bcId)}`;

const requireId = (value, label) => {
  const id = String(value || '');
  if (!ID.test(id)) throw new HubError(`Некорректный ${label}.`);
  return id;
};

const ids = (values, max = 30) => {
  const list = [...new Set((Array.isArray(values) ? values : String(values || '').split(/[^\d]+/)).map(String).filter((id) => ID.test(id)))];
  if (!list.length) throw new HubError('Не выбраны рекламные кабинеты.');
  if (list.length > max) throw new HubError(`За одну операцию можно обработать не более ${max} РК.`);
  return list;
};

async function save(job) {
  await chrome.storage.local.set({ [KEY]: job });
  return job;
}

async function waitForTab(tabId, urlPrefix = BC, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new HubError('Вкладка Business Center закрыта.');
    if (tab.status === 'complete' && String(tab.url || '').startsWith(urlPrefix)) return tab;
    await wait(250);
  }
  throw new HubError('TikTok слишком долго загружает Business Center.');
}

async function makeJob(type, plan) {
  return save({ id: crypto.randomUUID(), type, plan, state: 'opening', startedAt: Date.now(), results: [] });
}

export async function inspect({ businessCenterId }) {
  const bcId = requireId(businessCenterId, 'Business Center ID');
  const tab = await chrome.tabs.create({ url: accountUrl(bcId), active: false });
  try {
    await waitForTab(tab.id);
    const result = await runInPage(tab.id, inspectAccountManagementInPage, [bcId, 15000]);
    if (!result || result.error) throw new HubError(result?.error || 'Не удалось прочитать Accounts Business Center.');
    return result;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export async function requestAccess(input = {}) {
  const businessCenterId = requireId(input.businessCenterId, 'Business Center ID');
  const accountIds = ids(input.accountIds, 30);
  const permission = ['Admin', 'Operator', 'Analyst'].includes(input.permission) ? input.permission : 'Admin';
  const plan = { businessCenterId, accountIds, permission };
  const job = await makeJob('request-access', plan);
  const tab = await chrome.tabs.create({ url: accountUrl(businessCenterId), active: false });
  job.tabId = tab.id;
  await save(job);
  try {
    for (let index = 0; index < accountIds.length; index += 1) {
      const accountId = accountIds[index];
      job.state = 'requesting'; job.progress = { current: index + 1, total: accountIds.length, accountId };
      await save(job);
      if (index) {
        await chrome.tabs.update(tab.id, { url: accountUrl(businessCenterId) });
        await waitForTab(tab.id);
      } else await waitForTab(tab.id);
      const result = await runInPage(tab.id, requestAdvertiserAccessInPage, [{ businessCenterId, accountId, permission }, true]);
      job.results.push(result || { error: 'TikTok не вернул результат.', accountId });
      await save(job);
    }
    const failed = job.results.filter((result) => result?.error).length;
    const needsUser = job.results.some((result) => result?.needsUser);
    job.state = failed === accountIds.length ? 'error' : needsUser ? 'needs-user' : failed ? 'partial' : 'complete';
    job.completedAt = Date.now();
    await save(job);
    if (job.state === 'complete') await chrome.tabs.remove(tab.id).catch(() => {});
    else await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    log(failed ? 'warn' : 'info', 'access', `Request Access ${permission}: ${accountIds.length - failed}/${accountIds.length} запросов отправлено в BC ${businessCenterId}`);
    return job;
  } catch (error) {
    job.state = 'error';
    job.error = String(error?.message || error).slice(0, 300);
    job.completedAt = Date.now();
    await save(job);
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return job;
  }
}

export async function transfer(input = {}) {
  const sourceBusinessCenterId = requireId(input.sourceBusinessCenterId, 'исходный Business Center ID');
  const targetBusinessCenterId = requireId(input.targetBusinessCenterId, 'Business Center ID получателя');
  if (sourceBusinessCenterId === targetBusinessCenterId) throw new HubError('Исходный и получающий Business Center совпадают.');
  const accountIds = ids(input.accountIds, 30);
  const plan = { sourceBusinessCenterId, targetBusinessCenterId, accountIds };
  const job = await makeJob('transfer', plan);
  const tab = await chrome.tabs.create({ url: accountUrl(sourceBusinessCenterId), active: false });
  job.tabId = tab.id;
  await save(job);
  try {
    await waitForTab(tab.id);
    job.state = 'transferring'; await save(job);
    const result = await runInPage(tab.id, transferAdvertisersInPage, [plan, true]);
    job.results = [result || { error: 'TikTok не вернул результат transfer.' }];
    job.state = result?.success ? 'complete' : result?.needsUser ? 'needs-user' : result?.pending ? 'pending' : 'error';
    job.completedAt = Date.now();
    await save(job);
    if (job.state === 'complete') await chrome.tabs.remove(tab.id).catch(() => {});
    else await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    log(result?.success ? 'info' : 'warn', 'access', `Transfer ${accountIds.length} РК: ${sourceBusinessCenterId} → ${targetBusinessCenterId} — ${job.state}`);
    return job;
  } catch (error) {
    job.state = 'error'; job.error = String(error?.message || error).slice(0, 300); job.completedAt = Date.now();
    await save(job); await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return job;
  }
}

export async function linkPortfolio(input = {}) {
  const businessCenterId = requireId(input.businessCenterId, 'Business Center ID');
  const accountIds = ids(input.accountIds, 300);
  const portfolioId = ID.test(String(input.portfolioId || '')) ? String(input.portfolioId) : '';
  const plan = { businessCenterId, accountIds, portfolioId };
  const job = await makeJob('link-portfolio', plan);
  const tab = await chrome.tabs.create({ url: financeUrl(businessCenterId), active: false });
  job.tabId = tab.id;
  await save(job);
  try {
    await waitForTab(tab.id);
    job.state = 'linking'; await save(job);
    const result = await runInPage(tab.id, linkAccountsToPortfolioInPage, [plan, true]);
    job.results = [result || { error: 'TikTok не вернул результат Payment Portfolio.' }];
    job.state = result?.success ? 'complete' : result?.needsFinanceRole || result?.needsUser ? 'needs-user' : result?.pending ? 'pending' : 'error';
    job.completedAt = Date.now();
    await save(job);
    if (job.state === 'complete') await chrome.tabs.remove(tab.id).catch(() => {});
    else await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    log(result?.success ? 'info' : 'warn', 'access', `Payment Portfolio: ${accountIds.length} РК в BC ${businessCenterId} — ${job.state}`);
    return job;
  } catch (error) {
    job.state = 'error'; job.error = String(error?.message || error).slice(0, 300); job.completedAt = Date.now();
    await save(job); await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    return job;
  }
}

export async function status() {
  const job = (await chrome.storage.local.get(KEY))[KEY] ?? null;
  if (job?.state === 'running' && !batchRunning) return { ...job, state: 'interrupted' };
  if (!job?.tabId || ['complete', 'error', 'partial'].includes(job.state)) return job;
  const tab = await chrome.tabs.get(job.tabId).catch(() => null);
  return tab ? { ...job, tab: { id: tab.id, url: tab.url || '' } } : { ...job, state: 'closed' };
}

/* ---------- Пакет: РК из разных BC → один получатель (transfer) или Payment Portfolio своего BC ---------- */

let batchRunning = null;

// groups: [{ sourceBusinessCenterId, accountIds }]; transfer режется на запросы по 30 РК (лимит TikTok).
export function normalizeGroups(rawGroups, perRequest) {
  const merged = new Map();
  for (const group of Array.isArray(rawGroups) ? rawGroups.slice(0, 50) : []) {
    const bcId = String(group?.sourceBusinessCenterId || group?.businessCenterId || '');
    if (!ID.test(bcId)) continue;
    const list = [...new Set((Array.isArray(group.accountIds) ? group.accountIds : []).map(String).filter((id) => ID.test(id)))];
    merged.set(bcId, [...new Set([...(merged.get(bcId) || []), ...list])]);
  }
  const out = [];
  for (const [bcId, accountIds] of merged) {
    for (let index = 0; index < accountIds.length; index += perRequest) out.push({ sourceBusinessCenterId: bcId, accountIds: accountIds.slice(index, index + perRequest) });
  }
  return out;
}

export async function runGroups(input = {}) {
  if (batchRunning) throw new HubError('Пакетная операция уже выполняется — дождитесь окончания.');
  const type = input.type === 'link-portfolio' ? 'link-portfolio' : 'transfer';
  const groups = normalizeGroups(input.groups, type === 'transfer' ? 30 : 300);
  if (!groups.length) throw new HubError('Не выбраны РК с известным Business Center-владельцем.');
  const targetBusinessCenterId = type === 'transfer' ? requireId(input.targetBusinessCenterId, 'Business Center ID получателя') : '';
  const portfolioId = ID.test(String(input.portfolioId || '')) ? String(input.portfolioId) : '';
  const runnable = groups.filter((group) => group.sourceBusinessCenterId !== targetBusinessCenterId);
  if (!runnable.length) throw new HubError('РК уже принадлежат Business Center получателя.');
  const job = await makeJob(`${type}-batch`, { type, groups: runnable, targetBusinessCenterId, portfolioId });
  job.state = 'running';
  job.progress = { current: 0, total: runnable.length };
  await save(job);
  batchRunning = (async () => {
    let tab = null;
    try {
      for (const [index, group] of runnable.entries()) {
        job.progress = { current: index + 1, total: runnable.length, sourceBusinessCenterId: group.sourceBusinessCenterId };
        await save(job);
        const url = type === 'transfer' ? accountUrl(group.sourceBusinessCenterId) : financeUrl(group.sourceBusinessCenterId);
        if (tab) await chrome.tabs.update(tab.id, { url });
        else tab = await chrome.tabs.create({ url, active: false });
        job.tabId = tab.id;
        await wait(400);
        let result;
        try {
          await waitForTab(tab.id);
          result = type === 'transfer'
            ? await runInPage(tab.id, transferAdvertisersInPage, [{ sourceBusinessCenterId: group.sourceBusinessCenterId, targetBusinessCenterId, accountIds: group.accountIds }, true])
            : await runInPage(tab.id, linkAccountsToPortfolioInPage, [{ businessCenterId: group.sourceBusinessCenterId, accountIds: group.accountIds, portfolioId }, true]);
        } catch (error) {
          result = { error: String(error?.message || error).slice(0, 300) };
        }
        job.results.push({ ...(result || { error: 'TikTok не вернул результат.' }), sourceBusinessCenterId: group.sourceBusinessCenterId, accountIds: group.accountIds });
        await save(job);
        // Проверка личности/ручной шаг: дальше не идём, вкладку показываем пользователю.
        if (result?.needsUser || result?.needsFinanceRole) break;
      }
      const ok = job.results.filter((result) => result.success).length;
      const needsUser = job.results.some((result) => result.needsUser || result.needsFinanceRole);
      job.state = ok === runnable.length ? 'complete' : needsUser ? 'needs-user' : ok ? 'partial' : 'error';
      job.completedAt = Date.now();
      job.progress = null;
      await save(job);
      if (job.state === 'complete' && tab) await chrome.tabs.remove(tab.id).catch(() => {});
      else if (tab) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      const accounts = runnable.reduce((sum, group) => sum + group.accountIds.length, 0);
      log(job.state === 'complete' ? 'info' : 'warn', 'access', type === 'transfer'
        ? `Transfer ${accounts} РК → BC ${targetBusinessCenterId}: ${ok}/${runnable.length} запросов, ${job.state}`
        : `Payment Portfolio: ${accounts} РК в ${runnable.length} BC — ${job.state}`);
    } catch (error) {
      job.state = 'error'; job.error = String(error?.message || error).slice(0, 300); job.completedAt = Date.now();
      await save(job);
    }
  })().finally(() => { batchRunning = null; });
  return job;
}

export async function openLast() {
  const job = await status();
  if (!job?.tabId) throw new HubError('Операций доступа ещё нет.');
  const tab = await chrome.tabs.get(job.tabId).catch(() => null);
  if (!tab) throw new HubError('Вкладка последней операции уже закрыта.');
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true, tabId: tab.id, url: tab.url || '' };
}
