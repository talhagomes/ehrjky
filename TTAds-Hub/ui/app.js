// TTAds Hub — оболочка интерфейса: вкладки, контекст активной вкладки TikTok, кабинеты, тема, настройки.
import { h, $, clear, toast, copyText, fill } from './lib/dom.js';
import { icon } from './lib/icons.js';
import * as bus from './lib/bus.js';
import { isSafeHttpUrl, switchAccountUrl, parseContext } from '../background/links/catalog.js';
import { mountManual } from './views/manual.js';
import { mountAppeals } from './views/appeals.js';
import { mountS2S } from './views/s2s.js';
import { mountPixel } from './views/pixel.js';
import { mountJournal } from './views/journal.js';
import { openSettings } from './views/settings.js';
import { mountOverview } from './views/overview.js';
import { mountLinks } from './views/links.js';
import { mountBilling } from './views/billing.js';
import { mountCreation } from './views/creation.js';
import { mountAccess } from './views/access.js';
import { openAccountPicker } from './views/picker.js';

const params = new URLSearchParams(location.search);
const fixedTabId = Number(params.get('tab')) || null;
const mode = fixedTabId ? 'window' : 'popup';
document.body.classList.add(mode);

const TABS = [
  { id: 'creation', title: 'Создать', icon: 'plus', mount: mountCreation },
  { id: 'access', title: 'Доступ', icon: 'swap', mount: mountAccess },
  { id: 'overview', title: 'Обзор', icon: 'grid', mount: mountOverview },
  { id: 'links', title: 'Ссылки', icon: 'link', mount: mountLinks },
  { id: 'billing', title: 'Оплата', icon: 'card', mount: mountBilling },
  { id: 'manual', title: 'Manual', icon: 'zap', mount: mountManual },
  { id: 'appeals', title: 'Апелл.', icon: 'send', mount: mountAppeals },
  { id: 'pixel', title: 'Пиксель', icon: 'target', mount: mountPixel },
  { id: 's2s', title: 'S2S', icon: 'package', mount: mountS2S }
];
const PAGES = [...TABS, { id: 'journal', title: 'Журнал', mount: mountJournal }];

const state = { tab: null, settings: null, current: null, previous: null, unmount: null, listeners: new Set(), badges: {}, params: {}, accounts: null, accountsLoading: null };

const accountOf = (url) => parseContext(url ?? '')?.aadvid || '';

const ctx = {
  mode,
  get tab() { return state.tab; },
  get tabId() { return state.tab?.id ?? null; },
  get onAds() { return /^https:\/\/ads\.tiktok\.com\//.test(state.tab?.url ?? ''); },
  get account() { return accountOf(state.tab?.url); },
  get settings() { return state.settings; },
  async saveSettings(patch) {
    state.settings = await bus.settings.patch(patch);
    applyTheme();
    return state.settings;
  },
  onTab(listener) { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  refreshTab: () => refreshTab(true),
  setBadge(tabId, value) { state.badges[tabId] = value; renderTabs(); },
  show(id, params) { if (params) state.params[id] = params; select(id, true); },
  takeParams(id) { const p = state.params[id]; delete state.params[id]; return p ?? null; },
  toast,

  // Список кабинетов и BC: из кэша расширения; при отсутствии — читается через открытую вкладку Ads Manager.
  accounts: {
    peek: () => state.accounts,
    // Перечитывает полный список кабинетов из кэша расширения (обзор проверяет только первые 50 — список им не затирается).
    async reload() {
      try { const data = await bus.accounts.cached(); if (data?.accounts) { state.accounts = data; renderContext(); } } catch { /* кэша ещё нет */ }
      return state.accounts;
    },
    async get({ force = false } = {}) {
      if (!force && state.accounts) return state.accounts;
      if (state.accountsLoading) return state.accountsLoading;
      state.accountsLoading = (async () => {
        try {
          let data = force ? null : await bus.accounts.cached();
          if ((!data || force) && ctx.tabId && ctx.onAds) data = await bus.accounts.list(ctx.tabId, force);
          if (data) { state.accounts = data; renderContext(); }
        } catch (error) { if (force) throw error; }
        return state.accounts;
      })().finally(() => { state.accountsLoading = null; });
      return state.accountsLoading;
    }
  },

  // Открывает адрес в новой или текущей вкладке (по умолчанию — по настройке «Открывать»).
  async open(url, { where = 'auto' } = {}) {
    if (!isSafeHttpUrl(url)) { toast('Адрес небезопасен или некорректен', 'error'); return false; }
    const target = where === 'auto' ? (state.settings?.links?.openIn ?? 'new') : where;
    if (target === 'current' && state.tab?.id != null) await chrome.tabs.update(state.tab.id, { url, active: true });
    else await chrome.tabs.create({ url, active: true });
    if (mode === 'popup') window.close();
    return true;
  },

  // Переключает вкладку на другой кабинет, сохраняя страницу, если это безопасно (список, биллинг, события…).
  async switchAccount(id) {
    await refreshTab(false);
    const target = switchAccountUrl(state.tab?.url ?? '', id);
    if (!target) { toast('Некорректный ID кабинета', 'error'); return false; }
    if (ctx.onAds && state.tab) await chrome.tabs.update(state.tab.id, { url: target.url });
    else await chrome.tabs.create({ url: target.url });
    toast(target.kept ? 'Кабинет переключён, страница сохранена' : 'Открыт список кампаний выбранного кабинета', 'ok');
    if (mode === 'popup') window.close();
    return true;
  }
};

function applyTheme() {
  const pref = state.settings?.ui?.theme ?? 'auto';
  const theme = pref === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = theme;
}

async function resolveTab() {
  try {
    if (fixedTabId) return await chrome.tabs.get(fixedTabId);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch { return null; }
}

async function refreshTab(force = false) {
  const tab = await resolveTab();
  const changed = force || tab?.id !== state.tab?.id || tab?.url !== state.tab?.url;
  state.tab = tab;
  if (changed) { renderContext(); for (const listener of state.listeners) listener(tab); }
}

function renderContext() {
  const line = $('#ctx-line'), chip = $('#btn-account');
  if (!state.tab) { line.textContent = 'Вкладка не найдена'; chip.hidden = true; return; }
  const onBc = /^https:\/\/business\.tiktok\.com\//.test(state.tab.url ?? '');
  if (!ctx.onAds) {
    line.textContent = onBc ? 'Business Center' : 'Откройте ads.tiktok.com';
    chip.hidden = true;
    return;
  }
  const account = ctx.account;
  const known = state.accounts?.accounts?.find((a) => a.id === account);
  line.textContent = account ? `Ads Manager · ${known?.name ?? 'подключён'}` : 'Ads Manager · нет aadvid';
  line.title = known ? `${known.name} · ${account}` : '';
  chip.hidden = false;
  fill(chip, h('span', { class: account ? 'dot' : 'dot warn' }), account ? `…${account.slice(-6)}` : 'нет aadvid', icon('chevron', 12));
  chip.title = 'Сменить кабинет';
  chip.onclick = async () => { await refreshTab(false); openAccountPicker(ctx); };
}

function buildTabs() {
  const nav = clear($('#tabs'));
  for (const tab of TABS) {
    nav.append(h('button', { class: 'tab', type: 'button', role: 'tab', dataset: { tab: tab.id }, onclick: () => select(tab.id) },
      h('span', { class: 'tab-ico' }, icon(tab.icon, 17)), h('span', { class: 'tab-label' }, tab.title)));
  }
  nav.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const index = (TABS.findIndex((t) => t.id === state.current) + step + TABS.length) % TABS.length;
    select(TABS[index].id);
    nav.querySelector(`[data-tab="${TABS[index].id}"]`).focus();
    event.preventDefault();
  });
}

// Обновляем существующие кнопки, а не пересоздаём: так не теряются фокус и клики.
function renderTabs() {
  for (const button of document.querySelectorAll('#tabs .tab')) {
    const id = button.dataset.tab, badge = state.badges[id];
    button.setAttribute('aria-selected', String(id === state.current));
    button.tabIndex = id === state.current || (!TABS.some((t) => t.id === state.current) && id === 'overview') ? 0 : -1;
    const ico = button.querySelector('.tab-ico');
    let mark = ico.querySelector('.badge');
    if (badge && !mark) ico.append(mark = h('span', { class: 'badge' }));
    if (mark) { if (badge) mark.textContent = badge > 99 ? '99+' : String(badge); else mark.remove(); }
  }
  $('#btn-journal').setAttribute('aria-pressed', String(state.current === 'journal'));
}

function select(id, force = false) {
  if (!PAGES.some((t) => t.id === id)) id = 'overview';
  if (state.current === id && state.unmount && !force) return;
  state.unmount?.();
  if (state.current && state.current !== 'journal') state.previous = state.current;
  state.current = id;
  if (id !== 'journal') { try { localStorage.setItem('tth.tab', id); } catch { /* необязательно */ } }
  renderTabs();
  const view = $('#view');
  clear(view);
  view.classList.remove('flush');
  try { state.unmount = PAGES.find((t) => t.id === id).mount(view, ctx) ?? null; }
  catch (error) { state.unmount = null; fill(view, h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, `Раздел не открылся: ${error.message}`))); }
}

async function boot() {
  $('#btn-window').append(icon('external', 17));
  $('#btn-settings').append(icon('sliders', 17));
  $('#btn-journal').append(icon('activity', 17));
  if (mode === 'window') $('#btn-window').hidden = true;
  $('#btn-settings').onclick = () => openSettings(ctx);
  $('#btn-journal').onclick = () => select(state.current === 'journal' ? (state.previous ?? 'overview') : 'journal');
  $('#btn-window').onclick = async () => {
    if (!state.tab) return toast('Нет активной вкладки', 'error');
    await chrome.windows.create({ url: chrome.runtime.getURL(`ui/app.html?tab=${state.tab.id}`), type: 'popup', width: 470, height: 790 });
    window.close();
  };
  buildTabs();
  try { state.settings = await bus.settings.get(); } catch { try { state.settings = await bus.settings.get(); } catch { state.settings = null; } }
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  try { state.accounts = await bus.accounts.cached(); } catch { /* кэша ещё нет */ }
  await refreshTab(true);
  setInterval(() => refreshTab(false), 1500);
  let initial = 'creation';
  try { initial = localStorage.getItem('tth.tab') || 'creation'; } catch { /* необязательно */ }
  select(initial);
}

boot();
