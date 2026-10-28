// Главный сценарий: создать РК (или BC + РК) в один клик → (опц.) общая карта → (опц.) расшарить в другой BC.
// Ниже — живой прогресс конвейера и список созданных РК, из которого можно расшарить любые кабинеты.
import { h, fill, toast, copyText, download, debounce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { openShareSheet, shareJobBlock, targetPicker, permissionSelect, switchRow, checkRow, short, quickShare, quickShareConfig } from './share.js';

const ID = /^\d{5,30}$/;
const DEFAULTS = {
  mode: 'new-bc', count: 1, businessCenterId: '', bcTemplate: 'BC {date}-{rand}', adTemplate: 'RK {date}-{rand}-{n}',
  linkPortfolio: false, closeTabs: true, share: { enabled: false, targets: [], permission: 'Admin', autoAccept: true },
  transfer: { enabled: false, targetBusinessCenterId: '' }, partners: [], presets: []
};

// Короткое описание профиля для подсказок: «5 × РК · карта · шаринг → 2 BC».
export function describePreset(config = {}) {
  return [`${config.count || 1} × ${config.mode === 'existing-bc' ? 'РК в BC' : 'BC + РК'}`, config.linkPortfolio ? 'карта' : '',
    config.share?.enabled ? `шаринг → ${config.share.targets?.length || 0} BC` : '', config.transfer?.enabled ? 'transfer' : ''].filter(Boolean).join(' · ');
}
const pad = (n) => String(n).padStart(2, '0');
const tail = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(-4).toUpperCase().padStart(4, 'X');
const renderName = (template, n, rand) => {
  const now = new Date();
  return String(template || '').replaceAll('{date}', `${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
    .replaceAll('{time}', `${pad(now.getHours())}${pad(now.getMinutes())}`).replaceAll('{n}', String(n)).replaceAll('{rand}', rand).trim().slice(0, 100);
};

const ITEM_STATE = {
  queued: ['Ожидает', ''], creating: ['Создаётся…', 'info'], paused: ['Нужна проверка', 'warn'], created: ['Создан', 'ok'],
  paying: ['Portfolio…', 'info'], sharing: ['Шаринг…', 'info'], 'share-paused': ['Шаринг ждёт', 'warn'], transferring: ['Transfer…', 'info'],
  done: ['Готово', 'ok'], error: ['Ошибка', 'err'], cancelled: ['Отменено', '']
};
const JOB_STATE = {
  running: 'выполняется', paused: 'пауза — нужно действие в TikTok', interrupted: 'прерван (расширение перезапускалось)',
  complete: 'готово', partial: 'готово с замечаниями', error: 'остановлен с ошибкой', cancelled: 'остановлен'
};
const ACTIVE = ['running', 'paused', 'interrupted'];

export function mountCreation(root, ctx) {
  const saved = ctx.settings?.automation || {};
  let auto = { ...DEFAULTS, ...saved, share: { ...DEFAULTS.share, ...(saved.share || {}) }, transfer: { ...DEFAULTS.transfer, ...(saved.transfer || {}) }, partners: [...(saved.partners || [])], presets: [...(saved.presets || [])] };
  let company = { companyMode: 'existing', companyName: '', companyWebsite: '', contactName: '', phone: '', email: '' };
  let job = null, shareJob = null, created = [], starting = false, showJob = false, stopped = false, pendingRender = false;
  const selected = new Set();
  const host = h('div', { class: 'stack' });
  root.append(host);

  const persist = debounce(() => { ctx.saveSettings({ automation: auto }).catch(() => {}); }, 350);
  const setAuto = (patch, rerender = true) => { auto = { ...auto, ...patch }; persist(); if (rerender) render(); };
  const setShare = (patch, rerender = true) => setAuto({ share: { ...auto.share, ...patch } }, rerender);
  const handoff = () => (auto.share.enabled ? 'share' : auto.transfer.enabled ? 'transfer' : 'none');
  const setHandoff = (mode) => setAuto({ share: { ...auto.share, enabled: mode === 'share' }, transfer: { ...auto.transfer, enabled: mode === 'transfer' } });

  /* ---------- профили ---------- */
  const presetConfig = () => { const { partners, presets, ...config } = auto; return JSON.parse(JSON.stringify(config)); };
  let naming = false;
  function commitPreset(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) return toast('Введите название профиля', 'error');
    const preset = { id: `p${Date.now().toString(36)}`, name: clean, config: presetConfig() };
    naming = false;
    setAuto({ presets: [preset, ...auto.presets.filter((item) => item.name !== preset.name)].slice(0, 12) });
    toast('Профиль сохранён — его можно запускать в 1 клик из «Обзора»', 'ok', 5000);
  }
  function applyPreset(preset) {
    setAuto({ ...DEFAULTS, ...preset.config, share: { ...DEFAULTS.share, ...(preset.config.share || {}) }, transfer: { ...DEFAULTS.transfer, ...(preset.config.transfer || {}) }, partners: auto.partners, presets: auto.presets });
    toast(`Профиль «${preset.name}» подставлен`, 'ok');
  }
  function presetsRow() {
    const input = naming ? h('input', { class: 'input', maxlength: '40', value: describePreset(auto), 'aria-label': 'Название профиля', style: { flex: '1', minWidth: '140px' } }) : null;
    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); commitPreset(input.value); }
        if (event.key === 'Escape') { event.stopPropagation(); naming = false; render(); }
      });
      queueMicrotask(() => { input.focus(); input.select(); });
    }
    return h('div', { class: 'preset-row' },
      auto.presets.map((preset) => h('span', { class: 'target-chip' },
        h('button', { type: 'button', class: 'target-main', title: describePreset(preset.config), onclick: () => applyPreset(preset) }, icon('star', 12), h('span', null, preset.name)),
        h('button', { type: 'button', class: 'target-del', title: 'Удалить профиль', 'aria-label': `Удалить профиль ${preset.name}`, onclick: () => setAuto({ presets: auto.presets.filter((item) => item.id !== preset.id) }) }, icon('x', 11)))),
      input ? [input,
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => commitPreset(input.value) }, 'Сохранить'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { naming = false; render(); } }, 'Отмена')]
        : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { naming = true; render(); }, title: 'Сохранить текущие настройки как профиль для запуска в 1 клик' }, icon('plus', 12), 'Профиль'));
  }
  const ownCenters = () => ctx.accounts.peek()?.businessCenters || [];
  const centers = () => {
    const map = new Map(ownCenters().map((bc) => [bc.id, bc.name]));
    for (const item of created) if (ID.test(item.businessCenterId || '') && !map.has(item.businessCenterId)) map.set(item.businessCenterId, item.businessCenterName || `BC ${short(item.businessCenterId)}`);
    return [...map].map(([id, name]) => ({ id, name }));
  };
  const partnerName = (id) => auto.partners.find((item) => item.id === id)?.name || ownCenters().find((item) => item.id === id)?.name || `BC ${short(id)}`;
  // Сервис-воркер мог быть перезапущен Chrome — «running» без свежего heartbeat считаем прерванным.
  const jobState = () => (job?.state === 'running' && Date.now() - (job.heartbeat || 0) > 5 * 60 * 1000 ? 'interrupted' : job?.state);

  /* ---------- действия ---------- */
  async function start() {
    if (starting || jobState() === 'running') return;
    if (auto.mode === 'existing-bc' && !ID.test(auto.businessCenterId)) return toast('Выберите Business Center', 'error');
    if (auto.share.enabled && !auto.share.targets.length) return toast('Выберите или добавьте BC, куда расшаривать', 'error');
    if (auto.transfer.enabled && !ID.test(auto.transfer.targetBusinessCenterId || '')) return toast('Выберите BC, которому передать РК', 'error');
    if (company.companyMode === 'new' && company.companyName.trim().length < 2) return toast('Для новой Company укажите юридическое название', 'error');
    starting = true; showJob = true; render();
    try {
      job = await bus.pipeline.start({ ...auto, company });
      toast(auto.count > 1 ? `Запущено: ${auto.count} шт. Окно можно закрыть — работа продолжится` : 'Создание запущено. Окно можно закрыть — работа продолжится', 'ok', 5000);
    } catch (error) { toast(error.message, 'error', 7000); }
    starting = false;
    if (!stopped) render();
  }

  async function pipelineAction(action) {
    try {
      const next = await bus.pipeline[action]();
      if (next) job = next;
      if (action === 'resume') toast('Продолжаю', 'ok');
      if (action === 'cancel') toast('Остановлю после текущего шага', 'info');
    } catch (error) { toast(error.message, 'error', 7000); }
    if (!stopped) render();
  }

  async function openPipelineTab(index) {
    try { await bus.pipeline.openTab(index); if (ctx.mode === 'popup') window.close(); }
    catch (error) { toast(error.message, 'error'); }
  }

  async function prepareOnly() {
    const rand = tail();
    try {
      const result = await bus.creation.prepare({
        mode: auto.mode, businessCenterId: auto.businessCenterId,
        businessCenterName: renderName(auto.bcTemplate, 1, rand), adAccountName: renderName(auto.adTemplate, 1, rand), ...company
      });
      toast(result?.state === 'prepared' ? 'Форма заполнена — проверьте её во вкладке TikTok' : (result?.result?.error || `Состояние: ${result?.state}`), result?.state === 'prepared' ? 'ok' : 'info', 6000);
    } catch (error) { toast(error.message, 'error', 7000); }
  }

  async function loadAccounts() {
    try { await ctx.accounts.get({ force: true }); toast('Список BC обновлён', 'ok'); }
    catch (error) { toast(error.message, 'error'); }
    if (!stopped) render();
  }

  function shareSelected() {
    const accounts = created.filter((item) => selected.has(item.adAccountId))
      .map((item) => ({ id: item.adAccountId, bcId: item.businessCenterId, name: item.adAccountName }));
    if (!accounts.length) return;
    openShareSheet(ctx, { accounts, onStarted: (next) => { shareJob = next; render(); } });
  }

  const quickSelected = () => quickShare(ctx, created.filter((item) => selected.has(item.adAccountId))
    .map((item) => ({ id: item.adAccountId, bcId: item.businessCenterId, name: item.adAccountName })), { onStarted: (next) => { shareJob = next; render(); } });

  async function copyIds() {
    const ids = created.filter((item) => selected.has(item.adAccountId)).map((item) => item.adAccountId);
    if (await copyText(ids.join('\n'))) toast(`Скопировано ID: ${ids.length}`, 'ok');
  }

  function exportCsv() {
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['ad_account_id', 'ad_account_name', 'bc_id', 'bc_name', 'portfolio', 'shared_to', 'created_at']];
    for (const item of created) {
      rows.push([item.adAccountId, item.adAccountName, item.businessCenterId, item.businessCenterName, item.portfolio?.linked ? item.portfolio.id || 'yes' : '',
        (item.shares || []).map((share) => `${share.targetBusinessCenterId}:${share.permission || ''}:${share.state || ''}`).join(' '), item.createdAt ? new Date(item.createdAt).toISOString() : '']);
    }
    download(`ttads-created-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
  }

  async function clearCreated() {
    if (!confirm('Очистить локальный список созданных РК? В TikTok ничего не удаляется.')) return;
    try { created = await bus.registry.clear(); selected.clear(); } catch (error) { toast(error.message, 'error'); }
    render();
  }

  /* ---------- блоки ---------- */
  function heroCard() {
    const isNew = auto.mode === 'new-bc';
    const list = centers();
    if (!isNew && !ID.test(auto.businessCenterId) && list[0]) auto.businessCenterId = list[0].id;
    const bcSelect = h('select', { class: 'select', disabled: !list.length, 'aria-label': 'Business Center' },
      list.length ? list.map((bc) => h('option', { value: bc.id, selected: bc.id === auto.businessCenterId }, `${bc.name} · ${short(bc.id)}`)) : h('option', null, 'Откройте Ads Manager и нажмите «обновить»'));
    bcSelect.onchange = () => setAuto({ businessCenterId: bcSelect.value });
    const count = h('input', { class: 'input count-input', type: 'number', min: '1', max: '20', value: String(auto.count), 'aria-label': 'Количество' });
    count.onchange = () => setAuto({ count: Math.min(20, Math.max(1, Math.round(Number(count.value)) || 1)) });
    const example = h('p', { class: 'small muted name-preview' });
    const updateExample = () => { example.textContent = `Пример: ${isNew ? `${renderName(auto.bcTemplate, 1, 'K7QX')} + ` : ''}${renderName(auto.adTemplate, 1, 'K7QX')}`; };
    updateExample();
    const tpl = (key, label) => h('label', { class: 'field' }, h('span', { class: 'label' }, label),
      h('input', { class: 'input mono', value: auto[key], maxlength: '80', spellcheck: 'false', oninput: (event) => { setAuto({ [key]: event.target.value }, false); updateExample(); } }));
    const total = auto.count;
    const action = isNew ? (total > 1 ? `Создать ${total} BC + РК` : 'Создать BC + РК') : (total > 1 ? `Создать ${total} РК` : 'Создать РК');
    const busy = starting || jobState() === 'running';

    return h('section', { class: 'card creation-hero' },
      presetsRow(),
      h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('zap', 16), 'Создать в 1 клик'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Что создать' },
          h('button', { type: 'button', 'aria-pressed': String(isNew), onclick: () => setAuto({ mode: 'new-bc' }) }, 'BC + РК'),
          h('button', { type: 'button', 'aria-pressed': String(!isNew), onclick: () => setAuto({ mode: 'existing-bc' }) }, 'РК в BC'))),
      !isNew ? h('div', { class: 'field' }, h('div', { class: 'row' }, h('span', { class: 'label' }, 'В каком Business Center'), h('span', { class: 'spacer' }),
        h('button', { class: 'linklike', type: 'button', onclick: loadAccounts }, 'обновить')), bcSelect) : null,
      h('div', { class: 'creation-grid' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Сколько'),
          h('div', { class: 'stepper' },
            h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Меньше', disabled: auto.count <= 1, onclick: () => setAuto({ count: Math.max(1, auto.count - 1) }) }, '−'),
            count,
            h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Больше', disabled: auto.count >= 20, onclick: () => setAuto({ count: Math.min(20, auto.count + 1) }) }, '+'))),
        isNew ? tpl('bcTemplate', 'Имя BC') : null,
        tpl('adTemplate', 'Имя РК')),
      example,
      h('p', { class: 'small muted' }, 'Подстановки: {date} {time} {n} — номер, {rand} — 4 случайных символа.'),
      h('div', { class: 'section-label' }, 'После создания'),
      switchRow('Подключить общую карту', 'Подтвердить Payment Portfolio, который TikTok сам предложит на шаге оплаты', auto.linkPortfolio, (value) => setAuto({ linkPortfolio: value })),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Передать в другой BC'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Передать в другой BC' },
          h('button', { type: 'button', 'aria-pressed': String(handoff() === 'none'), onclick: () => setHandoff('none') }, 'Нет'),
          h('button', { type: 'button', 'aria-pressed': String(handoff() === 'share'), onclick: () => setHandoff('share') }, 'Расшарить'),
          h('button', { type: 'button', 'aria-pressed': String(handoff() === 'transfer'), onclick: () => setHandoff('transfer') }, 'Передать владение'))),
      handoff() === 'transfer' ? h('div', { class: 'share-box' },
        targetPicker({
          label: 'Кому передать (BC получателя)', partners: auto.partners, own: ownCenters(),
          value: auto.transfer.targetBusinessCenterId ? [auto.transfer.targetBusinessCenterId] : [], exclude: isNew ? [] : [auto.businessCenterId],
          onChange: (targets) => setAuto({ transfer: { ...auto.transfer, enabled: true, targetBusinessCenterId: targets.filter((id) => id !== auto.transfer.targetBusinessCenterId).at(-1) || targets.at(-1) || '' } }),
          onPartners: (partners) => setAuto({ partners }, false)
        }),
        h('p', { class: 'small muted' }, 'Self-service transfer: TikTok отправит запрос, получатель одобряет его в своём BC. Доступен не всем BC, а новые РК должны пройти проверку (Approved). Если меню Transfer нет — выбирайте «Расшарить».')) : null,
      auto.share.enabled ? h('div', { class: 'share-box' },
        targetPicker({
          partners: auto.partners, own: ownCenters(), value: auto.share.targets,
          exclude: isNew ? [] : [auto.businessCenterId],
          onChange: (targets) => setShare({ targets }, false),
          onPartners: (partners) => setAuto({ partners }, false)
        }),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Права партнёра'), permissionSelect(auto.share.permission, (permission) => setShare({ permission }, false))),
        checkRow('Сразу принять приглашение в BC получателя (если вы админ и там)', auto.share.autoAccept, (autoAccept) => setShare({ autoAccept }, false))) : null,
      h('button', { class: 'btn primary block big', type: 'button', disabled: busy, onclick: start },
        busy ? h('span', { class: 'spinner' }) : icon('zap', 15), busy ? 'Выполняется…' : action),
      h('p', { class: 'small muted' }, 'Страну, валюту и часовой пояс TikTok берёт из Company. Если TikTok попросит код или CAPTCHA, вкладка откроется сама — завершите шаг и нажмите «Продолжить».'));
  }

  function itemRow(item) {
    const [label, kind] = ITEM_STATE[item.state] || [item.state, ''];
    const result = item.result || {};
    const ids = [result.adAccountId ? `РК ${result.adAccountId}` : '', result.businessCenterId ? `BC ${short(result.businessCenterId)}` : ''].filter(Boolean).join(' · ');
    const shareLine = item.share ? (item.share.targets || []).map((target) => `→ ${partnerName(target.targetBusinessCenterId)}: ${target.shared ? (target.accepted ? 'расшарено и принято ✓' : 'приглашение отправлено') : (target.hint || target.error || 'не расшарено')}`).join('; ')
      || (item.share.warnings || []).join('; ') : '';
    return h('div', { class: `pipe-item ${kind}` },
      h('span', { class: 'pipe-num' }, `#${item.index}`),
      h('div', { class: 'pipe-main' },
        h('b', null, item.adAccountName || 'РК'),
        ids ? h('span', { class: 'mono small muted' }, ids) : item.businessCenterName ? h('span', { class: 'small muted' }, `BC «${item.businessCenterName}»`) : null,
        item.error ? h('span', { class: 'small err-text' }, item.error) : null,
        item.payment ? h('span', { class: 'small' }, item.payment.success ? `Portfolio ✓ ${item.payment.portfolio?.name || item.payment.portfolio?.id || ''}` : item.payment.skipped ? `Portfolio: ${item.payment.note}` : `Portfolio: ${item.payment.error}`) : null,
        shareLine ? h('span', { class: 'small' }, shareLine) : null,
        item.transfer ? h('span', { class: 'small' }, item.transfer.requested
          ? `Transfer → ${partnerName(job?.plan?.transfer?.targetBusinessCenterId)}: запрос отправлен, ждёт одобрения ✓`
          : `Transfer: ${item.transfer.hint || item.transfer.error || (item.transfer.pending ? 'TikTok обрабатывает' : item.transfer.state)}`) : null),
      h('div', { class: 'pipe-side' },
        h('span', { class: `pill ${kind}` }, label),
        item.tabId && ['paused', 'error', 'share-paused'].includes(item.state) ? h('button', { class: 'linklike', type: 'button', onclick: () => openPipelineTab(item.index) }, 'вкладка') : null));
  }

  function pipelineCard() {
    if (!job?.items || (!showJob && !ACTIVE.includes(jobState()))) return null;
    const state = jobState();
    const items = job.items;
    const finished = items.filter((item) => ['done', 'error', 'cancelled'].includes(item.state)).length;
    const pct = Math.round((finished / Math.max(1, items.length)) * 100);
    const step = job.step;
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' }, icon('activity', 15), `Конвейер · ${JOB_STATE[state] || state}`),
        h('div', { class: 'row' },
          state === 'running' ? h('button', { class: 'btn sm', type: 'button', onclick: () => pipelineAction('cancel') }, icon('stop', 13), 'Стоп') : null,
          ['paused', 'interrupted'].includes(state) ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => pipelineAction('resume') }, icon('play', 13), 'Продолжить') : null,
          ['paused', 'interrupted'].includes(state) ? h('button', { class: 'btn sm', type: 'button', onclick: () => pipelineAction('cancel') }, 'Отменить') : null,
          !ACTIVE.includes(state) ? h('button', { class: 'icon-btn', type: 'button', title: 'Скрыть', 'aria-label': 'Скрыть', onclick: () => { showJob = false; render(); } }, icon('x', 14)) : null)),
      h('div', { class: `progress${state === 'running' && !finished ? ' indeterminate' : ''}` }, h('i', { style: { width: `${pct}%` } })),
      h('p', { class: 'small muted' }, `${finished} из ${items.length}${job.plan?.linkPortfolio ? ' · Portfolio' : ''}${job.plan?.share?.enabled ? ` · шаринг → ${job.plan.share.targets.map(partnerName).join(', ')} (${job.plan.share.permission})` : ''}${job.plan?.transfer?.enabled ? ` · transfer → ${partnerName(job.plan.transfer.targetBusinessCenterId)}` : ''}`),
      job.pause?.hint ? h('div', { class: 'alert warn' }, icon('alert', 15), h('div', { class: 'grow' }, job.pause.hint,
        job.pause.tabId ? h('div', null, h('button', { class: 'linklike', type: 'button', onclick: () => openPipelineTab(job.pause.index) }, 'Открыть вкладку TikTok')) : null)) : null,
      job.stopReason ? h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, job.stopReason)) : null,
      step?.phase && state === 'running' ? h('p', { class: 'small' }, step.phase === 'accept' ? `Принимаю приглашение в ${partnerName(step.target)}…` : step.phase === 'transfer' ? `Передаю владение в ${partnerName(step.target)}…` : `Расшариваю в ${partnerName(step.target)}…`) : null,
      h('div', { class: 'pipe-list' }, items.map(itemRow)));
  }

  function createdRow(item) {
    const on = selected.has(item.adAccountId);
    const box = h('input', { type: 'checkbox', checked: on, 'aria-label': `Выбрать ${item.adAccountId}` });
    box.onchange = () => { if (box.checked) selected.add(item.adAccountId); else selected.delete(item.adAccountId); render(); };
    return h('label', { class: `created-row${on ? ' selected' : ''}` }, box,
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title' }, item.adAccountName || `РК ${item.adAccountId}`),
        h('div', { class: 'item-meta' },
          h('button', { class: 'id-chip mono', type: 'button', title: 'Скопировать ID', onclick: async () => { if (await copyText(item.adAccountId)) toast('ID скопирован', 'ok'); } }, item.adAccountId),
          item.businessCenterId ? h('span', null, `${item.businessCenterName || 'BC'} · ${short(item.businessCenterId)}`) : h('span', null, 'BC неизвестен')),
        (item.portfolio?.linked || item.shares?.length) ? h('div', { class: 'item-meta' },
          item.portfolio?.linked ? h('span', { class: 'pill ok' }, 'Portfolio ✓') : null,
          (item.shares || []).map((share) => h('span', { class: `pill ${share.state === 'invited' ? 'warn' : 'ok'}`, title: `${share.permission || ''} · ${share.state || ''}` },
            `→ ${partnerName(share.targetBusinessCenterId)}${share.state === 'invited' ? ' · ждёт принятия' : ' ✓'}`))) : null),
      h('button', { class: 'icon-btn', type: 'button', title: 'Открыть в Ads Manager', 'aria-label': 'Открыть в Ads Manager', onclick: () => ctx.open(`https://ads.tiktok.com/i18n/manage/campaign?aadvid=${item.adAccountId}`) }, icon('external', 15)));
  }

  function createdCard() {
    const head = h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('list', 15), created.length ? `Созданные РК · ${created.length}` : 'Созданные РК'),
      created.length ? h('button', { class: 'btn sm', type: 'button', title: 'Скачать CSV', onclick: exportCsv }, icon('download', 13), 'CSV') : null);
    if (!created.length) return h('section', { class: 'card' }, head, h('p', { class: 'small muted' }, 'Здесь появятся кабинеты, созданные расширением: отметьте нужные и нажмите «Расшарить».'));
    const visible = created.slice(0, 100);
    const all = h('input', { type: 'checkbox', checked: visible.every((item) => selected.has(item.adAccountId)) });
    all.onchange = () => { for (const item of visible) { if (all.checked) selected.add(item.adAccountId); else selected.delete(item.adAccountId); } render(); };
    const count = created.filter((item) => selected.has(item.adAccountId)).length;
    return h('section', { class: 'card' }, head,
      h('div', { class: 'row created-toolbar' },
        h('label', { class: 'check' }, all, h('span', null, 'Все')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn sm', type: 'button', disabled: !count, onclick: copyIds }, icon('copy', 13), 'ID'),
        quickShareConfig(ctx).targets.length ? h('button', { class: 'btn sm primary', type: 'button', disabled: !count, title: 'С сохранёнными получателем и правами', onclick: quickSelected }, icon('zap', 13), `→ ${quickShareConfig(ctx).label}`) : null,
        h('button', { class: `btn sm${quickShareConfig(ctx).targets.length ? '' : ' primary'}`, type: 'button', disabled: !count, onclick: shareSelected }, icon('send', 13), count ? `Расшарить ${count}` : 'Расшарить')),
      h('div', { class: 'created-list' }, visible.map(createdRow)),
      created.length > visible.length ? h('p', { class: 'small muted' }, `Показаны последние ${visible.length} из ${created.length}; CSV содержит все.`) : null,
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), h('button', { class: 'linklike', type: 'button', onclick: clearCreated }, 'очистить список')));
  }

  function advancedCard() {
    const companyMode = h('select', { class: 'select' },
      h('option', { value: 'existing', selected: company.companyMode === 'existing' }, 'Текущая Company — рекомендуется TikTok'),
      h('option', { value: 'new', selected: company.companyMode === 'new' }, 'Создать новую Company'));
    companyMode.onchange = () => { company.companyMode = companyMode.value; render(); };
    const field = (key, label, attrs = {}) => h('label', { class: 'field' }, h('span', { class: 'label' }, label),
      h('input', { class: 'input', value: company[key], oninput: (event) => { company[key] = event.target.value; }, ...attrs }));
    return h('details', { class: 'group creation-advanced', open: company.companyMode === 'new' },
      h('summary', null, icon('building', 14), 'Дополнительно: Company, вкладки, ручной режим', h('span', { class: 'spacer' }), icon('chevron', 13)),
      h('div', { class: 'creation-fields' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Company'), companyMode),
        company.companyMode === 'new' ? [
          h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, 'Нужны реальные юридические данные: название попадает в счета и меняется с ограничениями. Недостающие поля останутся для проверки в мастере TikTok.')),
          field('companyName', 'Юридическое название'),
          field('companyWebsite', 'Сайт', { placeholder: 'https://example.com' }),
          h('div', { class: 'two-col' }, field('contactName', 'Контакт'), field('phone', 'Телефон')),
          field('email', 'Email', { type: 'email' })
        ] : h('p', { class: 'small muted' }, 'Страна, валюта, часовой пояс и юрлицо берутся из текущей Company.'),
        switchRow('Закрывать вкладки TikTok после успеха', 'Оставляет открытыми только вкладки, где нужно ваше действие', auto.closeTabs, (value) => setAuto({ closeTabs: value }, false)),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn sm', type: 'button', onclick: prepareOnly }, icon('edit', 13), 'Только заполнить форму'),
          h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await bus.creation.openLast(); if (ctx.mode === 'popup') window.close(); } catch (error) { toast(error.message, 'error'); } } }, icon('external', 13), 'Последняя вкладка мастера'))));
  }

  function render() {
    pendingRender = false;
    fill(host,
      heroCard(),
      pipelineCard(),
      shareJobBlock(shareJob, {
        onResume: async () => { try { shareJob = await bus.share.resume(); toast('Повторяю шаринг', 'ok'); } catch (error) { toast(error.message, 'error', 7000); } render(); },
        onOpen: async () => { try { await bus.share.openLast(); if (ctx.mode === 'popup') window.close(); } catch (error) { toast(error.message, 'error'); } }
      }),
      createdCard(),
      advancedCard());
  }

  // Прогресс приходит из storage; пока пользователь печатает в поле, перерисовку откладываем.
  const scheduleRender = () => {
    if (stopped) return;
    const el = document.activeElement;
    if (el && host.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox') { pendingRender = true; return; }
    render();
  };
  host.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { if (!stopped && pendingRender) scheduleRender(); }, 0); });
  const unwatch = bus.watch(['pipelineJob', 'shareLastJob', 'createdAssets'], (key, value) => {
    if (key === 'pipelineJob') job = value;
    else if (key === 'shareLastJob') shareJob = value;
    else created = Array.isArray(value) ? value : [];
    scheduleRender();
  });

  render();
  Promise.all([bus.pipeline.status().catch(() => null), bus.share.status().catch(() => null), bus.registry.list().catch(() => [])])
    .then(([pipelineJob, lastShare, list]) => {
      job = pipelineJob; shareJob = lastShare; created = list || [];
      showJob = Boolean(job && (ACTIVE.includes(jobState()) || Date.now() - (job.completedAt || job.startedAt || 0) < 60 * 60 * 1000));
      if (shareJob && shareJob.state === 'complete' && Date.now() - (shareJob.completedAt || 0) > 60 * 60 * 1000) shareJob = null;
      scheduleRender();
    });
  ctx.accounts.get().then(() => scheduleRender()).catch(() => {});
  return () => { stopped = true; unwatch(); };
}
