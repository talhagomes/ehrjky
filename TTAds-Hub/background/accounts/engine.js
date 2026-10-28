// Кэш списка кабинетов и Business Center: нужен быстрым ссылкам, переключателю кабинетов и omnibox без лишних запросов.
import { HubError, requireAdsTab, runInPage } from '../lib/page.js';
import { listAccountsInPage } from '../data/page-scripts.js';

const KEY = 'accountsCache';
const FRESH_MS = 10 * 60 * 1000;
let inflight = null;

export async function cached() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? null;
}

export async function remember(listResult) {
  if (listResult?.accounts) await chrome.storage.local.set({ [KEY]: listResult });
  return listResult;
}

export function list(tabId, { force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const hit = await cached();
    if (!force && hit && Date.now() - (hit.at ?? 0) < FRESH_MS) return hit;
    const { tab, info } = await requireAdsTab(tabId);
    const result = await runInPage(tab.id, listAccountsInPage, [info.account || '']);
    if (!result) throw new HubError('Не удалось прочитать список кабинетов. Обновите страницу и повторите.');
    if (result.error) {
      if (hit) return { ...hit, stale: true, error: result.error };
      throw new HubError(result.error);
    }
    return remember(result);
  })().finally(() => { inflight = null; });
  return inflight;
}

export function accountBc(cache, accountId) {
  return cache?.accounts?.find((a) => a.id === accountId)?.bcId || '';
}
