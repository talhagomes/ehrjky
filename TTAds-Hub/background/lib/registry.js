// Локальный реестр РК, созданных/расшаренных расширением: из него выбирают кабинеты для шаринга и экспорта.
import { withLock } from './storage.js';

const KEY = 'createdAssets';
const LIMIT = 500;
const ID = /^\d{5,30}$/;
const text = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function list() {
  const items = (await chrome.storage.local.get(KEY))[KEY];
  return Array.isArray(items) ? items : [];
}

function mergeShares(previous = [], next = []) {
  const byTarget = new Map();
  for (const share of [...previous, ...next]) {
    if (!ID.test(String(share?.targetBusinessCenterId || ''))) continue;
    byTarget.set(share.targetBusinessCenterId, { ...(byTarget.get(share.targetBusinessCenterId) || {}), ...share });
  }
  return [...byTarget.values()].slice(-20);
}

function clean(entry) {
  const out = { adAccountId: String(entry.adAccountId) };
  for (const key of ['adAccountName', 'businessCenterId', 'businessCenterName', 'companyId', 'source']) {
    if (entry[key] !== undefined) out[key] = text(entry[key]);
  }
  if (entry.createdAt) out.createdAt = Number(entry.createdAt) || Date.now();
  if (entry.portfolio !== undefined) out.portfolio = entry.portfolio ? { id: text(entry.portfolio.id, 30), name: text(entry.portfolio.name, 120), linked: entry.portfolio.linked === true } : null;
  if (Array.isArray(entry.shares)) out.shares = entry.shares;
  return out;
}

export function upsert(entry) {
  if (!ID.test(String(entry?.adAccountId || ''))) return Promise.resolve(null);
  return withLock(KEY, async () => {
    const items = await list();
    const next = clean(entry);
    const index = items.findIndex((item) => item.adAccountId === next.adAccountId);
    const previous = index >= 0 ? items.splice(index, 1)[0] : { createdAt: Date.now(), shares: [] };
    const merged = { ...previous, ...next, shares: mergeShares(previous.shares, next.shares), updatedAt: Date.now() };
    items.unshift(merged);
    if (items.length > LIMIT) items.length = LIMIT;
    await chrome.storage.local.set({ [KEY]: items });
    return merged;
  });
}

// Отмечает результат шаринга; неизвестные расширению РК тоже попадают в реестр, чтобы их было видно в истории.
export async function recordShare(accountIds, share, extra = {}) {
  for (const adAccountId of accountIds) {
    await upsert({ adAccountId, ...extra, shares: [{ ...share, at: Date.now() }] });
  }
}

export function remove(ids) {
  const drop = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  return withLock(KEY, async () => {
    const items = (await list()).filter((item) => !drop.has(item.adAccountId));
    await chrome.storage.local.set({ [KEY]: items });
    return items;
  });
}

export function clear() {
  return withLock(KEY, async () => { await chrome.storage.local.remove(KEY); return []; });
}
