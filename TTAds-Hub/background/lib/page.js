import { ORIGIN } from './constants.js';

export class HubError extends Error {
  constructor(message, code = 'error') {
    super(message);
    this.name = 'HubError';
    this.code = code;
  }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseAdsUrl(url) {
  try {
    const u = new URL(url);
    return {
      ok: u.origin === ORIGIN,
      url: u,
      path: u.pathname,
      account: u.searchParams.get('aadvid') || u.searchParams.get('advertiser_id') || null,
      draft: u.searchParams.get('campaign_draft_id') || null
    };
  } catch {
    return { ok: false, url: null, path: '', account: null, draft: null };
  }
}

export const accountFromUrl = (url) => parseAdsUrl(url).account;

export async function requireAdsTab(tabId) {
  if (!Number.isInteger(tabId)) throw new HubError('Не выбрана вкладка TikTok Ads Manager.', 'no_tab');
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { throw new HubError('Вкладка закрыта. Откройте TikTok Ads Manager.', 'no_tab'); }
  const info = parseAdsUrl(tab.url ?? '');
  if (!info.ok) throw new HubError('Откройте вкладку TikTok Ads Manager (ads.tiktok.com).', 'not_ads');
  return { tab, info };
}

// Запуск функции в странице. Функция должна быть самодостаточной (без замыканий и импортов).
export async function runInPage(tabId, func, args = [], world = 'MAIN') {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  return frame?.result;
}

// То же, но не зависает, если страница ушла (полная навигация обрывает скрипт без ответа) или TikTok молчит.
// stayOn — префикс URL или массив допустимых префиксов. Уход с них считается навигацией.
export async function runInPageGuarded(tabId, func, args = [], { world = 'MAIN', stayOn = '', timeoutMs = 150000 } = {}) {
  const allowedPrefixes = (Array.isArray(stayOn) ? stayOn : [stayOn]).filter(Boolean);
  let timer = null, settled = false;
  const watcher = new Promise((resolve) => {
    const started = Date.now();
    const poll = async () => {
      if (settled) return;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return resolve({ error: 'Вкладка TikTok была закрыта.', lost: true, closed: true });
      const url = String(tab.url || '');
      if (allowedPrefixes.length && url && !allowedPrefixes.some((prefix) => url.startsWith(prefix))) return resolve({ lost: true, navigatedTo: url });
      if (Date.now() - started > timeoutMs) return resolve({ error: 'TikTok не ответил вовремя.', lost: true, timeout: true });
      timer = setTimeout(poll, 600);
    };
    timer = setTimeout(poll, 600);
  });
  const script = runInPage(tabId, func, args, world).then(
    (result) => result ?? { lost: true },
    (error) => ({ error: String(error?.message || error).slice(0, 300), lost: true })
  );
  try {
    return await Promise.race([script, watcher]);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

export function friendlyError(error) {
  if (error instanceof HubError) return error.message;
  const message = String(error?.message ?? error ?? 'Неизвестная ошибка');
  if (/Cannot access|cannot be scripted|extensions gallery/i.test(message)) return 'Эту страницу нельзя использовать. Откройте ads.tiktok.com.';
  if (/No tab with id|tab was closed|Frame with ID .* was removed/i.test(message)) return 'Вкладка закрыта или перезагружается. Повторите.';
  return message;
}
