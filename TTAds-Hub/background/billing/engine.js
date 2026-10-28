// Привязка способа оплаты: выбирает правильный платежный контур по владельцу РК.
import { HubError, parseAdsUrl, runInPage, wait } from '../lib/page.js';
import { log } from '../lib/storage.js';
import { inspectBillingInPage, openAddPaymentMethodInPage } from './page-scripts.js';

const ADS = 'https://ads.tiktok.com';
const BC = 'https://business.tiktok.com';
const ID = /^\d{5,30}$/;

function requireId(value, label) {
  const id = String(value || '');
  if (!ID.test(id)) throw new HubError(`Не выбран ${label}.`);
  return id;
}

const adsBillingUrl = (accountId) => `${ADS}/i18n/account/payment?aadvid=${encodeURIComponent(accountId)}`;
// Наблюдавшийся маршрут: при отсутствии Finance access показывает экран запроса прав,
// при наличии доступа TikTok переводит пользователя в Payment management.
const bcFinanceUrl = (bcId) => `${BC}/manage/financeRole?org_id=${encodeURIComponent(bcId)}`;

async function waitForTab(tabId, origin, timeoutMs = 25000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new HubError('Платежная вкладка была закрыта.');
    if (tab.status === 'complete' && String(tab.url || '').startsWith(origin)) return tab;
    await wait(250);
  }
  throw new HubError('TikTok слишком долго открывает платежную страницу.');
}

export async function inspect(tabId, accountId) {
  const id = requireId(accountId, 'рекламный кабинет');
  if (!Number.isInteger(tabId)) return { onBilling: false, accountId: id };
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const info = parseAdsUrl(tab?.url || '');
  if (!tab || !info.ok || info.path !== '/i18n/account/payment' || info.account !== id) return { onBilling: false, accountId: id };
  const data = await runInPage(tab.id, inspectBillingInPage, [id, 12000]);
  if (!data || data.error) throw new HubError(data?.error || 'Не удалось прочитать платежный портфель.');
  return { onBilling: true, ...data };
}

export async function probe({ accountId, bcId = '' }) {
  const id = requireId(accountId, 'рекламный кабинет');
  const center = String(bcId || '');
  if (ID.test(center)) {
    return {
      onBilling: false,
      accountId: id,
      mode: 'business-center',
      businessCenterId: center,
      message: 'Статус способов оплаты этого РК доступен в Finance → Payment management Business Center.'
    };
  }
  const tab = await chrome.tabs.create({ url: adsBillingUrl(id), active: false });
  try {
    await waitForTab(tab.id, ADS);
    const data = await runInPage(tab.id, inspectBillingInPage, [id, 16000]);
    if (!data || data.error) throw new HubError(data?.error || 'Не удалось прочитать платежный портфель.');
    return { onBilling: true, mode: 'ads-manager', ...data };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

export async function open({ accountId, bcId = '' }) {
  const id = requireId(accountId, 'рекламный кабинет');
  const center = String(bcId || '');
  const businessCenter = ID.test(center);
  const url = businessCenter ? bcFinanceUrl(center) : adsBillingUrl(id);
  const tab = await chrome.tabs.create({ url, active: true });
  log('info', 'billing', businessCenter ? `Открыт Payment management Business Center ${center} для РК ${id}` : `Открыта оплата РК ${id}`);
  return { ok: true, mode: businessCenter ? 'business-center' : 'ads-manager', tabId: tab.id, url };
}

export async function start({ accountId, bcId = '' }) {
  const id = requireId(accountId, 'рекламный кабинет');
  const center = String(bcId || '');
  if (ID.test(center)) {
    const url = bcFinanceUrl(center);
    const tab = await chrome.tabs.create({ url, active: true });
    log('info', 'billing', `Открыта привязка оплаты через Business Center ${center} для РК ${id}`);
    return {
      ok: true,
      mode: 'business-center',
      tabId: tab.id,
      url,
      message: 'Для РК Business Center способ оплаты добавляется в Finance → Payment management. Нужны права Business Center Admin и роль Finance Manager.'
    };
  }

  // Фоновая вкладка позволяет дождаться загрузки и открыть форму до переключения фокуса.
  const url = adsBillingUrl(id);
  const tab = await chrome.tabs.create({ url, active: false });
  let result;
  try {
    await waitForTab(tab.id, ADS);
    result = await runInPage(tab.id, openAddPaymentMethodInPage, [id, 18000]);
  } catch (error) {
    result = { error: String(error?.message || error).slice(0, 240) };
  }
  await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  if (!result || result.error || !result.opened) {
    const message = result?.error || 'Платежная страница открыта, но форму карты TikTok не показал.';
    log('warn', 'billing', `РК ${id}: ${message}`);
    return { ok: false, mode: 'ads-manager', tabId: tab.id, url, message };
  }
  log('info', 'billing', `Открыта защищенная форма добавления способа оплаты для РК ${id}`);
  return {
    ok: true,
    mode: 'ads-manager',
    tabId: tab.id,
    url,
    iframeOrigin: result.iframeOrigin || '',
    message: 'Введите карту в форме TikTok и нажмите Submit. После проверки она появится в Payment Portfolio выбранного РК.'
  };
}
