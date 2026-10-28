// Фоновые вкладки TikTok для DOM-сценариев: открыть, дождаться загрузки, перейти, показать пользователю.
import { HubError, wait } from './page.js';

const LOGIN = /\/(?:login|signin|sso)(?:[/?#]|$)/i;

export async function waitForTab(tabId, urlPrefix, timeoutMs = 40000) {
  const prefixes = (Array.isArray(urlPrefix) ? urlPrefix : [urlPrefix]).filter(Boolean);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new HubError('Вкладка TikTok была закрыта.', 'tab_closed');
    const url = String(tab.url || '');
    if (tab.status === 'complete' && prefixes.some((prefix) => url.startsWith(prefix))) return tab;
    if (tab.status === 'complete' && LOGIN.test(new URL(url || 'about:blank').pathname)) {
      throw new HubError('TikTok просит войти в аккаунт. Авторизуйтесь в business.tiktok.com и повторите.', 'login');
    }
    await wait(250);
  }
  throw new HubError('TikTok слишком долго загружает страницу.', 'timeout');
}

export async function openTab(url, urlPrefix = url.split('?')[0], { active = false } = {}) {
  const tab = await chrome.tabs.create({ url, active });
  await waitForTab(tab.id, urlPrefix);
  return tab;
}

// Переход в уже открытой вкладке; ждём смены страницы, чтобы не принять старую за загруженную.
export async function navigate(tabId, url, urlPrefix = url.split('?')[0]) {
  await chrome.tabs.update(tabId, { url });
  await wait(400);
  return waitForTab(tabId, urlPrefix);
}

export async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  return tab;
}

export const closeTab = (tabId) => chrome.tabs.remove(tabId).catch(() => {});

// Пока идёт длинный сценарий, периодический вызов API не даёт Chrome усыпить сервис-воркер.
export function keepAlive() {
  const timer = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
  return () => clearInterval(timer);
}
