// Массовые действия над кампаниями, адсетами и объявлениями (вкл/выкл, имя, бюджет) и обучение этим действиям.
// Контракты снимаются с реального запроса TikTok один раз; применение — с предпросмотром, повторным чтением и откатом.
import { h, fill, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import * as bus from '../lib/bus.js';
import { money } from '../lib/format.js';
import { LINK_BY_ID, resolveLink } from '../../background/links/catalog.js';

const LEVELS = [['campaign', 'Кампании'], ['adgroup', 'Адсеты'], ['ad', 'Объявления']];
const ACTIONS = [['disable', 'Выключить'], ['enable', 'Включить'], ['rename', 'Имя'], ['budget', 'Бюджет']];
const LEVEL_LINK = { campaign: 'campaigns', adgroup: 'adgroups', ad: 'ads' };
const LEVEL_WHERE = { campaign: 'вкладка «Кампании»', adgroup: 'вкладка «Группы объявлений»', ad: 'вкладка «Объявления»' };
const KIND_OF = { disable: 'status', enable: 'status', rename: 'name', budget: 'budget' };
const RESULT_TITLE = { disable: 'Выключение', enable: 'Включение', rename: 'Переименование', budget: 'Бюджет' };
const JOB_STATE = { running: ['выполняется…', 'info'], complete: ['готово', 'ok'], partial: ['частично', 'warn'], error: ['не удалось', 'err'], cancelled: ['остановлено', 'warn'], interrupted: ['прервано', 'warn'] };
const readyKey = (action) => (action === 'rename' ? 'name' : action === 'budget' ? 'budget' : action);

const stateWord = (value) => (value === true ? 'включено' : value === false ? 'выключено' : '—');
const change = (action, before, after, currency) => (action === 'rename' ? `${before.name} → ${after.name}`
  : action === 'budget' ? `${money(before.budget, currency)} → ${money(after.budget, currency)}`
    : `${stateWord(before.enabled)} → ${stateWord(after.enabled)}`);

function openInWindow(ctx) {
  chrome.windows.create({ url: chrome.runtime.getURL(`ui/app.html?tab=${ctx.tabId}`), type: 'popup', width: 470, height: 790 });
  window.close();
}

/* ---------- обучение ---------- */

function instruction(session) {
  const where = LEVEL_WHERE[session.level];
  if (session.kind === 'status') return `В TikTok (${where}) переключите «${session.objectName}»: сейчас она ${session.before.enabled ? 'включена' : 'выключена'} — ${session.next === 'disable' ? 'выключите' : 'включите'} и подождите пару секунд.`;
  if (session.kind === 'name') return `В TikTok (${where}) переименуйте «${session.objectName}» (Edit или Bulk edit → Name): введите любое новое уникальное имя и сохраните.`;
  return `В TikTok (${where}) измените бюджет «${session.objectName}» (сейчас ${session.before.budget}) на другое значение и сохраните.`;
}

export function openLearnSheet(ctx, { account = '', level = 'campaign', kind = 'status', onClose } = {}) {
  const accounts = ctx.accounts.peek()?.accounts || [];
  const L = { account: account || ctx.account || accounts[0]?.id || '', level, kind, rows: null, loading: false, objectId: '', status: null, busy: false };
  const body = h('div', { class: 'stack' });
  let stopped = false;

  const refresh = () => bus.objects.status().then((status) => { L.status = status; if (!stopped) render(); }).catch(() => {});
  const unwatch = bus.watch(['objectsLearn', 'objectContracts'], () => refresh());

  async function loadRows() {
    if (!L.account) return;
    L.loading = true; L.rows = null; render();
    try {
      const data = await bus.explorer.load(ctx.tabId, L.account, L.level, 'today');
      L.rows = data.rows;
      L.objectId = L.rows.find((row) => row.id === L.objectId)?.id || L.rows[0]?.id || '';
    } catch (error) { toast(error.message, 'error', 6000); L.rows = []; }
    L.loading = false;
    if (!stopped) render();
  }

  async function start() {
    L.busy = true; render();
    try { await bus.objects.learnStart({ account: L.account, level: L.level, kind: L.kind, objectId: L.objectId, tabId: ctx.tabId }); await refresh(); }
    catch (error) { toast(error.message, 'error', 7000); }
    L.busy = false; if (!stopped) render();
  }

  const stop = async () => { try { await bus.objects.learnStop(); } catch { /* сессии могло уже не быть */ } await refresh(); };

  function render() {
    const session = L.status?.session;
    const live = session && ['waiting', 'checking'].includes(session.state);
    const ready = L.status?.ready?.[L.level] || {};
    const kinds = [['status', 'Вкл/выкл'], ['name', 'Имя'], ...(L.level === 'ad' ? [] : [['budget', 'Бюджет']])];
    if (!kinds.some(([id]) => id === L.kind)) L.kind = 'status';
    const accountSelect = h('select', { class: 'select', disabled: live, 'aria-label': 'Кабинет' }, (accounts.length ? accounts : [{ id: L.account, name: L.account }]).map((a) => h('option', { value: a.id, selected: a.id === L.account }, `${a.name} · …${a.id.slice(-6)}`)));
    accountSelect.onchange = () => { L.account = accountSelect.value; L.rows = null; L.objectId = ''; loadRows(); };
    const objectSelect = h('select', { class: 'select', disabled: live || !L.rows?.length, 'aria-label': 'Тестовый объект' },
      (L.rows || []).map((row) => h('option', { value: row.id, selected: row.id === L.objectId }, `${row.name} · ${row.enabled === true ? 'вкл' : row.enabled === false ? 'выкл' : '—'}${row.budget ? ` · ${row.budget}` : ''}`)));
    objectSelect.onchange = () => { L.objectId = objectSelect.value; };
    const link = L.account ? resolveLink(LINK_BY_ID.get(LEVEL_LINK[L.level]), { aadvid: L.account }, ctx.settings?.links?.overrides) : null;

    fill(body,
      h('div', { class: 'alert info' }, icon('info', 15), h('div', null,
        'TikTok не публикует тела внутренних запросов. Выполните нужное действие в TikTok один раз на тестовом объекте: расширение запомнит запрос и подтвердит его повторным чтением. Дальше то же самое делается массово.',
        ctx.mode === 'popup' ? h('div', null, h('button', { class: 'linklike', type: 'button', onclick: () => openInWindow(ctx) }, 'Открыть это окно отдельно'), ' — popup закрывается при клике в TikTok, но запись продолжится.') : null)),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Уровень' }, LEVELS.map(([id, title]) => h('button', { type: 'button', disabled: live, 'aria-pressed': String(L.level === id), onclick: () => { L.level = id; L.rows = null; L.objectId = ''; loadRows(); } }, title))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Что обучаем' }, kinds.map(([id, title]) => h('button', { type: 'button', disabled: live, 'aria-pressed': String(L.kind === id), onclick: () => { L.kind = id; render(); } }, title))),
      h('div', { class: 'row wrap' },
        h('span', { class: `pill ${ready.disable ? 'ok' : ''}` }, `Выкл ${ready.disable ? '✓' : '○'}`), h('span', { class: `pill ${ready.enable ? 'ok' : ''}` }, `Вкл ${ready.enable ? '✓' : '○'}`),
        h('span', { class: `pill ${ready.name ? 'ok' : ''}` }, `Имя ${ready.name ? '✓' : '○'}`), L.level === 'ad' ? null : h('span', { class: `pill ${ready.budget ? 'ok' : ''}` }, `Бюджет ${ready.budget ? '✓' : '○'}`)),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Кабинет'), accountSelect),
      h('label', { class: 'field' }, h('div', { class: 'row' }, h('span', { class: 'label' }, 'Тестовый объект'), h('span', { class: 'spacer' }), h('button', { class: 'linklike', type: 'button', disabled: live || L.loading, onclick: loadRows }, L.rows ? 'обновить' : 'загрузить')), L.loading ? h('div', { class: 'row hint' }, h('span', { class: 'spinner' }), 'Читаю объекты…') : objectSelect,
        h('span', { class: 'hint' }, 'Выберите объект, который не страшно переключить: после обучения состояние можно вернуть тем же действием.')),
      session && L.status ? sessionBlock(session) : null,
      h('div', { class: 'row wrap' },
        live ? h('button', { class: 'btn sm', type: 'button', onclick: stop }, icon('stop', 13), 'Остановить запись')
          : h('button', { class: 'btn primary', type: 'button', disabled: L.busy || !L.objectId, onclick: start }, L.busy ? h('span', { class: 'spinner' }) : icon('play', 14), 'Начать запись'),
        link?.ok ? h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.open(link.url) }, icon('external', 13), 'Открыть в Ads Manager') : null));
  }

  function sessionBlock(session) {
    const tone = session.state === 'done' ? 'ok' : session.state === 'expired' ? 'warn' : 'info';
    const live = ['waiting', 'checking'].includes(session.state);
    return h('div', { class: `alert ${tone}` }, icon(tone === 'ok' ? 'check' : 'info', 15), h('div', { class: 'grow' },
      h('b', null, session.state === 'done' ? 'Запомнено' : session.state === 'checking' ? 'Проверяю…' : session.state === 'expired' ? 'Время вышло' : 'Жду действие в TikTok'),
      live ? h('p', { class: 'small' }, instruction(session)) : null,
      session.message ? h('p', { class: 'small' }, session.message) : null,
      (session.other || []).length ? h('p', { class: 'small muted' }, `Замечены другие запросы: ${session.other.join(', ')}`) : null));
  }

  render(); refresh(); if (L.account) loadRows();
  openSheet({ title: 'Обучить действие', body, foot: h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Закрыть'), kind: 'objects', onClose: () => { stopped = true; unwatch(); onClose?.(); } });
}

/* ---------- массовое действие ---------- */

export function openObjectsSheet(ctx, { accounts = [], level = 'campaign', action = 'disable', ids = null, lockLevel = false } = {}) {
  const S = {
    level, action, state: ids ? 'all' : action === 'enable' ? 'disabled' : 'enabled', q: '', nameTemplate: '{name}', budgetMode: 'multiply', budgetValue: '',
    plan: null, planning: false, busy: false, confirm: false, status: null, job: null
  };
  const body = h('div', { class: 'stack' });
  const footBox = h('div', { class: 'row', style: { width: '100%', justifyContent: 'flex-end' } });
  const explicitCount = ids ? Object.values(ids).reduce((sum, list) => sum + list.length, 0) : 0;
  let stopped = false;

  const ready = () => Boolean(S.status?.ready?.[S.level]?.[readyKey(S.action)]);
  const risky = () => S.action === 'enable' || S.action === 'budget';
  const input = () => ({
    action: S.action, level: S.level, accounts: accounts.map((a) => a.id), ids: ids || undefined, filter: { state: S.state, q: S.q },
    nameTemplate: S.nameTemplate, budget: { mode: S.budgetMode, value: Number(S.budgetValue) }, confirmSpend: S.confirm
  });
  const reopen = () => openObjectsSheet(ctx, { accounts, level: S.level, action: S.action, ids, lockLevel });

  const refresh = () => bus.objects.status().then((status) => { S.status = status; S.job = status.job; if (!stopped) render(); }).catch(() => {});
  const unwatch = bus.watch(['objectsJob', 'objectsLearn', 'objectContracts'], (key, value) => { if (key === 'objectsJob') S.job = value; else refresh(); render(); });

  async function runPlan() {
    S.planning = true; S.plan = null; S.confirm = false; render();
    try { S.plan = await bus.objects.plan(input()); } catch (error) { toast(error.message, 'error', 7000); }
    S.planning = false; if (!stopped) render();
  }

  async function runApply() {
    S.busy = true; render();
    try { S.job = await bus.objects.apply(input()); S.plan = null; }
    catch (error) { toast(error.message, 'error', 8000); }
    S.busy = false; if (!stopped) render();
  }

  async function jobAction(name) {
    try { S.job = await bus.objects[name](); if (name === 'rollback') toast('Откатываю изменения', 'info'); }
    catch (error) { toast(error.message, 'error', 7000); }
    if (!stopped) render();
  }

  function planBlock() {
    const p = S.plan;
    if (!p) return null;
    const first = p.accounts.find((a) => a.sample.length);
    return h('div', { class: 'stack' },
      h('div', { class: `alert ${p.totals.targets ? 'info' : 'warn'}` }, icon('info', 15), h('div', null,
        h('b', null, p.totals.targets ? `Будет изменено: ${p.totals.targets}` : 'Менять нечего'), p.totals.skipped ? ` · уже в нужном виде: ${p.totals.skipped}` : '')),
      h('div', { class: 'copy-tree' }, p.accounts.map((a) => h('div', { class: 'copy-row' }, h('div', { class: 'item-main' }, h('b', { title: a.name }, a.name),
        h('small', { class: a.error ? 'err-text' : 'muted' }, a.error || `${a.targets} к изменению · всего ${a.total}${a.truncated ? ' (список обрезан)' : ''}`))))),
      first ? h('div', { class: 'copy-log' }, h('span', { class: 'hint' }, `Пример — ${first.name}:`), first.sample.map((item) => h('span', { class: 'small' }, `${item.name}: ${change(p.action, item.before, item.after, first.currency)}`))) : null,
      p.totals.targets && risky() ? h('label', { class: 'check' }, (() => { const box = h('input', { type: 'checkbox', checked: S.confirm }); box.onchange = () => { S.confirm = box.checked; renderFoot(); }; return box; })(),
        h('span', null, S.action === 'enable' ? 'Понимаю: включение может запустить расход.' : 'Понимаю: новый бюджет может увеличить расход.')) : null);
  }

  function jobBlock() {
    const job = S.job;
    if (!job) return null;
    const [label, tone] = JOB_STATE[job.state] || [job.state, 'info'];
    const running = job.state === 'running';
    const problems = [...new Set((job.items || []).filter((item) => item.request && !item.request.ok).map((item) => [item.request.http, item.request.code, item.request.msg].filter((v) => v !== null && v !== '').join(' ')))].filter(Boolean).slice(0, 3);
    const unverified = (job.items || []).filter((item) => item.request?.ok && item.verified === false).length;
    return h('div', { class: `alert ${tone}` }, icon(tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert', 15), h('div', { class: 'grow' },
      h('b', null, `${RESULT_TITLE[job.action]}${job.rollbackOf ? ' (откат)' : ''}: ${label}`),
      running ? h('div', { class: `progress${job.done ? '' : ' indeterminate'}` }, h('i', { style: { width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` } })) : null,
      h('p', { class: 'small' }, `Запросов: ${job.done} из ${job.total}${job.phase === 'verify' ? ' · проверяю повторным чтением…' : ''}`),
      job.verified !== undefined ? h('p', { class: 'small' }, `Подтверждено повторным чтением: ${job.verified} из ${job.total}`) : null,
      unverified ? h('p', { class: 'small' }, `TikTok ответил «ок», но изменение пока не видно у ${unverified} — обновите список позже.`) : null,
      problems.map((text) => h('p', { class: 'small err-text' }, text)),
      job.error ? h('p', { class: 'small err-text' }, job.error) : null,
      job.note ? h('p', { class: 'small muted' }, job.note) : null,
      h('div', { class: 'row' },
        running ? h('button', { class: 'btn sm', type: 'button', onclick: () => jobAction('cancel') }, icon('stop', 13), 'Остановить') : null,
        !running && !job.rollbackOf && job.verified > 0 ? h('button', { class: 'btn sm', type: 'button', onclick: () => { if (confirm(`Вернуть прежнее состояние у ${job.verified} объектов?`)) jobAction('rollback'); } }, icon('refresh', 13), 'Откатить') : null)));
  }

  function renderFoot() {
    const running = S.job?.state === 'running';
    const canRun = S.plan?.totals.targets > 0 && ready() && (!risky() || S.confirm);
    fill(footBox,
      h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Закрыть'),
      running ? null : h('button', { class: 'btn', type: 'button', disabled: S.planning || S.busy || !ready(), onclick: runPlan }, S.planning ? h('span', { class: 'spinner' }) : null, 'Предпросмотр'),
      running ? null : h('button', { class: 'btn primary', type: 'button', disabled: !canRun || S.busy, onclick: runApply }, S.busy ? h('span', { class: 'spinner' }) : null, 'Выполнить'));
  }

  function render() {
    const kinds = ACTIONS.filter(([id]) => !(id === 'budget' && S.level === 'ad'));
    if (!kinds.some(([id]) => id === S.action)) S.action = 'disable';
    const learnKind = KIND_OF[S.action];
    const nameInput = h('input', { class: 'input mono', value: S.nameTemplate, maxlength: '100', 'aria-label': 'Шаблон имени', spellcheck: 'false' });
    nameInput.oninput = () => { S.nameTemplate = nameInput.value; };
    const budgetInput = h('input', { class: 'input', type: 'number', min: '0', step: '0.01', value: S.budgetValue, 'aria-label': 'Значение', placeholder: S.budgetMode === 'multiply' ? '1.2' : '50' });
    budgetInput.oninput = () => { S.budgetValue = budgetInput.value; };
    const qInput = h('input', { class: 'input', type: 'search', value: S.q, placeholder: 'Имя содержит…', 'aria-label': 'Фильтр по имени' });
    qInput.oninput = () => { S.q = qInput.value; };
    const stateSelect = h('select', { class: 'select', 'aria-label': 'Какие объекты' }, [['all', 'Все'], ['enabled', 'Только включённые'], ['disabled', 'Только выключенные']].map(([id, title]) => h('option', { value: id, selected: S.state === id }, title)));
    stateSelect.onchange = () => { S.state = stateSelect.value; S.plan = null; render(); };
    const select = (patch) => { Object.assign(S, patch, { plan: null, confirm: false }); render(); };

    fill(body,
      h('div', { class: 'alert info' }, icon('layers', 15), h('div', null, ids ? h('b', null, `Выбрано объектов: ${explicitCount}`) : h('b', null, `${accounts.length} РК`), ` · ${accounts.slice(0, 3).map((a) => a.name).join(', ')}${accounts.length > 3 ? '…' : ''}`)),
      lockLevel ? null : h('div', { class: 'seg', role: 'group', 'aria-label': 'Уровень' }, LEVELS.map(([id, title]) => h('button', { type: 'button', 'aria-pressed': String(S.level === id), onclick: () => select({ level: id }) }, title))),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Действие' }, kinds.map(([id, title]) => h('button', { type: 'button', 'aria-pressed': String(S.action === id), onclick: () => select({ action: id, state: ids ? 'all' : id === 'enable' ? 'disabled' : id === 'disable' ? 'enabled' : 'all' }) }, title))),
      S.status && !ready() ? h('div', { class: 'alert warn' }, icon('alert', 15), h('div', { class: 'grow' },
        h('b', null, 'Действие ещё не обучено'),
        h('p', { class: 'small' }, 'Выполните его один раз в TikTok на тестовом объекте — расширение запомнит запрос и подтвердит результат.'),
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => openLearnSheet(ctx, { account: accounts[0]?.id, level: S.level, kind: learnKind, onClose: reopen }) }, icon('play', 13), 'Обучить'))) : null,
      ids ? null : h('div', { class: 'row wrap' }, h('div', { style: { flex: '1', minWidth: '150px' } }, stateSelect), h('div', { style: { flex: '1', minWidth: '130px' } }, qInput)),
      S.action === 'rename' ? h('label', { class: 'field' }, h('span', { class: 'label' }, 'Новое имя (шаблон)'), nameInput, h('span', { class: 'hint' }, '{name} — прежнее имя, {n} — номер в кабинете, {date} — ММДД')) : null,
      S.action === 'budget' ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Бюджет'),
        h('div', { class: 'row' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Способ' }, [['multiply', '× коэффициент'], ['set', 'Задать']].map(([id, title]) => h('button', { type: 'button', 'aria-pressed': String(S.budgetMode === id), onclick: () => { S.budgetMode = id; S.plan = null; render(); } }, title))), budgetInput),
        h('span', { class: 'hint' }, 'Объекты без собственного бюджета (например, при CBO) пропускаются. По правилам TikTok новый бюджет не может быть ниже ~105% уже потраченного — такой запрос он отклонит.')) : null,
      planBlock(), jobBlock());
    renderFoot();
  }

  render(); refresh();
  openSheet({
    title: 'Массовое действие', body, foot: footBox, kind: 'objects',
    onClose: () => { stopped = true; unwatch(); }
  });
}
