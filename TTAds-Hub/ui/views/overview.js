// Вкладка «Обзор»: все кабинеты и Business Center, состояние рекламы, причины недоставки, быстрые переходы,
// метки/заметки, фильтры, экспорт и переход к просмотру кампаний, адсетов и объявлений кабинета.
import { h, fill, copyText, toast, download } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { money, num, clock, ago } from '../lib/format.js';
import { PERIODS, META_COLORS } from '../../background/lib/constants.js';
import { LINK_BY_ID, resolveLink } from '../../background/links/catalog.js';
import { ACCOUNT_STATES, countAccounts, filterAccounts, sortAccounts, spendByCurrency, needsTopUp, accountsToCsv } from '../../background/overview/model.js';
import { mountExplorer } from './explorer.js';
import { describePreset } from './creation.js';
import { healthOf, HEALTH_FILTERS, countFlags, HEALTH_COLUMNS } from '../../background/health/model.js';
import { STATUS_KINDS } from '../../background/health/parse.js';
import { openShareSheet, shareJobBlock, quickShare, quickShareConfig } from './share.js';
import { openTransferSheet, openPortfolioSheet, batchJobBlock } from './bulk.js';
import { openObjectsSheet } from './objects.js';

const HEALTH_FILTER_IDS = new Set(HEALTH_FILTERS.map(([id]) => id));

const FILTERS = [['all', 'Все'], ['issues', 'Проблемы'], ['working', 'Работают'], ['off', 'Выкл.']];
const SORTS = [['problems', 'Проблемы'], ['spend', 'Расход ↓'], ['name', 'Название']];
const COLOR_NAMES = { gray: 'серый', red: 'красный', orange: 'оранжевый', yellow: 'жёлтый', green: 'зелёный', blue: 'синий', purple: 'фиолетовый' };

export function mountOverview(root, ctx) {
  const S = {
    data: null, loading: false, error: '', soft: false, q: '', metaOpen: new Set(), exportOpen: false, seq: 0, monitor: null, quickRunning: false, quickJob: null,
    health: { accounts: {}, bcs: {} }, healthJob: null, selected: new Set(), shareJob: null, batchJob: null, hidden: new Set()
  };
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
  const healthBar = h('div');
  const batchBox = h('div', { class: 'stack' });
  const selectionBar = h('div', { class: 'ov-selection', hidden: true });
  const listPane = h('div', { class: 'stack' }, quick, healthBar, toolbar, searchRow, chips, summary, batchBox, cards, selectionBar, foot);
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

  async function runPreset(preset) {
    if (S.quickRunning) return;
    S.quickRunning = true; renderQuick();
    try {
      S.quickJob = await bus.pipeline.start(preset.config);
      toast(`Профиль «${preset.name}» запущен — прогресс на вкладке «Создать»`, 'ok', 6000);
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
    const presets = auto?.presets || [];
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
          h('button', { class: 'linklike', type: 'button', onclick: () => ctx.show('creation') }, attention ? 'Открыть' : 'Подробнее')) : null,
        presets.length ? h('div', { class: 'preset-row' }, presets.slice(0, 8).map((preset) => h('button', { class: 'btn sm', type: 'button', disabled: busy, title: describePreset(preset.config), onclick: () => runPreset(preset) }, icon('zap', 12), preset.name))) : null));
  }

  /* ---------- проверка РК: статус, билл (порог), долг, баланс, карта ---------- */
  const healthFor = (a) => healthOf(a, S.health.accounts?.[a.id] ?? null);
  const healthRunning = () => S.healthJob?.state === 'running' && Date.now() - (S.healthJob.heartbeat || 0) < 3 * 60 * 1000;

  async function startHealth(ids, force = false) {
    if (!ids?.length) return toast('Нет кабинетов для проверки — обновите список', 'error');
    try {
      S.healthJob = await bus.health.start({ accountIds: ids, force });
      toast(S.healthJob?.note || `Проверяю ${S.healthJob.accounts} РК в фоне — окно можно закрыть`, S.healthJob?.note ? 'info' : 'ok', 6000);
    } catch (error) { toast(error.message, 'error', 7000); }
    renderHealthBar();
  }

  function renderHealthBar() {
    const job = S.healthJob, running = healthRunning();
    const list = S.data?.accounts || [];
    const healths = list.map(healthFor);
    const counts = countFlags(healths);
    const lastAt = Math.max(0, ...healths.map((x) => x.at || 0));
    const selected = S.selected.size;
    const targets = () => (selected ? [...S.selected] : list.map((a) => a.id));
    const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
    fill(healthBar, h('section', { class: `card health-card${running ? ' running' : ''}` },
      h('div', { class: 'card-head' },
        h('div', null,
          h('div', { class: 'card-title' }, icon('shield', 16), 'Статус, билл и карта'),
          h('p', { class: 'card-sub' }, running
            ? `${job.phase === 'bc' ? 'Таблицы Business Center' : 'Платёжные страницы РК'} · ${job.done}/${job.total}`
            : counts.checked ? `Проверено ${counts.checked} из ${list.length}${lastAt ? ` · ${ago(lastAt)}` : ''}` : 'Статус РК, порог автоплатежа (билл), долг, баланс и привязанная карта')),
        running
          ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { S.healthJob = await bus.health.cancel(); } catch (error) { toast(error.message, 'error'); } renderHealthBar(); } }, icon('stop', 13), 'Стоп')
          : h('div', { class: 'row' },
            h('button', { class: 'btn sm primary', type: 'button', disabled: !list.length, onclick: () => startHealth(targets()) }, icon('refresh', 13), selected ? `Проверить ${selected}` : 'Проверить все'),
            counts.checked ? h('button', { class: 'icon-btn', type: 'button', title: 'Перепроверить без кэша (30 мин)', 'aria-label': 'Перепроверить без кэша', onclick: () => startHealth(targets(), true) }, icon('activity', 15)) : null)),
      running ? h('div', { class: `progress${job.done ? '' : ' indeterminate'}` }, h('i', { style: { width: `${pct}%` } })) : null,
      !running && job && ['error', 'partial'].includes(job.state) ? h('p', { class: 'small muted' }, job.error || `Не прочитано: ${job.failed} из ${job.total} — причина в карточке РК.`) : null,
      counts.checked ? h('div', { class: 'health-counts' },
        h('span', { class: 'pill ok' }, `С картой: ${counts.cards}`),
        counts['no-card'] ? h('span', { class: 'pill warn' }, `Без карты: ${counts['no-card']}`) : null,
        counts.debt ? h('span', { class: 'pill err' }, `Долг/оплата: ${counts.debt}`) : null,
        counts.suspended ? h('span', { class: 'pill err' }, `Бан: ${counts.suspended}`) : null,
        counts.review ? h('span', { class: 'pill warn' }, `На проверке: ${counts.review}`) : null) : null));
  }

  function healthBlock(a) {
    const hl = healthFor(a);
    const refresh = h('button', { class: 'linklike', type: 'button', disabled: healthRunning(), onclick: () => startHealth([a.id], true) }, hl.checked ? 'обновить' : 'проверить');
    if (!hl.checked) return h('div', { class: 'health-line' }, h('span', { class: 'small muted' }, 'Статус, билл и карта не проверены'), refresh);
    const tone = STATUS_KINDS[hl.status.kind]?.[1] || '';
    const b = hl.billing, t = b.threshold;
    const parts = [];
    if (t) parts.push(h('span', { title: 'Порог автоплатежа: TikTok спишет сумму с карты, когда расход дойдёт до порога или наступит дата списания' }, 'Билл: ',
      h('b', null, t.used !== null ? `${num(t.used, 2)} / ${money(t.limit, t.currency)}` : money(t.limit, t.currency)), t.pct !== null ? ` (${t.pct}%)` : ''));
    if (b.billingDate) parts.push(h('span', null, `списание ${b.billingDate}`));
    if (b.amountDue?.value > 0) parts.push(h('span', { class: 'err-text' }, 'Долг: ', h('b', null, money(b.amountDue.value, b.amountDue.currency))));
    if (b.balance) parts.push(h('span', null, 'Баланс: ', h('b', null, money(b.balance.value, b.balance.currency))));
    if (b.adCredit?.value > 0) parts.push(h('span', null, 'Кредит: ', h('b', null, money(b.adCredit.value, b.adCredit.currency))));
    if (b.paid) parts.push(h('span', { title: 'Сумма успешных платежей в видимой истории транзакций' }, 'Оплачено: ', h('b', null, money(b.paid.value, b.paid.currency)), ` (${b.paid.count})`));
    if (b.failedCount) parts.push(h('span', { class: 'err-text' }, `Отказов: ${b.failedCount}`));
    return h('div', { class: 'health-box' },
      h('div', { class: 'health-pills' },
        h('span', { class: `pill ${tone}`, title: hl.status.text || '' }, hl.status.label),
        hl.card.label ? h('span', { class: `pill ${hl.card.linked ? 'ok' : hl.card.linked === false ? 'warn' : ''}`, title: hl.card.expiry ? `Срок действия ${hl.card.expiry}` : '' }, icon('card', 11), hl.card.label) : null,
        b.text ? h('span', { class: 'pill' }, b.text) : null,
        b.autopayPaused ? h('span', { class: 'pill err' }, 'Автоплатёж на паузе') : null,
        b.paymentFailed ? h('span', { class: 'pill err' }, 'Платёж не прошёл') : null,
        hl.flags.includes('verify-phone') ? h('span', { class: 'pill warn' }, 'Подтвердить телефон') : null),
      parts.length ? h('div', { class: 'health-kv' }, parts) : null,
      hl.error ? h('p', { class: 'small muted' }, `Платёжная страница: ${hl.error}`) : null,
      h('div', { class: 'health-foot' }, h('span', { class: 'hint' }, `проверено ${ago(hl.at)}`), refresh));
  }

  /* ---------- выбор РК и массовые действия ---------- */
  const selectedAccounts = () => (S.data?.accounts || []).filter((a) => S.selected.has(a.id)).map((a) => ({ id: a.id, bcId: a.bcId, name: a.name }));

  function selectBox(a) {
    const box = h('input', { type: 'checkbox', checked: S.selected.has(a.id), 'aria-label': `Выбрать ${a.name}` });
    box.onchange = () => {
      if (box.checked) S.selected.add(a.id); else S.selected.delete(a.id);
      box.closest('.account-card')?.classList.toggle('selected', box.checked);
      renderSelection(); renderHealthBar();
    };
    return h('label', { class: 'select-box', title: 'Выбрать для массовых действий' }, box);
  }

  function renderSelection() {
    const count = S.selected.size;
    selectionBar.hidden = !count;
    if (!count) { fill(selectionBar); return; }
    const accounts = selectedAccounts();
    const quick = quickShareConfig(ctx);
    const started = (key) => (job) => { S[key] = job; S.hidden.delete(job?.id); renderBatch(); };
    fill(selectionBar,
      h('div', { class: 'row' }, h('b', null, `Выбрано РК: ${count}`), h('span', { class: 'spacer' }),
        h('button', { class: 'linklike', type: 'button', onclick: () => { for (const a of visibleAccounts()) S.selected.add(a.id); render(); } }, 'все видимые'),
        h('button', { class: 'linklike', type: 'button', onclick: () => { S.selected.clear(); render(); } }, 'снять')),
      h('div', { class: 'row wrap sel-actions' },
        quick.targets.length ? h('button', { class: 'btn sm primary', type: 'button', title: 'Расшарить с сохранёнными правами и получателями', onclick: () => quickShare(ctx, accounts, { onStarted: started('shareJob') }) }, icon('zap', 13), `→ ${quick.label}`) : null,
        h('button', { class: `btn sm${quick.targets.length ? '' : ' primary'}`, type: 'button', onclick: () => openShareSheet(ctx, { accounts, onStarted: started('shareJob') }) }, icon('send', 13), quick.targets.length ? 'Выбрать BC…' : 'Расшарить в BC'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openTransferSheet(ctx, { accounts, onStarted: started('batchJob') }) }, icon('swap', 13), 'Передать'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => openPortfolioSheet(ctx, { accounts, onStarted: started('batchJob') }) }, icon('card', 13), 'Общая карта'),
        h('button', { class: 'btn sm', type: 'button', disabled: healthRunning(), onclick: () => startHealth([...S.selected], true) }, icon('shield', 13), 'Проверить'),
        h('button', { class: 'btn sm', type: 'button', title: 'Выключить/включить, переименовать, изменить бюджет у кампаний, адсетов, объявлений', onclick: () => openObjectsSheet(ctx, { accounts: accounts.map(({ id, name }) => ({ id, name })) }) }, icon('layers', 13), 'Кампании…'),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (await copyText([...S.selected].join('\n'))) toast(`Скопировано ID: ${count}`, 'ok'); } }, icon('copy', 13), 'ID')));
  }

  function renderBatch() {
    const fresh = (job) => job && !S.hidden.has(job.id) && (['running', 'needs-user'].includes(job.state) || Date.now() - (job.completedAt || job.startedAt || 0) < 30 * 60 * 1000);
    fill(batchBox,
      fresh(S.shareJob) ? shareJobBlock(S.shareJob, {
        onResume: async () => { try { S.shareJob = await bus.share.resume(); toast('Повторяю шаринг', 'ok'); } catch (error) { toast(error.message, 'error', 7000); } renderBatch(); },
        onOpen: async () => { try { await bus.share.openLast(); if (ctx.mode === 'popup') window.close(); } catch (error) { toast(error.message, 'error'); } }
      }) : null,
      fresh(S.batchJob) ? batchJobBlock(S.batchJob, {
        onOpen: async () => { try { await bus.access.openLast(); if (ctx.mode === 'popup') window.close(); } catch (error) { toast(error.message, 'error'); } },
        onHide: () => { S.hidden.add(S.batchJob.id); renderBatch(); }
      }) : null);
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
    return h('section', { class: `card account-card state-${a.state}${current ? ' current' : ''}${S.selected.has(a.id) ? ' selected' : ''}`, dataset: { id: a.id } },
      h('div', { class: 'card-head' },
        selectBox(a),
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
      healthBlock(a),
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
    const filter = ov().filter, byHealth = HEALTH_FILTER_IDS.has(filter);
    let list = filterAccounts(S.data.accounts, { filter: byHealth ? 'all' : filter, q: S.q }, meta());
    if (byHealth) list = list.filter((a) => healthFor(a).flags.includes(filter));
    return sortAccounts(list, ov().sort, meta());
  }

  function renderChips() {
    const counts = S.data ? countAccounts(S.data.accounts) : { all: 0, issues: 0, working: 0, off: 0 };
    const flags = S.data ? countFlags(S.data.accounts.map(healthFor)) : { checked: 0 };
    fill(chips, FILTERS.map(([id, title]) => h('button', { class: `chip${ov().filter === id ? ' on' : ''}${id === 'issues' && counts.issues ? ' warn' : ''}`, type: 'button', 'aria-pressed': String(ov().filter === id),
      onclick: () => { setPref({ filter: id }); render(); } }, title, h('b', null, counts[id]))),
    flags.checked ? HEALTH_FILTERS.filter(([id]) => flags[id] || ov().filter === id).map(([id, title]) => h('button', { class: `chip${ov().filter === id ? ' on' : ''} warn`, type: 'button', 'aria-pressed': String(ov().filter === id),
      onclick: () => { setPref({ filter: ov().filter === id ? 'all' : id }); render(); } }, title, h('b', null, flags[id] || 0))) : null);
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
    renderQuick(); renderHealthBar(); renderToolbar(); renderChips(); renderSummary(); renderBatch(); renderCards(); renderSelection(); renderFoot();
    searchRow.hidden = !S.data;
    chips.hidden = !S.data;
  }

  /* ---------- экспорт ---------- */
  function exportData(kind) {
    S.exportOpen = false; renderToolbar();
    const list = visibleAccounts();
    if (!list.length) { toast('Нечего экспортировать', 'error'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') download(`ttads-accounts-${stamp}.csv`, accountsToCsv(list, meta(), HEALTH_COLUMNS, healthFor), 'text/csv;charset=utf-8');
    else download(`ttads-accounts-${stamp}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), period: S.data.period, from: S.data.st, to: S.data.et, accounts: list.map((a) => ({ ...a, meta: meta()[a.id] ?? null, health: healthFor(a) })) }, null, 2), 'application/json');
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
  Promise.all([bus.health.cached().catch(() => null), bus.health.status().catch(() => null), bus.share.status().catch(() => null), bus.access.status().catch(() => null)])
    .then(([cache, job, shareJob, accessJob]) => {
      if (stopped) return;
      if (cache) S.health = cache;
      S.healthJob = job; S.shareJob = shareJob; S.batchJob = accessJob;
      render();
    });
  // Во время проверки кэш меняется после каждого РК: перерисовка не чаще раза в 400 мс и без сброса редактора заметки.
  let healthTimer = null;
  const scheduleHealthRender = () => {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      if (stopped || unmountExplorer) return;
      const el = document.activeElement;
      if (el && cards.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox') { renderHealthBar(); renderBatch(); return; }
      render();
    }, 400);
  };
  const unwatchHealth = bus.watch(['healthCache', 'healthJob', 'shareLastJob', 'accessLastJob'], (key, value) => {
    if (key === 'healthCache') S.health = value || { accounts: {}, bcs: {} };
    else if (key === 'healthJob') S.healthJob = value;
    else if (key === 'shareLastJob') S.shareJob = value;
    else S.batchJob = value;
    scheduleHealthRender();
  });
  load();

  return () => { stopped = true; S.seq += 1; clearTimeout(healthTimer); unmountExplorer?.(); stopTab(); unwatchQuick(); unwatchHealth(); };
}
