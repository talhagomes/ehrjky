// Просмотр объектов кабинета: кампании, адсеты, объявления со статусами, причинами и метриками (только чтение).
import { h, fill, copyText, toast, download } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { num, money, pct, ago } from '../lib/format.js';
import { PERIODS } from '../../background/lib/constants.js';
import { LEVELS, STATUS_FILTERS, SORTS, filterRows, sortRows, totals, toCsv, ROW_COLUMNS } from '../../background/explorer/model.js';
import { LINK_BY_ID, resolveLink } from '../../background/links/catalog.js';
import { openObjectsSheet } from './objects.js';

const LEVEL_LINK = { campaign: 'campaigns', adgroup: 'adgroups', ad: 'ads' };
const PAGE = 60;

export function mountExplorer(root, ctx, { account, onBack }) {
  const settings = () => ctx.settings?.overview ?? { period: '7d' };
  const S = { level: 'campaign', period: settings().period, status: 'all', q: '', sort: 'problems', data: null, loading: false, error: '', expanded: new Set(), limit: PAGE, seq: 0, selected: new Set() };
  const memo = new Map();
  let stopped = false;

  const list = h('div', { class: 'ex-list' });
  const totalsBar = h('div', { class: 'ex-totals' });
  const footer = h('div', { class: 'row wrap' });
  const status = h('div');
  const bulkBar = h('div', { class: 'ov-selection', hidden: true });

  /* ---------- загрузка ---------- */
  async function load(force = false) {
    const key = `${S.level}|${S.period}`;
    const hit = memo.get(key);
    if (!force && hit && Date.now() - hit.fetched < 60000) { S.seq += 1; S.loading = false; S.data = hit.data; S.error = ''; S.limit = PAGE; render(); return; }
    const seq = ++S.seq;
    S.loading = true; S.error = '';
    renderStatus();
    try {
      const data = await bus.explorer.load(ctx.tabId, account.id, S.level, S.period);
      if (stopped || seq !== S.seq) return;
      memo.set(key, { data, fetched: Date.now() });
      S.data = data; S.limit = PAGE;
    } catch (e) { if (!stopped && seq === S.seq) { S.error = e.message; S.data = null; } }
    finally { if (!stopped && seq === S.seq) { S.loading = false; render(); } }
  }

  /* ---------- отрисовка ---------- */
  const rows = () => (S.data ? sortRows(filterRows(S.data.rows, { q: S.q, status: S.status }), S.sort) : []);

  function rowView(r) {
    const open = S.expanded.has(r.id);
    const cur = account.currency;
    const parent = r.level === 'ad' ? [r.adgroupName, r.campaignName].filter(Boolean).join(' · ') : r.level === 'adgroup' ? r.campaignName : '';
    const detail = open ? h('div', { class: 'ex-detail' },
      h('dl', { class: 'kv' },
        h('dt', null, 'Показы'), h('dd', null, num(r.impressions)), h('dt', null, 'Клики'), h('dd', null, num(r.clicks)),
        h('dt', null, 'CTR'), h('dd', null, pct(r.ctr)), h('dt', null, 'CPC'), h('dd', null, money(r.cpc, cur, 3)),
        h('dt', null, 'CPM'), h('dd', null, money(r.cpm, cur)), h('dt', null, 'CVR'), h('dd', null, pct(r.cvr)),
        r.budget ? [h('dt', null, 'Бюджет'), h('dd', null, money(r.budget, cur))] : null,
        h('dt', null, 'ID'), h('dd', null, r.id)),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (await copyText(r.id)) toast('ID скопирован', 'ok'); } }, icon('copy', 13), 'ID'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openLevelPage(false) }, icon('external', 13), 'Открыть список'),
        r.level === 'ad' && r.moderation ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => toAppeals() }, icon('send', 13), 'К апелляциям') : null)) : null;
    const box = h('input', { type: 'checkbox', checked: S.selected.has(r.id), 'aria-label': `Выбрать ${r.name}` });
    box.onchange = () => { if (box.checked) S.selected.add(r.id); else S.selected.delete(r.id); renderBulk(); };
    return h('div', { class: `ex-row status-${r.status}${open ? ' open' : ''}`, role: 'listitem' },
      h('div', { class: 'ex-line' }, h('label', { class: 'select-box', title: 'Выбрать для массового действия' }, box),
        h('button', { class: 'ex-main', type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) S.expanded.delete(r.id); else S.expanded.add(r.id); render(); } },
          h('span', { class: `status-dot ${r.status === 'working' ? 'ok' : r.status === 'issue' ? 'warn' : ''}` }),
          h('span', { class: 'ex-text' }, h('b', { title: r.name }, r.name),
            h('small', null, r.status === 'issue' ? h('span', { class: 'ex-reason' }, r.reason) : r.status === 'off' ? 'Выключено' : 'Доставляется', parent ? ` · ${parent}` : '')),
          h('span', { class: 'ex-metrics' }, h('b', null, money(r.spend, cur)), h('small', null, `${num(r.conversions)} конв.${r.cpa !== null ? ` · CPA ${num(r.cpa, 2)}` : ''}`)))),
      detail);
  }

  function renderStatus() {
    fill(status,
      S.loading ? h('div', { class: 'row hint' }, h('span', { class: 'spinner' }), 'Загружаю данные TikTok…') : null,
      S.error ? h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, S.error), h('button', { class: 'btn sm', type: 'button', onclick: () => load(true) }, 'Повторить')) : null);
  }

  // Выбранные строки: массовое действие работает ровно по ним (ID уходят в движок как есть).
  function renderBulk() {
    const count = S.selected.size;
    bulkBar.hidden = !count;
    if (!count) { fill(bulkBar); return; }
    const open = (action) => openObjectsSheet(ctx, { accounts: [{ id: account.id, name: account.name }], level: S.level, action, ids: { [account.id]: [...S.selected] }, lockLevel: true });
    fill(bulkBar,
      h('div', { class: 'row' }, h('b', null, `Выбрано: ${count}`), h('span', { class: 'spacer' }),
        h('button', { class: 'linklike', type: 'button', onclick: () => { for (const r of rows()) S.selected.add(r.id); render(); } }, 'все видимые'),
        h('button', { class: 'linklike', type: 'button', onclick: () => { S.selected.clear(); render(); } }, 'снять')),
      h('div', { class: 'row wrap sel-actions' },
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => open('disable') }, 'Выключить'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => open('enable') }, 'Включить'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => open('rename') }, 'Имя'),
        S.level === 'ad' ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => open('budget') }, 'Бюджет')));
  }

  function render() {
    renderStatus(); renderBulk();
    const all = rows();
    const cur = account.currency;
    if (S.data) {
      const t = totals(all);
      fill(totalsBar,
        h('span', null, h('b', null, money(t.spend, cur)), ' расход'), h('span', null, h('b', null, num(t.conversions)), ' конв.'),
        h('span', null, 'CPA ', h('b', null, t.cpa === null ? '—' : num(t.cpa, 2))), h('span', null, 'CTR ', h('b', null, pct(t.ctr))),
        h('span', { class: 'spacer' }), h('span', { class: 'hint' }, `${all.length} из ${S.data.total}${S.data.truncated ? ' · загружено не всё' : ''}`));
    } else fill(totalsBar);
    const shown = all.slice(0, S.limit);
    fill(list, S.data && !all.length
      ? h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('list', 22)), h('h3', null, S.data.rows.length ? 'Ничего не найдено' : 'Объектов нет'), h('p', null, S.data.rows.length ? 'Измените фильтр или поиск.' : 'В этом кабинете нет объектов выбранного уровня за период.'))
      : shown.map(rowView));
    fill(footer,
      all.length > shown.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => { S.limit += PAGE; render(); } }, `Показать ещё ${Math.min(PAGE, all.length - shown.length)}`) : null,
      h('span', { class: 'spacer' }),
      S.data ? h('span', { class: 'hint' }, `обновлено ${ago(S.data.at)} · даты по часовому поясу браузера`) : null,
      h('button', { class: 'btn sm', type: 'button', disabled: !all.length, onclick: () => download(`ttads-${S.level}-${account.id}-${S.data.st}_${S.data.et}.csv`, toCsv(all, ROW_COLUMNS), 'text/csv;charset=utf-8') }, icon('download', 13), 'CSV'));
  }

  function openLevelPage(inCurrentTab) {
    const link = LINK_BY_ID.get(LEVEL_LINK[S.level]);
    const r = resolveLink(link, { aadvid: account.id, bcid: account.bcId }, ctx.settings?.links?.overrides);
    if (r.ok) { if (inCurrentTab && ctx.tabId) chrome.tabs.update(ctx.tabId, { url: r.url }); else ctx.open(r.url); }
    return r;
  }

  async function toAppeals() {
    const r = openLevelPage(true);
    if (r.ok) { toast('Отфильтруйте Rejected / Review issue и нажмите «Обновить»', 'info', 6000); ctx.show('appeals'); }
  }

  /* ---------- элементы управления ---------- */
  const periodSelect = h('select', { class: 'select', 'aria-label': 'Период' }, PERIODS.map((p) => h('option', { value: p.id, selected: p.id === S.period }, p.title)));
  periodSelect.addEventListener('change', () => { S.period = periodSelect.value; load(); });
  const levelSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Уровень' });
  const renderLevels = () => fill(levelSeg, LEVELS.map((l) => h('button', { type: 'button', 'aria-pressed': String(S.level === l.id), onclick: () => { S.level = l.id; S.expanded.clear(); S.selected.clear(); renderLevels(); load(); } }, l.title)));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск…', 'aria-label': 'Поиск' });
  search.addEventListener('input', () => { S.q = search.value; S.limit = PAGE; render(); });
  const statusSelect = h('select', { class: 'select', 'aria-label': 'Статус' }, STATUS_FILTERS.map((f) => h('option', { value: f.id }, f.title)));
  statusSelect.addEventListener('change', () => { S.status = statusSelect.value; S.limit = PAGE; render(); });
  const sortSelect = h('select', { class: 'select', 'aria-label': 'Сортировка' }, SORTS.map((s) => h('option', { value: s.id }, s.title)));
  sortSelect.addEventListener('change', () => { S.sort = sortSelect.value; render(); });

  root.append(h('div', { class: 'stack' },
    h('div', { class: 'row ex-head' },
      h('button', { class: 'btn sm', type: 'button', onclick: onBack }, icon('arrow-left', 14), 'Обзор'),
      h('div', { class: 'ex-title' }, h('b', { title: account.name }, account.name), h('small', { class: 'mono' }, `…${account.id.slice(-8)}${account.currency ? ` · ${account.currency}` : ''}`)),
      h('span', { class: 'spacer' }), periodSelect,
      h('button', { class: 'icon-btn', type: 'button', title: 'Обновить', 'aria-label': 'Обновить', onclick: () => load(true) }, icon('refresh', 15))),
    levelSeg,
    h('div', { class: 'row ex-filters' }, h('div', { class: 'search', style: { flex: '1' } }, icon('search', 14), search), statusSelect, sortSelect),
    status, totalsBar, list, footer, bulkBar));

  renderLevels();
  render();
  load();
  return () => { stopped = true; S.seq += 1; };
}
