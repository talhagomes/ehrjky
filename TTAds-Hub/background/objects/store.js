// Хранилище контрактов и сессии обучения + чтение объектов кабинета через проверенный список статистики.
import { ORIGIN } from '../lib/constants.js';
import { HubError } from '../lib/page.js';
import { withLock } from '../lib/storage.js';
import * as explorer from '../explorer/engine.js';

const CONTRACTS = 'objectContracts';
const LEARN = 'objectsLearn';
const JOB = 'objectsJob';

export const getContracts = async () => (await chrome.storage.local.get(CONTRACTS))[CONTRACTS] ?? {};

export function saveVariant(variant, key) {
  return withLock(CONTRACTS, async () => {
    const store = await getContracts();
    const entry = store[variant.endpoint] ?? { variants: {} };
    entry.variants[key] = variant;
    entry.updatedAt = Date.now();
    store[variant.endpoint] = entry;
    await chrome.storage.local.set({ [CONTRACTS]: store });
    return store;
  });
}

export const clearContracts = () => withLock(CONTRACTS, () => chrome.storage.local.remove(CONTRACTS));

// Отключает вариант (не удаляет: форма запроса нужна для диагностики). Новое обучение заменяет вариант целиком.
export function invalidateVariant(endpointId, key, reason) {
  return withLock(CONTRACTS, async () => {
    const store = await getContracts();
    const variant = store[endpointId]?.variants?.[key];
    if (!variant) return store;
    variant.invalid = { at: Date.now(), reason: String(reason || 'unknown').slice(0, 40) };
    await chrome.storage.local.set({ [CONTRACTS]: store });
    return store;
  });
}

export const getSession = async () => (await chrome.storage.local.get(LEARN))[LEARN] ?? null;
export const setSession = (session) => (session ? chrome.storage.local.set({ [LEARN]: session }) : chrome.storage.local.remove(LEARN));
export async function patchSession(patch) {
  return withLock(LEARN, async () => {
    const session = await getSession();
    if (!session) return null;
    const next = { ...session, ...patch };
    await chrome.storage.local.set({ [LEARN]: next });
    return next;
  });
}

export const getJob = async () => (await chrome.storage.local.get(JOB))[JOB] ?? null;
export const setJob = (job) => chrome.storage.local.set({ [JOB]: job });

export async function pickAdsTab(preferredId) {
  const tabs = await chrome.tabs.query({ url: `${ORIGIN}/*` });
  const usable = tabs.filter((tab) => !tab.discarded && tab.status === 'complete');
  const tab = usable.find((item) => item.id === preferredId) ?? usable.find((item) => item.active) ?? usable.find((item) => /aadvid=\d/.test(item.url ?? '')) ?? usable[0];
  if (!tab) throw new HubError('Откройте вкладку TikTok Ads Manager (ads.tiktok.com).', 'no_tab');
  return tab;
}

// Строки объектов уровня за сегодня (нужны состояние, имя и бюджет, метрики не важны).
export async function readRows(account, level, tabId) {
  const tab = await pickAdsTab(tabId);
  const data = await explorer.load(tab.id, { account, level, period: 'today' });
  return { rows: data.rows, tabId: tab.id, truncated: Boolean(data.truncated) };
}

export const stateOf = (row) => ({ enabled: row.enabled, name: row.name, budget: row.budget });
