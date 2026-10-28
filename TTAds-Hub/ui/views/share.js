// Общий UI шаринга РК в другой Business Center: выбор получателя, шторка запуска и блок статуса задачи.
import { h, fill, toast, copyText } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import * as bus from '../lib/bus.js';

const ID = /^\d{5,30}$/;
export const short = (id) => (id ? `…${String(id).slice(-6)}` : '—');
export const PERMISSIONS = [
  ['Admin', 'Admin — полный доступ'],
  ['Operator', 'Operator — кампании и финансы'],
  ['Analyst', 'Analyst — только статистика']
];

export function permissionSelect(value, onChange) {
  const select = h('select', { class: 'select' }, PERMISSIONS.map(([id, title]) => h('option', { value: id, selected: value === id }, title)));
  select.onchange = () => onChange(select.value);
  return select;
}

export function switchRow(title, sub, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, title), sub ? h('span', null, sub) : null), input, h('span', { class: 'track' }));
}

export function checkRow(text, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', null, text));
}

// Получатели: сохранённые партнёры + собственные BC из кэша Ads Manager + ручной ввод ID (сохраняется в партнёры).
export function targetPicker({ partners = [], own = [], value = [], exclude = [], onChange, onPartners, label = 'Куда расшарить' }) {
  const selected = new Set(value);
  const host = h('div', { class: 'target-picker' });
  const idInput = h('input', { class: 'input mono', inputmode: 'numeric', placeholder: 'ID BC получателя', maxlength: '30' });
  const nameInput = h('input', { class: 'input', placeholder: 'Название (необязательно)', maxlength: '60' });

  const choices = () => {
    const list = [];
    for (const item of partners) if (!exclude.includes(item.id)) list.push({ ...item, saved: true });
    for (const item of own) if (!exclude.includes(item.id) && !list.some((entry) => entry.id === item.id)) list.push({ ...item, own: true });
    for (const id of selected) if (!list.some((entry) => entry.id === id) && !exclude.includes(id)) list.push({ id, name: '', saved: false });
    return list;
  };

  function add() {
    const id = idInput.value.replace(/\D+/g, '');
    if (!ID.test(id)) { toast('ID Business Center — это 5–30 цифр', 'error'); idInput.focus(); return; }
    if (exclude.includes(id)) { toast('Это исходный BC — выберите другой', 'error'); return; }
    const name = nameInput.value.trim().slice(0, 60);
    selected.add(id);
    if (!partners.some((item) => item.id === id)) {
      partners = [{ id, name }, ...partners].slice(0, 50);
      onPartners?.(partners);
    }
    idInput.value = ''; nameInput.value = '';
    onChange?.([...selected]);
    render();
  }
  idInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } });

  function render() {
    const list = choices();
    fill(host,
      h('span', { class: 'label' }, label),
      list.length ? h('div', { class: 'target-chips' }, list.map((item) => {
        const on = selected.has(item.id);
        return h('span', { class: `target-chip${on ? ' on' : ''}` },
          h('button', { type: 'button', class: 'target-main', 'aria-pressed': String(on), title: `BC ${item.id}`, onclick: () => {
            if (on) selected.delete(item.id); else selected.add(item.id);
            onChange?.([...selected]);
            render();
          } }, on ? icon('check', 12) : null, h('span', null, item.name || 'BC'), h('span', { class: 'mono' }, short(item.id)), item.own ? h('span', { class: 'pill' }, 'мой') : null),
          item.saved ? h('button', { type: 'button', class: 'target-del', title: 'Удалить из сохранённых', 'aria-label': 'Удалить из сохранённых', onclick: () => {
            partners = partners.filter((entry) => entry.id !== item.id);
            selected.delete(item.id);
            onPartners?.(partners);
            onChange?.([...selected]);
            render();
          } }, icon('x', 11)) : null);
      })) : h('p', { class: 'small muted' }, 'Добавьте ID Business Center получателя — он сохранится для следующих запусков.'),
      h('div', { class: 'target-add' }, idInput, nameInput, h('button', { class: 'btn sm', type: 'button', onclick: add, title: 'Добавить и сохранить' }, icon('plus', 13))));
  }
  render();
  return host;
}

export function targetName(ctx, id) {
  const auto = ctx.settings?.automation || {};
  return auto.partners?.find((item) => item.id === id)?.name || ctx.accounts.peek()?.businessCenters?.find((item) => item.id === id)?.name || `BC ${short(id)}`;
}

// Получатели и права из последнего сохранённого выбора: по ним работает кнопка «в один клик».
export function quickShareConfig(ctx) {
  const share = ctx.settings?.automation?.share || {};
  const targets = (share.targets || []).filter((id) => ID.test(id));
  const first = targets[0] ? targetName(ctx, targets[0]) : '';
  return { targets, permission: share.permission || 'Admin', autoAccept: share.autoAccept !== false, label: targets.length ? `${first}${targets.length > 1 ? ` +${targets.length - 1}` : ''}` : '' };
}

// Расшарить без шторки. РК без известного BC-владельца пропускаются (для них нужна шторка с выбором BC).
export async function quickShare(ctx, accounts, { onStarted } = {}) {
  const config = quickShareConfig(ctx);
  if (!config.targets.length) return openShareSheet(ctx, { accounts, onStarted });
  const map = new Map();
  for (const item of accounts) {
    if (!ID.test(item.bcId || '')) continue;
    if (!map.has(item.bcId)) map.set(item.bcId, []);
    map.get(item.bcId).push(item.id);
  }
  if (!map.size) return openShareSheet(ctx, { accounts, onStarted });
  const skipped = accounts.filter((item) => !ID.test(item.bcId || '')).length;
  try {
    const job = await bus.share.start({ groups: [...map].map(([sourceBusinessCenterId, accountIds]) => ({ sourceBusinessCenterId, accountIds })), targets: config.targets, permission: config.permission, autoAccept: config.autoAccept });
    toast(`Шаринг → ${config.label} запущен${skipped ? ` (${skipped} РК без BC пропущены)` : ''} — окно можно закрыть`, 'ok', 6000);
    onStarted?.(job);
    return job;
  } catch (error) {
    toast(error.message, 'error', 7000);
    return null;
  }
}

// Шторка «Расшарить выбранные РК»: группирует кабинеты по исходному BC и запускает фоновую задачу.
export function openShareSheet(ctx, { accounts = [], onStarted } = {}) {
  const auto = ctx.settings?.automation || {};
  let targets = [...(auto.share?.targets || [])];
  let permission = auto.share?.permission || 'Admin';
  let autoAccept = auto.share?.autoAccept !== false;
  let partners = [...(auto.partners || [])];
  const own = ctx.accounts.peek()?.businessCenters || [];
  const unknown = accounts.filter((item) => !ID.test(item.bcId || ''));
  let fallbackBc = own[0]?.id || '';
  const sources = [...new Set(accounts.map((item) => item.bcId).filter((id) => ID.test(id || '')))];

  const body = h('div', { class: 'stack' });
  const submit = h('button', { class: 'btn primary', type: 'button' }, icon('send', 14), `Расшарить ${accounts.length} РК`);

  function groups() {
    const map = new Map();
    for (const item of accounts) {
      const bcId = ID.test(item.bcId || '') ? item.bcId : fallbackBc;
      if (!ID.test(bcId || '')) continue;
      if (!map.has(bcId)) map.set(bcId, []);
      map.get(bcId).push(item.id);
    }
    return [...map].map(([sourceBusinessCenterId, accountIds]) => ({ sourceBusinessCenterId, accountIds }));
  }

  function render() {
    const bcSelect = h('select', { class: 'select' }, own.map((bc) => h('option', { value: bc.id, selected: bc.id === fallbackBc }, `${bc.name} · ${short(bc.id)}`)));
    bcSelect.onchange = () => { fallbackBc = bcSelect.value; };
    fill(body,
      h('div', { class: 'alert info' }, icon('info', 15), h('div', null,
        h('b', null, `${accounts.length} РК`), sources.length ? ` из ${sources.length > 1 ? `${sources.length} BC` : `BC ${short(sources[0])}`}` : '',
        h('p', { class: 'small' }, 'Расширение откроет Partners исходного BC, добавит получателя партнёром (или найдёт существующего) и выдаст права на выбранные РК.'))),
      unknown.length ? h('label', { class: 'field' }, h('span', { class: 'label' }, `BC-владелец для ${unknown.length} РК без известного BC`), own.length ? bcSelect : h('p', { class: 'small muted' }, 'Откройте Ads Manager и обновите список кабинетов.')) : null,
      targetPicker({
        partners, own, value: targets, exclude: sources.length === 1 ? sources : [],
        onChange: (next) => { targets = next; },
        onPartners: (next) => { partners = next; ctx.saveSettings({ automation: { ...ctx.settings.automation, partners } }).catch(() => {}); }
      }),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Права партнёра на РК'), permissionSelect(permission, (value) => { permission = value; })),
      checkRow('Сразу принять приглашение в BC получателя (если вы админ и там)', autoAccept, (value) => { autoAccept = value; }));
  }

  submit.onclick = async () => {
    const list = groups();
    if (!list.length) return toast('Не удалось определить BC-владельца РК', 'error');
    if (!targets.length) return toast('Выберите или добавьте BC получателя', 'error');
    submit.disabled = true;
    try {
      const job = await bus.share.start({ groups: list, targets, permission, autoAccept });
      // Запоминаем выбор: следующий запуск (и конвейер) предложит тех же получателей и права.
      ctx.saveSettings({ automation: { ...ctx.settings.automation, partners, share: { ...ctx.settings.automation.share, targets, permission, autoAccept } } }).catch(() => {});
      closeSheet();
      toast('Шаринг запущен — прогресс виден в списке', 'ok', 5000);
      onStarted?.(job);
    } catch (error) {
      toast(error.message, 'error', 7000);
      submit.disabled = false;
    }
  };

  render();
  openSheet({
    title: 'Расшарить в другой BC',
    body,
    foot: [h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Отмена'), submit]
  });
}

const SHARE_STATE = {
  running: ['Шаринг выполняется…', 'info'],
  complete: ['Расшарено', 'ok'],
  partial: ['Расшарено с замечаниями', 'warn'],
  'needs-user': ['Нужно действие во вкладке TikTok', 'warn'],
  error: ['Шаринг не выполнен', 'err'],
  interrupted: ['Шаринг прерван', 'warn']
};

// Блок статуса последней задачи шаринга (вкладки «Создать» и «Доступ»).
export function shareJobBlock(job, { onResume, onOpen } = {}) {
  if (!job?.plan) return null;
  const [label, kind] = SHARE_STATE[job.state] || [job.state, 'info'];
  const results = job.results || [];
  const failed = results.filter((entry) => !entry.share?.success);
  const diagnostics = results.filter((entry) => entry.share?.diagnostics || entry.accept?.diagnostics)
    .map((entry) => ({ target: short(entry.targetBusinessCenterId), share: pickDiag(entry.share), accept: pickDiag(entry.accept) }));
  const progress = job.progress;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title' }, icon('send', 15), 'Шаринг в BC'),
      h('div', { class: 'row' },
        ['needs-user', 'partial', 'error', 'interrupted'].includes(job.state) && failed.length ? h('button', { class: 'btn sm primary', type: 'button', onclick: onResume }, icon('play', 13), 'Повторить') : null,
        job.tabId && job.state !== 'complete' ? h('button', { class: 'btn sm', type: 'button', onclick: onOpen }, icon('external', 13), 'Вкладка') : null)),
    h('div', { class: `alert ${kind}` }, icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert', 15), h('div', { class: 'grow' },
      h('b', null, label),
      progress ? h('p', { class: 'small' }, progress.phase === 'accept' ? `Принимаю приглашение в BC ${short(progress.target)}…` : `BC ${short(progress.sourceBusinessCenterId)} → ${short(progress.target)} (${progress.current}/${progress.total})`) : null,
      results.map((entry) => h('p', { class: 'small' },
        `${(entry.accountIds || []).length || ''} РК · BC ${short(entry.sourceBusinessCenterId)} → ${short(entry.targetBusinessCenterId)}: `,
        entry.share?.success
          ? (entry.accept?.success ? 'расшарено и принято ✓' : entry.share.acceptanceRequired ? 'приглашение отправлено' : 'расшарено ✓')
          : (entry.share?.hint || entry.share?.error || 'не выполнено'))),
      job.error ? h('p', { class: 'small' }, job.error) : null,
      (job.warnings || []).slice(0, 4).map((text) => h('p', { class: 'small muted' }, text)),
      diagnostics.length ? h('button', { class: 'linklike', type: 'button', onclick: async () => {
        if (await copyText(JSON.stringify(diagnostics, null, 1))) toast('Диагностика скопирована — пришлите её разработчику, если TikTok изменил интерфейс', 'ok', 6000);
      } }, 'Скопировать диагностику') : null)));
}

function pickDiag(result) {
  if (!result || result.success) return result?.success ? { ok: true } : undefined;
  return { step: result.step, error: result.error, reason: result.reason, trail: result.trail, ui: result.diagnostics };
}
