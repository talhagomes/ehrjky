// Запоминает последний кабинет и Business Center, которые пользователь открывал, — для быстрых ссылок и omnibox.
import { parseContext } from './catalog.js';

const KEY = 'lastContext';
let chain = Promise.resolve();

export async function getLastContext() {
  const stored = (await chrome.storage.local.get(KEY))[KEY] ?? {};
  return { aadvid: stored.aadvid || '', bcid: stored.bcid || '' };
}

export function remember(url) {
  const ctx = parseContext(url ?? '');
  if (!ctx || (!ctx.aadvid && !ctx.bcid)) return chain;
  chain = chain.then(async () => {
    const current = await getLastContext();
    const next = { aadvid: ctx.aadvid || current.aadvid, bcid: ctx.bcid || current.bcid };
    if (next.aadvid !== current.aadvid || next.bcid !== current.bcid) await chrome.storage.local.set({ [KEY]: next });
  }).catch(() => {});
  return chain;
}

export function registerContextTracking() {
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    const url = change.url ?? (change.status === 'complete' ? tab?.url : null);
    if (url) remember(url);
  });
}
