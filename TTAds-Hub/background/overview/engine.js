// Сводка по всем кабинетам: список кабинетов → кампании каждого кабинета за период → состояние и причины.
import { HubError, requireAdsTab, runInPage } from '../lib/page.js';
import { listObjectsInPage } from '../data/page-scripts.js';
import { ROW_KEYS, periodRange } from '../explorer/model.js';
import { summarizeAccount } from './model.js';
import { getSettings } from '../lib/storage.js';
import * as accounts from '../accounts/engine.js';

const KEY = 'overviewCache';
const FRESH_MS = 90 * 1000;
export const SCAN_LIMIT = 50;
const inflight = new Map();
let queue = Promise.resolve(); // проверки идут по одной: параллельные не умножают нагрузку на TikTok

export async function cached() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? null;
}

// Закреплённые кабинеты проверяются первыми — при лимите они не потеряются (порядок остальных сохраняется).
export function pickTargets(list, meta = {}, limit = SCAN_LIMIT) {
  const rank = (a) => (meta[a.id]?.pinned ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

async function run(tabId, { force, period, persist }) {
  if (persist) {
    const hit = await cached();
    if (!force && hit && hit.period === period && Date.now() - hit.scannedAt < FRESH_MS) return { ...hit, fromCache: true };
  }
  const { tab } = await requireAdsTab(tabId);
  const list = await accounts.list(tab.id, { force: true });
  const settings = await getSettings();
  const targets = pickTargets(list.accounts, settings.accounts.meta);
  const range = periodRange(period);
  // Одна страница (до 200 кампаний) на кабинет: полный список грузит просмотр объектов.
  const data = await runInPage(tab.id, listObjectsInPage, [{ accounts: targets, level: 'campaign', ...range, keys: [...ROW_KEYS], pageSize: 200, maxRows: 200, concurrency: 3 }]);
  if (!data) throw new HubError('Не удалось прочитать данные TikTok Ads. Обновите страницу и повторите.');
  if (data.error) throw new HubError(data.error);
  const byId = new Map(data.results.map((r) => [r.id, r]));
  const result = {
    scannedAt: Date.now(), period, ...range, currentAccount: list.currentAccount,
    accounts: targets.map((a) => summarizeAccount(a, byId.get(a.id))),
    businessCenters: list.businessCenters, totalAccounts: list.total, truncated: list.total > targets.length
  };
  // Фоновая проверка (persist: false) не затирает кэш, который показывает вкладка «Обзор» за выбранный период.
  if (persist) await chrome.storage.local.set({ [KEY]: result });
  return result;
}

export function scan(tabId, { force = false, period = '7d', persist = true } = {}) {
  const key = `${period}|${persist}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = queue.then(() => run(tabId, { force, period, persist }));
  queue = job.catch(() => {});
  const promise = job.finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
