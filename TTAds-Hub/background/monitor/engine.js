// Фоновая проверка кабинетов: по таймеру читает состояние через открытую вкладку Ads Manager,
// показывает число проблемных кабинетов на значке и (по желанию) присылает уведомление о новых проблемах.
import { getSettings, patchSettings, log } from '../lib/storage.js';
import { problemsOf, diffProblems, badgeText, notificationFor, badgeTitle } from './logic.js';
import * as overview from '../overview/engine.js';

export const ALARM = 'tth-monitor';
const STATE = 'monitorState';
let running = null;

export const getState = async () => (await chrome.storage.local.get(STATE))[STATE] ?? null;

async function setBadge(count, at, extra) {
  try {
    await chrome.action.setBadgeText({ text: badgeText(count) });
    await chrome.action.setBadgeBackgroundColor({ color: '#fe2c55' });
    await chrome.action.setTitle({ title: badgeTitle(count, at, extra) });
  } catch { /* значок необязателен */ }
}

// Создаёт или снимает таймер по настройкам (alarms переживают перезапуск воркера, но не гарантированно — браузера).
export async function applyAlarm(settings) {
  if (!chrome.alarms) return;
  const { enabled, intervalMin } = settings.monitor;
  if (!enabled) { await chrome.alarms.clear(ALARM); await setBadge(0, 0); return; }
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== intervalMin) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: intervalMin });
}

async function findAdsTab(preferredId) {
  const tabs = await chrome.tabs.query({ url: 'https://ads.tiktok.com/*' });
  const usable = tabs.filter((t) => !t.discarded && t.status === 'complete');
  return usable.find((t) => t.id === preferredId) ?? usable.find((t) => t.active) ?? usable.find((t) => /aadvid=\d/.test(t.url ?? '')) ?? usable[0] ?? null;
}

async function notify(note) {
  if (!chrome.notifications?.create) return false;
  try {
    await chrome.notifications.create(`tth-problem-${note.accountId}-${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon-128.png'), title: note.title, message: note.message, priority: 1 });
    return true;
  } catch { return false; }
}

export function tick({ reason = 'alarm', tabId } = {}) {
  if (running) return running;
  running = (async () => {
    const settings = await getSettings();
    if (reason === 'alarm' && !settings.monitor.enabled) return null;
    const previous = await getState();
    try {
      const tab = await findAdsTab(tabId);
      if (!tab) {
        const state = { ...(previous ?? {}), at: Date.now(), ok: false, error: 'Нет открытой вкладки TikTok Ads — проверка пропущена.', problems: previous?.problems ?? [] };
        await chrome.storage.local.set({ [STATE]: state });
        return state;
      }
      const scan = await overview.scan(tab.id, { force: true, period: 'today', persist: false });
      const problems = problemsOf(scan.accounts);
      // Первая успешная проверка — только базовая линия (значок без уведомления). Сбойные проверки базовую линию не сбрасывают:
      // проблемы, появившиеся пока вкладки не было, будут замечены следующей успешной проверкой.
      const diff = previous?.baselined ? diffProblems(previous.problems ?? [], problems) : { added: [], worsened: [], resolved: [] };
      const state = { at: Date.now(), ok: true, baselined: true, problems, accounts: scan.accounts.length, total: scan.totalAccounts, truncated: scan.truncated, reason };
      await chrome.storage.local.set({ [STATE]: state });
      await setBadge(problems.length, state.at, { total: scan.totalAccounts, checked: scan.accounts.length });
      const note = notificationFor(diff, problems.length);
      let notified = false;
      if (note && settings.monitor.notify) notified = await notify(note);
      if (diff.added.length || diff.worsened.length || diff.resolved.length) {
        await log(diff.added.length || diff.worsened.length ? 'warn' : 'info', 'monitor',
          `Проверка: проблем ${problems.length} (новых ${diff.added.length}, ухудшилось ${diff.worsened.length}, исправлено ${diff.resolved.length})${notified ? ', уведомление отправлено' : ''}`);
      }
      return { ...state, diff, notified };
    } catch (e) {
      const state = { ...(previous ?? {}), at: Date.now(), ok: false, error: String(e?.message ?? e).slice(0, 200), problems: previous?.problems ?? [] };
      await chrome.storage.local.set({ [STATE]: state });
      await log('warn', 'monitor', `Проверка не удалась: ${state.error}`);
      return state;
    }
  })().finally(() => { running = null; });
  return running;
}

let clicksHooked = false;
function hookNotificationClicks() {
  if (clicksHooked || !chrome.notifications?.onClicked) return;
  clicksHooked = true;
  chrome.notifications.onClicked.addListener((id) => {
    const account = /^tth-problem-(\d+)-/.exec(id)?.[1];
    chrome.notifications.clear(id);
    if (account) chrome.tabs.create({ url: `https://ads.tiktok.com/i18n/manage/campaign?aadvid=${account}` });
  });
}

export function registerMonitor() {
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) tick({ reason: 'alarm' }); });
  }
  const restore = () => getSettings().then(applyAlarm).catch(() => {});
  chrome.runtime.onStartup.addListener(restore);
  chrome.runtime.onInstalled.addListener(restore);
  hookNotificationClicks();
  // Разрешение на уведомления выдаётся диалогом браузера (popup мог закрыться) — состояние флага синхронизируем здесь.
  chrome.permissions?.onAdded?.addListener((p) => {
    if (!p.permissions?.includes('notifications')) return;
    hookNotificationClicks();
    getSettings().then((s) => patchSettings({ monitor: { ...s.monitor, notify: true } })).catch(() => {});
  });
  chrome.permissions?.onRemoved?.addListener((p) => {
    if (p.permissions?.includes('notifications')) getSettings().then((s) => patchSettings({ monitor: { ...s.monitor, notify: false } })).catch(() => {});
  });
}
