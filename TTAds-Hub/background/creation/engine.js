// Мастер создания Business Center и рекламного кабинета через официальную форму TikTok.
import { HubError, runInPage, runInPageGuarded, wait } from '../lib/page.js';
import { log } from '../lib/storage.js';
import * as registry from '../lib/registry.js';
import {
  automateAccountCreationInPage,
  inspectAccountCreationInPage,
  inspectPaymentSetupInPage,
  confirmPaymentSetupInPage
} from './page-scripts.js';

const CREATE_URL = 'https://business.tiktok.com/account/create?source=TTADS_HUB';
const PAYMENT_PREFIX = 'https://business.tiktok.com/account/payment-setup';
const CREATE_PREFIX = 'https://business.tiktok.com/account/create';
const KEY = 'creationLastJob';
const ID = /^\d{5,30}$/;

const text = (value, max = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalize(input = {}) {
  const mode = input.mode === 'existing-bc' ? 'existing-bc' : 'new-bc';
  const companyMode = input.companyMode === 'new' ? 'new' : 'existing';
  const plan = {
    mode, companyMode,
    businessCenterId: text(input.businessCenterId, 30),
    businessCenterName: text(input.businessCenterName),
    adAccountName: text(input.adAccountName),
    companyName: text(input.companyName),
    companyWebsite: text(input.companyWebsite, 240),
    contactName: text(input.contactName),
    phone: text(input.phone, 40),
    email: text(input.email, 160),
    industry: text(input.industry)
  };
  if (mode === 'new-bc' && plan.businessCenterName.length < 2) throw new HubError('Укажите имя нового Business Center (минимум 2 символа).');
  if (mode === 'existing-bc' && !ID.test(plan.businessCenterId)) throw new HubError('Выберите существующий Business Center.');
  if (plan.adAccountName.length < 2) throw new HubError('Укажите имя рекламного кабинета (минимум 2 символа).');
  if (companyMode === 'new' && plan.companyName.length < 2) throw new HubError('Для новой Company укажите юридическое название.');
  return plan;
}

async function save(job) {
  const { tab, ...stored } = job;
  await chrome.storage.local.set({ [KEY]: stored });
  return job;
}

async function remember(plan, result) {
  if (!ID.test(String(result?.adAccountId || ''))) return;
  await registry.upsert({
    adAccountId: result.adAccountId,
    adAccountName: result.adAccountName || plan.adAccountName,
    businessCenterId: result.businessCenterId || plan.businessCenterId,
    businessCenterName: plan.mode === 'new-bc' ? plan.businessCenterName : (plan.businessCenterName || ''),
    companyId: result.companyId || '',
    source: 'created'
  }).catch(() => {});
}

async function waitForCreatePage(tabId, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new HubError('Вкладка мастера создания была закрыта.');
    if (tab.status === 'complete' && String(tab.url || '').startsWith('https://business.tiktok.com/')) return tab;
    await wait(250);
  }
  throw new HubError('TikTok слишком долго загружает мастер создания.');
}

const stateOf = (result, submit) => result.success ? 'complete'
  : result.needsUser ? 'needs-user'
    : result.prepared && !submit ? 'prepared'
      : result.pending ? 'pending'
        : result.error ? 'error' : 'pending';

// Один проход мастера. focus=false оставляет вкладку в фоне (конвейер сам решает, когда её показать).
export async function runCreation(input, { submit = true, focus = true } = {}) {
  const plan = normalize(input);
  const job = await save({ id: crypto.randomUUID(), plan, submit, state: 'opening', startedAt: Date.now() });
  const tab = await chrome.tabs.create({ url: CREATE_URL, active: false });
  job.tabId = tab.id;
  await save(job);
  try {
    await waitForCreatePage(tab.id);
    job.state = 'filling';
    await save(job);
    let result = await runInPageGuarded(tab.id, automateAccountCreationInPage, [plan, submit], { stayOn: CREATE_PREFIX, timeoutMs: 150000 });
    // Мастер ушёл со страницы полной навигацией — ID читаем из адреса новой страницы.
    if (result?.lost && !result.closed) {
      await wait(1200);
      const check = await inspectTab(tab.id, plan);
      result = check.state === 'complete' ? { ...check.result, submitted: true, adAccountName: plan.adAccountName }
        : check.state === 'needs-user' ? { ...check.result, needsUser: true }
          : { ...(check.result || {}), error: check.result?.error || result.error || '', pending: !check.result?.error && !result.error };
    }
    if (!result) throw new HubError('TikTok не вернул результат мастера.');
    if (result.closed) throw new HubError(result.error);
    if (result.success && result.paymentSetupPending) {
      const paymentSetup = await runInPage(tab.id, inspectPaymentSetupInPage).catch(() => null);
      if (paymentSetup?.onPaymentSetup) result.paymentSetup = paymentSetup;
    }
    job.result = result;
    job.updatedAt = Date.now();
    job.state = stateOf(result, submit);
    await save(job);
    if (job.state === 'complete') await remember(plan, result);
    if (focus && ['needs-user', 'prepared', 'error', 'pending'].includes(job.state)) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    const action = submit ? 'Автосоздание' : 'Подготовка';
    log(result.error ? 'warn' : 'info', 'create', `${action}: BC «${plan.businessCenterName || plan.businessCenterId}», РК «${plan.adAccountName}» — ${job.state}${result.adAccountId ? ` (РК ${result.adAccountId})` : ''}`);
    return job;
  } catch (error) {
    job.state = 'error';
    job.result = { error: String(error?.message || error).slice(0, 300) };
    job.updatedAt = Date.now();
    await save(job);
    if (focus) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    log('warn', 'create', `Мастер создания: ${job.result.error}`);
    return job;
  }
}

export const start = (input) => runCreation(input, { submit: true });
export const prepare = (input) => runCreation(input, { submit: false });

// Перечитывает состояние вкладки мастера (после ручной проверки личности или закрытия popup).
export async function inspectTab(tabId, plan = {}) {
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab) return { state: 'closed', result: { error: 'Вкладка мастера закрыта.' } };
  const url = String(tab.url || '');
  if (url.startsWith(PAYMENT_PREFIX)) {
    const paymentSetup = await runInPage(tab.id, inspectPaymentSetupInPage).catch(() => null);
    return {
      state: 'complete',
      tab: { id: tab.id, url },
      result: {
        success: true, url,
        businessCenterId: paymentSetup?.businessCenterId || '',
        adAccountId: paymentSetup?.adAccountId || '',
        companyId: paymentSetup?.companyId || '',
        paymentSetupPending: Boolean(paymentSetup?.onPaymentSetup),
        paymentSetup: paymentSetup?.onPaymentSetup ? paymentSetup : undefined
      }
    };
  }
  if (!url.startsWith('https://business.tiktok.com/account/create')) {
    const params = new URL(url || 'https://business.tiktok.com/').searchParams;
    const adAccountId = params.get('aadvid') || params.get('adv_id') || params.get('advertiser_id') || '';
    return {
      state: adAccountId ? 'complete' : 'unknown',
      tab: { id: tab.id, url },
      result: { success: Boolean(adAccountId), url, businessCenterId: params.get('org_id') || params.get('bc_id') || '', adAccountId, companyId: params.get('company_id') || '', paymentSetupPending: false }
    };
  }
  const result = await runInPage(tab.id, inspectAccountCreationInPage, [plan]).catch((error) => ({ error: String(error?.message || error) }));
  return { state: result?.success ? 'complete' : result?.needsUser ? 'needs-user' : result?.error ? 'error' : 'pending', tab: { id: tab.id, url }, result: result || {} };
}

export async function status() {
  const job = (await chrome.storage.local.get(KEY))[KEY] ?? null;
  if (!job?.tabId) return job;
  const check = await inspectTab(job.tabId, job.plan || {});
  if (check.state === 'closed') return { ...job, state: job.state === 'complete' ? 'complete' : 'closed' };
  if (check.state === 'unknown') return { ...job, tab: check.tab };
  const result = { ...(job.result || {}), ...Object.fromEntries(Object.entries(check.result).filter(([, value]) => value !== '' && value !== undefined)) };
  if (job.state === 'complete' && !check.result.paymentSetupPending) result.paymentSetupPending = false;
  const state = check.state === 'pending' ? job.state : check.state;
  const updated = { ...job, state, result, updatedAt: Date.now(), tab: check.tab };
  await save(updated);
  if (state === 'complete' && job.state !== 'complete') await remember(job.plan || {}, result);
  return updated;
}

export async function openLast() {
  const job = await status();
  if (!job?.tabId) throw new HubError('Попыток создания ещё нет.');
  const tab = await chrome.tabs.get(job.tabId).catch(() => null);
  if (!tab) throw new HubError('Вкладка последней попытки уже закрыта.');
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true, tabId: tab.id, url: tab.url || '' };
}

// Связь нового РК с Payment Portfolio, который TikTok сам предложил на странице Payment setup.
export async function confirmPaymentOnTab(tabId, expected = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !String(tab.url || '').startsWith(PAYMENT_PREFIX)) {
    return { error: 'Страница Payment setup этого кабинета уже закрыта или завершена.' };
  }
  let paymentSetup = await runInPageGuarded(tab.id, confirmPaymentSetupInPage, [expected], { stayOn: PAYMENT_PREFIX, timeoutMs: 90000 });
  // После Confirm TikTok может увести вкладку в Ads Manager — скрипт страницы обрывается без ответа.
  if (!paymentSetup || (paymentSetup.lost && !paymentSetup.closed)) {
    await wait(1500);
    const after = await chrome.tabs.get(tab.id).catch(() => null);
    const url = String(after?.url || after?.pendingUrl || '');
    paymentSetup = after && url && !url.startsWith(PAYMENT_PREFIX)
      ? { success: true, linked: true, navigatedTo: url, portfolio: expected.portfolio || null }
      : (paymentSetup || { error: 'TikTok не вернул результат Payment setup.' });
  }
  if (paymentSetup?.success) {
    await registry.upsert({ adAccountId: expected.adAccountId, portfolio: { ...(paymentSetup.portfolio || {}), linked: true } }).catch(() => {});
    log('info', 'create', `Payment Portfolio ${paymentSetup.portfolio?.id || ''} связан с РК ${expected.adAccountId}`.replace(/\s+/g, ' '));
  } else {
    log('warn', 'create', `Payment Portfolio для РК ${expected.adAccountId || '?'}: ${paymentSetup?.error || 'TikTok ещё обрабатывает'}`);
  }
  return paymentSetup || { error: 'TikTok не вернул результат Payment setup.' };
}

// Финансовая связь из вкладки «Создать» — по явному клику пользователя.
export async function confirmPayment() {
  const job = await status();
  if (!job?.tabId) throw new HubError('Сначала создайте Business Center и рекламный кабинет.');
  const expected = { businessCenterId: job.result?.businessCenterId || '', adAccountId: job.result?.adAccountId || '' };
  const paymentSetup = await confirmPaymentOnTab(job.tabId, expected);
  if (paymentSetup?.error && /закрыта или завершена/.test(paymentSetup.error)) throw new HubError(paymentSetup.error);
  const updated = { ...job, result: { ...(job.result || {}), paymentSetupPending: !paymentSetup?.success, paymentSetup }, updatedAt: Date.now() };
  await save(updated);
  if (paymentSetup?.error) await chrome.tabs.update(job.tabId, { active: true }).catch(() => {});
  return updated;
}
