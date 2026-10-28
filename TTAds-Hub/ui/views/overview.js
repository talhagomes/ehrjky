// Вкладка «Обзор»: все кабинеты и Business Center, состояние рекламы, причины недоставки, быстрые переходы,
// метки/заметки, фильтры, экспорт и переход к просмотру кампаний, адсетов и объявлений кабинета.
import { h, fill, copyText, toast, download } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { money, clock, ago } from '../lib/format.js';
import { PERIODS, META_COLORS } from '../../background/lib/constants.js';
import { LINK_BY_ID, resolveLink } from '../../background/links/catalog.js';
import { ACCOUNT_STATES, countAccounts, filterAccounts, sortAccounts, spendByCurrency, needsTopUp, accountsToCsv } from '../../background/overview/model.js';
import { mountExplorer } from './explorer.js';

const FILTERS = [['all', 'Все'], ['issues', 'Проблемы'], ['working', 'Работают'], ['off', 'Выкл.']];
const SORTS = [['problems', 'Проблемы'], ['spend', 'Расход ↓'], ['name', 'Название']];
const COLOR_NAMES = { gray: 'серый', red: 'красный', orange: 'оранжевый', yellow: 'жёлтый', green: 'зелёный', blue: 'синий', purple: 'фиолетовый' };

export function mountOverview(root, ctx) {
  const S = { data: null, loading: false, error: '', soft: false, q: '', metaOpen: new Set(), exportOpen: false, seq: 0, monitor: null, quickRunning: false, quickJob: null };
  let stopped = false, unmountExplorer = null;
  const base = ctx.settings?.overview ?? { period: '7d', sort: 'problems', filter: 'all' };
  const prefs = { ...base };
  const ov = () => prefs;
  const setPref = (patch) => { Object.assign(prefs, patch); ctx.saveSettings({ overview: { ...prefs } }).catch(() => {}); };
  const meta = () => ctx.settings?.accounts?.meta ?? {};

  const toolbar = h('div', { class: 'row ov-toolbar' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: название, ID, BC, метка', 'aria-label': 'Поиск кабинетов', autocomplete: 'off' });
  const sortSelect = h('select', { class: 'select', 'aria-label': 'Сортировка' }, SORTS.map(([v, t]) => h('option', { value: v, selected: v === ov().sort }, t)));
  const searchRow = h('div', { class: 'row ov-search' }, h('div', { class: 'search', style: { flex: '1' } }, icon('search', 14), search), sortSelect);
  const chips = h('div', { class: 'ov-chips', role: 'group', 'aria-label': 'Фильтр' });
  const summary = h('div', { class: 'stack' });
  const cards = h('div', { class: 'stack ov-cards' });
  const foot = h('div', { class: 'ov-foot' });
  const quick = h('div');
  const listPane = h('div', { class: 'stack' }, quick, toolbar, searchRow, chips, summary, cards, foot);
  const explorePane = h('div', { hidden: true });
  root.append(listPane, explorePane);

  /* ---------- данные ---------- */
  async function load({ force = false } = {}) {
    if (!ctx.tabId || !ctx.onAds) {
      if (!S.data) { S.error = 'Откройте авторизованный TikTok Ads Manager (ads.tiktok.com), затем нажмите «Обновить».'; S.soft = true; render(); }
      else if (force) toast('Откройте вкладку ads.tiktok.com, чтобы обновить данные', 'info');
      return;
    }
    const seq = ++S.seq;
    S.loading = true; S.error = ''; S.soft = false;
    renderToolbar();
    try {
      const data = await bus.overview.scan(ctx.tabId, { period: ov().period, force });
      if (stopped || seq !== S.seq) return;
      S.data = data;
      ctx.accounts.reload();
      ctx.setBadge('overview', countAccounts(data.accounts).issues);
    } catch (e) { if (!stopped && seq === S.seq) S.error = e.message; }
    finally { if (!stopped && seq === S.seq) { S.loading = false; render(); } }
  }

  const refreshMonitor = () => bus.monitor.status().then((m) => { S.monitor = m; renderFoot(); }).catch(() => {});

  // «В один клик» = конвейер с сохранёнными настройками вкладки «Создать» (Portfolio/шаринг — если включены там).
  async function quickCreate() {
    if (S.quickRunning) return;
    S.quickRunning = true; renderQuick();
    try {
      S.quickJob = await bus.creation.quick();
      toast('Создание запущено — окно можно закрыть, прогресс на вкладке «Создать»', 'ok', 6000);
    } catch (error) { toast(error.message, 'error', 7000); }
    S.quickRunning = false;
    if (!stopped) renderQuick();
  }

  const QUICK_LABEL = { running: 'Создаю…', paused: 'Нужно подтверждение TikTok', interrupted: 'Прервано — откройте «Создать»', complete: 'Создано', partial: 'Создано с замечаниями', error: 'Ошибка', cancelled: 'Остановлено' };

  function renderQuick() {
    const job = S.quickJob, item = job?.items?.at(-1), result = item?.result || {};
    const state = job?.state === 'running' && Date.now() - (job.heartbeat || 0) > 5 * 60 * 1000 ? 'interrupted' : job?.state;
    const ok = state === 'complete';
    const attention = ['paused', 'error', 'partial', 'interrupted'].includes(state);
    const busy = S.quickRunning || state === 'running';
    const auto = ctx.settings?.automation;
    const extras = ['Текущая Company', 'авто-имена', auto?.linkPortfolio ? 'общая карта' : '', auto?.share?.enabled && auto.share.targets?.length ? `шаринг → ${auto.share.targets.length} BC` : ''].filter(Boolean);
    fill(quick,
      h('section', { class: `card quick-create${ok ? ' done' : attention ? ' attention' : ''}` },
        h('div', { class: 'card-head' },
          h('div', null,
            h('div', { class: 'card-title' }, icon('zap', 16), 'BC + РК в один клик'),
            h('p', { class: 'card-sub' }, extras.join(' · '))),
          h('button', { class: 'btn primary', type: 'button', disabled: busy, onclick: quickCreate },
            busy ? h('span', { class: 'spinner' }) : icon('plus', 14), busy ? 'Создаю…' : 'Создать')),
        job ? h('div', { class: `quick-result ${ok ? 'ok' : attention ? 'warn' : ''}` },
          h('span', null, (QUICK_LABEL[state] || state) + (job.items?.length > 1 ? ` · ${job.items.filter((entry) => entry.state === 'done').length}/${job.items.length}` : '')),
          result.businessCenterId ? h('span', { class: 'mono' }, `BC …${result.businessCenterId.slice(-8)}`) : null,
          result.adAccountId ? h('span', { class: 'mono' }, `РК …${result.adAccountId.slice(-8)}`) : null,
          h('button', { class: 'linklike', type: 'button', onclick: () => ctx.show('creation') }, attention ? 'Открыть' : 'Подробнее')) : null));
  }

  /* ---------- быстрые переходы ---------- */
  function go(linkId, a) {
    const r = resolveLink(LINK_BY_ID.get(linkId), { aadvid: a.id, bcid: a.bcId }, ctx.settings?.links?.overrides);
    if (r.ok) ctx.open(r.url); else toast('Не удалось собрать адрес', 'error');
  }

  /* ---------- метки и заметки ---------- */
  async function saveMeta(id, value) {
    const next = { ...meta() };
    if (!value || (!value.label && !value.note && !value.pinned)) delete next[id]; else next[id] = value;
    await ctx.saveSettings({ accounts: { meta: next } });
  }

  function metaEditor(a) {
    const cur = meta()[a.id] ?? { label: '', color: 'gray', note: '', pinned: false };
    let color = cur.color;
    const label = h('input', { class: 'input', value: cur.label, maxlength: '24', placeholder: 'Метка: Прогрев, Спенд, Бан…', 'aria-label': 'Метка' });
    const note = h('textarea', { class: 'textarea', rows: '2', maxlength: '300', placeholder: 'Заметка: карта, прокси, профиль антика…', 'aria-label': 'Заметка' });
    note.value = cur.note;
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Цвет метки' });
    const drawSwatches = () => fill(swatches, META_COLORS.map((c) => h('button', { class: `swatch c-${c}`, type: 'button', role: 'radio', 'aria-checked': String(color === c), title: COLOR_NAMES[c], 'aria-label': COLOR_NAMES[c], onclick: () => { color = c; drawSwatches(); } })));
    drawSwatches();
    return h('div', { class: 'meta-editor' }, label, swatches, note,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { await saveMeta(a.id, { label: label.value.trim(), color, note: note.value.trim(), pinned: cur.pinned }); S.metaOpen.delete(a.id); render(); toast('Метка сохранена', 'ok'); } }, 'Сохранить'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { await saveMeta(a.id, null); S.metaOpen.delete(a.id); render(); } }, 'Очистить'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { S.metaOpen.delete(a.id); render(); } }, 'Закрыть')));
  }

  /* ---------- карточка кабинета ---------- */
  function campaignRow(c, currency) {
    return h('div', { class: 'overview-campaign' },
      h('span', { class: `status-dot ${c.status === 'working' ? 'ok' : c.status === 'issue' ? 'warn' : ''}` }),
      h('div', { class: 'overview-campaign-main' }, h('b', { title: c.name }, c.name), h('span', null, c.status === 'working' ? 'Доставляется' : c.status === 'issue' ? c.reason || 'Не доставляется' : 'Выключена')),
      c.spend > 0 ? h('span', { class: 'mono small' }, money(c.spend, currency)) : null);
  }

  function accountCard(a) {
    const m = meta()[a.id];
    const [label, tone] = ACCOUNT_STATES[a.state] ?? [a.state, ''];
    const current = a.id === ctx.account;
    const pinned = Boolean(m?.pinned);
    const iconBtn = (name, title, onclick, extra = {}) => h('button', { class: `icon-btn${extra.warn ? ' warn' : ''}`, type: 'button', title, 'aria-label': title, onclick, ...extra.attrs }, icon(name, 15));
    return h('section', { class: `card account-card state-${a.state}${current ? ' current' : ''}`, dataset: { id: a.id } },
      h('div', { class: 'card-head' },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' }, a.name, current ? h('span', { class: 'pill cyan' }, 'текущий') : null),
          h('div', { class: 'item-meta' },
            h('button', { class: 'id-chip mono', type: 'button', title: 'Скопировать ID', onclick: async () => { if (await copyText(a.id)) toast('ID кабинета скопирован', 'ok'); } }, `…${a.id.slice(-8)}`),
            a.businessCenter ? h('span', null, a.businessCenter) : null, a.country ? h('span', null, a.country) : null, a.currency ? h('span', null, a.currency) : null,
            m?.label ? h('span', { class: `tag c-${m.color}` }, m.label) : null)),
        h('div', { class: 'col-end' }, h('span', { class: `pill ${tone}` }, label),
          h('button', { class: `icon-btn pin${pinned ? ' on' : ''}`, type: 'button', title: pinned ? 'Открепить' : 'Закрепить сверху', 'aria-label': pinned ? 'Открепить кабинет' : 'Закрепить кабинет', 'aria-pressed': String(pinned),
            onclick: async () => { await saveMeta(a.id, { label: m?.label ?? '', color: m?.color ?? 'gray', note: m?.note ?? '', pinned: !pinned }); render(); } }, icon('star', 15)))),
      a.error ? h('div', { class: 'alert err' }, icon('alert', 14), h('div', null, a.error)) : null,
      a.reasons?.length ? h('div', { class: 'ov-reasons' }, a.reasons.map((r) => h('span', { class: `pill ${r.kind === 'balance' ? 'err' : 'warn'}` }, r.count > 1 ? `${r.text} ×${r.count}` : r.text))) : null,
      m?.note ? h('p', { class: 'ov-note' }, m.note) : null,
      !a.error && a.totalCampaigns ? h('div', { class: 'overview-kpis' },
        h('span', null, h('b', null, a.totalCampaigns), ' камп.'), h('span', null, h('b', null, a.deliveringCampaigns), ' работают'),
        h('span', null, h('b', null, a.problemCampaigns), ' проблем'), h('span', null, h('b', null, money(a.spend, a.currency)), ' расход')) : null,
      a.campaigns?.length ? h('div', { class: 'overview-campaigns' }, a.campaigns.slice(0, 3).map((c) => campaignRow(c, a.currency))) : null,
      S.metaOpen.has(a.id) ? metaEditor(a) : null,
      h('div', { class: 'row ov-actions' },
        iconBtn('list', 'Кампании в Ads Manager', () => go('campaigns', a)),
        needsTopUp(a) ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => go('billing', a) }, icon('card', 13), 'Пополнить') : iconBtn('card', 'Биллинг', () => go('billing', a)),
        iconBtn('target', 'Events Manager (пиксели)', () => go('events', a)),
        iconBtn('link', 'Все ссылки кабинета', () => ctx.show('links', { account: a.id })),
        iconBtn('tag', 'Метка и заметка', () => { if (S.metaOpen.has(a.id)) S.metaOpen.delete(a.id); else S.metaOpen.add(a.id); render(); }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', type: 'button', disabled: a.state === 'error', onclick: () => openExplorer(a) }, 'Подробнее', icon('chevron-right', 13))));
  }

  /* ---------- отрисовка ---------- */
  function renderToolbar() {
    const exportMenu = S.exportOpen ? h('div', { class: 'link-menu ov-export', role: 'menu' },
      h('button', { class: 'btn sm', type: 'button', role: 'menuitem', onclick: () => exportData('csv') }, icon('download', 13), 'CSV'),
      h('button', { class: 'btn sm', type: 'button', role: 'menuitem', onclick: () => exportData('json') }, icon('download', 13), 'JSON')) : null;
    const period = h('select', { class: 'select', 'aria-label': 'Период' }, PERIODS.map((p) => h('option', { value: p.id, selected: p.id === ov().period }, p.title)));
    period.addEventListener('change', () => { setPref({ period: period.value }); load({ force: true }); });
    fill(toolbar,
      h('span', { class: 'section-label' }, 'Кабинеты'),
      h('span', { class: 'spacer' }),
      S.data ? h('span', { class: 'hint', title: new Date(S.data.scannedAt).toLocaleString('ru-RU') }, S.loading ? 'обновляю…' : ago(S.data.scannedAt)) : null,
      period,
      h('button', { class: 'icon-btn bordered', type: 'button', title: 'Обновить', 'aria-label': 'Обновить', disabled: S.loading, onclick: () => load({ force: true }) }, S.loading ? h('span', { class: 'spinner' }) : icon('refresh', 15)),
      h('div', { class: 'menu-anchor' }, h('button', { class: 'icon-btn', type: 'button', title: 'Экспорт', 'aria-label': 'Экспорт', 'aria-expanded': String(S.exportOpen), disabled: !S.data, onclick: () => { S.exportOpen = !S.exportOpen; renderToolbar(); } }, icon('download', 15)), exportMenu));
  }

  function visibleAccounts() {
    if (!S.data) return [];
    return sortAccounts(filterAccounts(S.data.accounts, { filter: ov().filter, q: S.q }, meta()), ov().sort, meta());
  }

  function renderChips() {
    const counts = S.data ? countAccounts(S.data.accounts) : { all: 0, issues: 0, working: 0, off: 0 };
    fill(chips, FILTERS.map(([id, title]) => h('button', { class: `chip${ov().filter === id ? ' on' : ''}${id === 'issues' && counts.issues ? ' warn' : ''}`, type: 'button', 'aria-pressed': String(ov().filter === id),
      onclick: () => { setPref({ filter: id }); render(); } }, title, h('b', null, counts[id]))));
  }

  function renderSummary() {
    if (!S.data) { fill(summary); return; }
    const accounts = S.data.accounts, counts = countAccounts(accounts);
    const withAds = accounts.filter((a) => a.totalCampaigns > 0).length;
    const spend = spendByCurrency(accounts);
    fill(summary,
      h('div', { class: 'stats overview-summary' },
        h('div', { class: 'stat' }, h('b', null, accounts.length), h('span', null, 'Кабинетов')),
        h('div', { class: 'stat' }, h('b', null, withAds), h('span', null, 'С рекламой')),
        h('div', { class: 'stat ok' }, h('b', null, counts.working), h('span', null, 'Работают')),
        h('div', { class: `stat ${counts.issues ? 'warn' : ''}` }, h('b', null, counts.issues), h('span', null, 'Проблем'))),
      spend.length ? h('div', { class: 'ov-spend hint' }, `Расход за период (${S.data.st === S.data.et ? S.data.st : `${S.data.st} — ${S.data.et}`}): `, spend.map((s, i) => h('b', null, `${i ? ' · ' : ''}${money(s.spend, s.currency)}`))) : null,
      S.data.businessCenters?.length ? h('div', { class: 'ov-bc hint' }, icon('building', 12), ` Business Center: ${S.data.businessCenters.map((b) => `${b.name} (${b.accountCount})`).join(' · ')}`) : null,
      S.data.truncated ? h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, `Показаны первые 50 из ${S.data.totalAccounts} кабинетов. Остальные доступны через переключатель кабинетов.`)) : null);
  }

  function renderCards() {
    if (S.error && !S.data) {
      fill(cards, h('div', { class: `alert ${S.soft ? 'info' : 'err'}` }, icon(S.soft ? 'info' : 'alert', 16), h('div', null, S.error)),
        S.soft ? h('button', { class: 'btn primary block', type: 'button', onclick: () => chrome.tabs.create({ url: 'https://ads.tiktok.com/' }) }, icon('external', 15), 'Открыть TikTok Ads Manager') : h('button', { class: 'btn block', type: 'button', onclick: () => load({ force: true }) }, icon('refresh', 14), 'Повторить'));
      return;
    }
    if (!S.data) {
      fill(cards, h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('activity', 24)), h('h3', null, 'Проверяю рекламные кабинеты'), h('p', null, 'Читаю список аккаунтов и текущие статусы кампаний.')));
      return;
    }
    const list = visibleAccounts();
    fill(cards,
      S.error ? h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, `Не удалось обновить: ${S.error}. Показаны последние данные.`)) : null,
      list.length ? list.map(accountCard)
        : h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('list', 24)), h('h3', null, S.data.accounts.length ? 'Ничего не найдено' : 'Кабинеты не найдены'),
          h('p', null, S.data.accounts.length ? 'Измените фильтр или поисковый запрос.' : 'У текущего пользователя нет доступных рекламных кабинетов.')));
  }

  function renderFoot() {
    const m = S.monitor?.state, enabled = ctx.settings?.monitor?.enabled;
    fill(foot,
      h('div', { class: 'row' },
        icon('bell', 14),
        h('span', { class: 'hint', style: { flex: '1' } }, enabled
          ? `Автопроверка каждые ${ctx.settings?.monitor?.intervalMin ?? 15} мин${m?.at ? ` · последняя в ${clock(m.at)}${m.ok === false ? ` (${m.error})` : ` · проблем: ${m.problems?.length ?? 0}`}` : ''}`
          : 'Автопроверка выключена: значок расширения покажет число проблемных кабинетов'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { await ctx.saveSettings({ monitor: { ...(ctx.settings?.monitor ?? {}), enabled: !enabled } }); renderFoot(); refreshMonitor(); toast(!enabled ? 'Автопроверка включена' : 'Автопроверка выключена', 'ok'); } }, enabled ? 'Выключить' : 'Включить')));
  }

  function render() {
    if (stopped) return;
    renderQuick(); renderToolbar(); renderChips(); renderSummary(); renderCards(); renderFoot();
    searchRow.hidden = !S.data;
    chips.hidden = !S.data;
  }

  /* ---------- экспорт ---------- */
  function exportData(kind) {
    S.exportOpen = false; renderToolbar();
    const list = visibleAccounts();
    if (!list.length) { toast('Нечего экспортировать', 'error'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') download(`ttads-accounts-${stamp}.csv`, accountsToCsv(list, meta()), 'text/csv;charset=utf-8');
    else download(`ttads-accounts-${stamp}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), period: S.data.period, from: S.data.st, to: S.data.et, accounts: list.map((a) => ({ ...a, meta: meta()[a.id] ?? null })) }, null, 2), 'application/json');
    toast('Файл сохранён', 'ok');
  }

  /* ---------- переход к просмотру объектов ---------- */
  function openExplorer(a) {
    listPane.hidden = true; explorePane.hidden = false;
    unmountExplorer?.();
    unmountExplorer = mountExplorer(explorePane, ctx, { account: a, onBack: closeExplorer });
    root.scrollTop = 0;
  }
  function closeExplorer() {
    unmountExplorer?.(); unmountExplorer = null;
    fill(explorePane);
    explorePane.hidden = true; listPane.hidden = false;
  }

  search.addEventListener('input', () => { S.q = search.value; renderCards(); });
  sortSelect.addEventListener('change', () => { setPref({ sort: sortSelect.value }); renderCards(); });
  const stopTab = ctx.onTab(() => { if (unmountExplorer) return; if (!S.data) load(); else { renderCards(); } });

  render();
  refreshMonitor();
  bus.pipeline.status().then((job) => { if (!stopped) { S.quickJob = job; renderQuick(); } }).catch(() => {});
  const unwatchQuick = bus.watch(['pipelineJob'], (key, job) => { if (!stopped) { S.quickJob = job; renderQuick(); } });
  bus.overview.cached().then((cached) => { if (cached && !S.data && !stopped) { S.data = cached; render(); } }).catch(() => {});
  load();

  return () => { stopped = true; S.seq += 1; unmountExplorer?.(); stopTab(); unwatchQuick(); };
}
