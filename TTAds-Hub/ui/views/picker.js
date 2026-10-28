// Быстрый переключатель кабинетов: поиск, группировка по Business Center, переход на выбранный кабинет без смены страницы.
import { h, fill, copyText, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import { normalizeText } from '../../background/links/catalog.js';
import { ACCOUNT_STATES } from '../../background/overview/model.js';

export function openAccountPicker(ctx) {
  let query = '', states = new Map(), loading = false;
  const list = h('div', { class: 'picker-list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск по названию, ID или Business Center', 'aria-label': 'Поиск кабинета' });
  const note = h('p', { class: 'hint' });

  function groups(accounts) {
    const map = new Map();
    for (const a of accounts) {
      const key = a.businessCenter || '';
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return [...map].sort((x, y) => (x[0] === '' ? 1 : y[0] === '' ? -1 : x[0].localeCompare(y[0], 'ru')));
  }

  function row(a) {
    const current = a.id === ctx.account;
    const state = states.get(a.id);
    return h('div', { class: `picker-row${current ? ' current' : ''}` },
      h('button', { class: 'picker-main', type: 'button', disabled: current, 'aria-label': `Открыть кабинет ${a.name}`, onclick: async () => { const moved = await ctx.switchAccount(a.id); if (moved) closeSheet(); } },
        h('span', { class: `status-dot ${state === 'delivering' ? 'ok' : state === 'issue' || state === 'error' ? 'warn' : ''}`, title: state ? ACCOUNT_STATES[state]?.[0] : '' }),
        h('span', { class: 'picker-text' }, h('b', null, a.name), h('small', { class: 'mono' }, `…${a.id.slice(-8)} · ${[a.country, a.currency].filter(Boolean).join(' · ') || '—'}`)),
        current ? h('span', { class: 'pill cyan' }, 'сейчас') : null),
      h('button', { class: 'icon-btn', type: 'button', title: 'Скопировать ID', 'aria-label': 'Скопировать ID кабинета', onclick: async () => { if (await copyText(a.id)) toast('ID кабинета скопирован', 'ok'); } }, icon('copy', 14)));
  }

  function render() {
    const cache = ctx.accounts.peek();
    const q = normalizeText(query);
    const accounts = (cache?.accounts ?? []).filter((a) => !q || normalizeText(`${a.name} ${a.id} ${a.businessCenter} ${a.country}`).includes(q));
    if (!cache?.accounts?.length) {
      fill(list, h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('users', 22)), h('h3', null, loading ? 'Загружаю кабинеты…' : 'Список кабинетов пуст'),
        h('p', null, ctx.onAds ? 'Нажмите «Обновить список», чтобы прочитать доступные кабинеты.' : 'Откройте ads.tiktok.com в активной вкладке, затем обновите список.')));
    } else if (!accounts.length) {
      fill(list, h('div', { class: 'empty' }, h('h3', null, 'Ничего не найдено'), h('p', null, 'Измените запрос.')));
    } else {
      fill(list, groups(accounts).map(([bc, items]) => h('section', { class: 'picker-group' },
        h('div', { class: 'section-label' }, bc || 'Без Business Center', ` · ${items.length}`), ...items.map(row))));
    }
    note.textContent = cache?.at ? `Обновлено ${new Date(cache.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · кабинетов: ${cache.accounts?.length ?? 0}` : '';
  }

  async function refresh(force) {
    loading = true; render();
    try { await ctx.accounts.get({ force }); } catch (error) { toast(error.message, 'error'); }
    loading = false; render();
  }

  search.addEventListener('input', () => { query = search.value; render(); });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = list.querySelector('.picker-main:not([disabled])');
    if (first) first.click();
  });
  const refreshBtn = h('button', { class: 'btn', type: 'button', onclick: () => refresh(true) }, icon('refresh', 14), 'Обновить список');
  const copyBtn = h('button', { class: 'btn', type: 'button', disabled: !ctx.account, onclick: async () => { if (await copyText(ctx.account)) toast('ID текущего кабинета скопирован', 'ok'); } }, icon('copy', 14), 'ID текущего');
  openSheet({ title: 'Кабинеты', body: [search, note, list], foot: [refreshBtn, copyBtn], kind: 'picker' });
  render();
  bus.overview.cached().then((cache) => { states = new Map((cache?.accounts ?? []).map((a) => [a.id, a.state])); render(); }).catch(() => {});
  if (!ctx.accounts.peek()?.accounts?.length) refresh(false);
}
