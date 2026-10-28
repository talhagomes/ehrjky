// TTAds Hub — сервис-воркер: маршрутизация сообщений интерфейса и движки инструментов.
import { friendlyError, HubError, parseAdsUrl, requireAdsTab } from './lib/page.js';
import { clearJournal, getSettings, log, patchSettings, readJournal, saveSettings } from './lib/storage.js';
import { VERSION } from './lib/constants.js';
import * as manual from './manual/engine.js';
import * as appeals from './appeals/engine.js';
import * as overview from './overview/engine.js';
import * as accounts from './accounts/engine.js';
import * as explorer from './explorer/engine.js';
import * as monitor from './monitor/engine.js';
import * as billing from './billing/engine.js';
import * as creation from './creation/engine.js';
import * as access from './access/engine.js';
import * as pipeline from './pipeline/engine.js';
import * as share from './share/engine.js';
import * as registry from './lib/registry.js';
import * as health from './health/engine.js';
import * as objects from './objects/engine.js';
import { registerRecorder, startLearn, stopLearn } from './objects/learn.js';
import { registerOmnibox, suggestFor, enter as omniboxEnter, currentContext } from './links/omnibox.js';
import { registerContextTracking, getLastContext } from './links/context.js';
import { sendTestEvent } from './s2s/events.js';
import { createPixelInPage } from './s2s/pixel.js';
import { runInPage } from './lib/page.js';

// Слушатели регистрируются синхронно при загрузке воркера (требование MV3).
manual.registerManualListeners();
registerContextTracking();
registerOmnibox();
monitor.registerMonitor();
registerRecorder();
health.registerHealthMonitor();

chrome.runtime.onInstalled.addListener((details) => {
  log('info', 'sys', details.reason === 'install' ? `Установлен TTAds Hub ${VERSION}` : `TTAds Hub обновлён до ${VERSION}`);
});

// Связь со страницей: если агент ещё не внедрён (вкладку открыли до установки), внедряем его и повторяем.
async function agentCall(tabId, message) {
  const send = () => chrome.tabs.sendMessage(tabId, message);
  try { return await send(); } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/agent.js'] });
      return await send();
    } catch { return null; }
  }
}

const handlers = {
  'accounts.list': ({ tabId, force }) => accounts.list(tabId, { force: Boolean(force) }),
  'accounts.cached': () => accounts.cached(),
  'context.get': () => getLastContext(),
  'overview.scan': ({ tabId, period, force }) => overview.scan(tabId, { period: typeof period === 'string' ? period : '7d', force: Boolean(force) }),
  'overview.cached': () => overview.cached(),
  'explorer.load': ({ tabId, account, level, period }) => explorer.load(tabId, { account, level, period }),
  'monitor.status': async () => ({ state: await monitor.getState(), alarm: (await chrome.alarms?.get(monitor.ALARM)) ?? null }),
  'monitor.run': ({ tabId }) => monitor.tick({ reason: 'manual', tabId }),
  'billing.inspect': ({ tabId, accountId }) => billing.inspect(tabId, accountId),
  'billing.probe': ({ accountId, bcId }) => billing.probe({ accountId, bcId }),
  'billing.open': ({ accountId, bcId }) => billing.open({ accountId, bcId }),
  'billing.start': ({ accountId, bcId }) => billing.start({ accountId, bcId }),
  'creation.start': ({ input }) => creation.start(input),
  // «BC + РК в один клик» запускает конвейер с сохранёнными настройками (Portfolio/шаринг — если включены).
  'creation.quick': () => pipeline.start({ count: 1, mode: 'new-bc' }),
  'creation.prepare': ({ input }) => creation.prepare(input),
  'creation.status': () => creation.status(),
  'creation.openLast': () => creation.openLast(),
  'creation.confirmPayment': () => creation.confirmPayment(),
  'pipeline.start': ({ input }) => pipeline.start(input),
  'pipeline.status': () => pipeline.status(),
  'pipeline.cancel': () => pipeline.cancel(),
  'pipeline.resume': () => pipeline.resume(),
  'pipeline.openTab': ({ index }) => pipeline.openTab(index),
  'share.start': ({ input }) => share.start(input),
  'share.status': () => share.status(),
  'share.resume': () => share.resume(),
  'share.openLast': () => share.openLast(),
  'registry.list': () => registry.list(),
  'registry.remove': ({ ids }) => registry.remove(ids),
  'registry.clear': () => registry.clear(),
  'access.inspect': ({ businessCenterId }) => access.inspect({ businessCenterId }),
  'access.request': ({ input }) => access.requestAccess(input),
  'access.transfer': ({ input }) => access.transfer(input),
  'access.linkPortfolio': ({ input }) => access.linkPortfolio(input),
  'access.batch': ({ input }) => access.runGroups(input),
  'access.status': () => access.status(),
  // Проверка РК: статус, билл (порог), долг, баланс, карта — по всем или выбранным кабинетам.
  'health.start': async ({ input }) => {
    const settings = await getSettings();
    return health.start({ concurrency: settings.health.concurrency, skipBc: !settings.health.includeBc, ...(input || {}) });
  },
  'health.status': () => health.status(),
  'health.cancel': () => health.cancel(),
  'health.cached': () => health.cached(),
  'health.clear': () => health.clear(),
  // Массовые вкл/выкл, имя и бюджет по контрактам, снятым с реального запроса TikTok.
  'objects.status': () => objects.status(),
  'objects.learnStart': ({ input }) => startLearn(input || {}),
  'objects.learnStop': async () => { await stopLearn(); return { ok: true }; },
  'objects.plan': ({ input }) => objects.plan(input),
  'objects.apply': ({ input }) => objects.apply(input),
  'objects.rollback': () => objects.rollback(),
  'objects.cancel': () => objects.cancel(),
  'objects.diagnostics': () => objects.diagnostics(),
  'objects.reset': async () => { await objects.reset(); return objects.status(); },
  'access.openLast': () => access.openLast(),
  'manual.status': async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const info = parseAdsUrl(tab?.url ?? '');
    if (!tab || !info.ok) return { onAds: false, url: tab?.url ?? '' };
    const [state, agent] = await Promise.all([manual.getState(tabId, tab.url), agentCall(tabId, { type: 'agent.info' })]);
    return { onAds: true, url: tab.url, state, agent };
  },
  'manual.activate': async ({ tabId, account }) => {
    const { tab, info } = await requireAdsTab(tabId);
    if (account && info.account !== account) throw new HubError('Кабинет на вкладке изменился. Проверьте экран и повторите.');
    const result = await manual.activate(tabId, tab.url);
    if (result?.error) throw new HubError(result.error);
    return result;
  },
  'manual.cancel': ({ tabId }) => manual.cancel(tabId),
  'manual.timezone': async ({ tabId }) => {
    await requireAdsTab(tabId);
    return (await agentCall(tabId, { type: 'agent.timezone' })) ?? { page: null };
  },
  'manual.interceptor': async ({ tabId, enabled }) => {
    await requireAdsTab(tabId);
    const settings = await getSettings();
    const reply = await agentCall(tabId, { type: 'agent.setInterceptor', enabled: Boolean(enabled), fields: settings.manual.fields });
    if (!reply?.ok) throw new HubError('Не удалось переключить режим. Обновите страницу TikTok (F5) и повторите.');
    log('info', 'mnl', enabled ? 'Перехват флагов включён, страница перезагружается' : 'Перехват флагов выключен, страница перезагружается');
    return { ok: true };
  },

  'appeals.scan': ({ tabId }) => appeals.scan(tabId),
  'appeals.resolve': ({ tabId, account, rows }) => appeals.resolveNested(tabId, account, rows),
  'appeals.start': ({ tabId, account, rows, text, reason }) => appeals.startBatch({ tabId, account, rows, text, reason }),
  'appeals.batch': () => appeals.getBatch(),
  'appeals.cancel': () => appeals.cancelBatch(),
  'appeals.history': () => appeals.history(),
  'appeals.unblock': ({ jobId }) => appeals.unblock(jobId),
  'appeals.clear': () => appeals.clearHistory(),

  's2s.test': async ({ input }) => {
    const result = await sendTestEvent(input);
    log(result.ok ? 'info' : 'warn', 's2s', `Тест события ${input.event} (API ${result.api}): ${result.ok ? 'принято' : `код ${result.code ?? result.http}: ${result.message}`}`);
    return result;
  },
  's2s.pixel': async ({ tabId, options }) => {
    const { info } = await requireAdsTab(tabId);
    if (!info.account) throw new HubError('В адресе вкладки нет aadvid. Откройте нужный рекламный кабинет.');
    const result = await runInPage(tabId, createPixelInPage, [{ ...options, aadvid: info.account }]);
    if (!result || result.error) throw new HubError(result?.error || 'Не удалось создать пиксель.');
    log('info', 's2s', `Создан пиксель ${result.pixelCode}${result.devToken ? ' (token получен)' : ' (token не получен)'}`);
    return result;
  },

  'journal.get': () => readJournal(),
  'journal.clear': async () => { await clearJournal(); return { ok: true }; },
  'settings.get': () => getSettings(),
  'settings.save': async ({ settings }) => { const saved = await saveSettings(settings); await monitor.applyAlarm(saved); await health.applyAlarm(saved); return saved; },
  'settings.patch': async ({ patch }) => { const saved = await patchSettings(patch); if (patch?.monitor) await monitor.applyAlarm(saved); if (patch?.health) await health.applyAlarm(saved); return saved; }
};

// Хуки для автотестов: позволяют проверить omnibox и мониторинг без реального ввода в адресную строку и ожидания таймера.
globalThis.__tth = { omnibox: { suggestFor, enter: omniboxEnter, currentContext }, monitor, accounts, overview, health };

// Токен-бакет: не больше ~1 записи MNL в секунду (всплеск до 60), чтобы страница не вытеснила журнал.
const mnlBucket = { tokens: 60, at: Date.now() };
function allowMnlLog() {
  const now = Date.now();
  mnlBucket.tokens = Math.min(60, mnlBucket.tokens + (now - mnlBucket.at) / 1000);
  mnlBucket.at = now;
  if (mnlBucket.tokens < 1) return false;
  mnlBucket.tokens -= 1;
  return true;
}

function handleAgentMessage(message, sender) {
  if (message.type !== 'edits' || !sender.tab || !parseAdsUrl(sender.tab.url ?? '').ok) return;
  const merged = new Map();
  for (const item of Array.isArray(message.items) ? message.items.slice(0, 20) : []) {
    const text = `${item.direction === 'response' ? '←' : '→'} ${String(item.path || '').slice(0, 120)}: ${(item.keys || []).map(String).join(', ')}`;
    merged.set(text, (merged.get(text) ?? 0) + 1);
  }
  for (const [text, count] of merged) if (allowMnlLog()) log('info', 'mnl', count > 1 ? `${text} ×${count}` : text);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  if (message.ns === 'agent') { handleAgentMessage(message, sender); return false; }
  // Команды принимаем только от страниц самого расширения.
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  const handler = handlers[`${message.ns}.${message.type}`];
  if (!handler) return false;
  handler(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: friendlyError(error), code: error?.code ?? 'error' })
  );
  return true;
});
