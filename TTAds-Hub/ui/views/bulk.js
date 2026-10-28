// Массовые действия над выбранными РК: передача владения (transfer) в другой BC и привязка к Payment Portfolio.
// Кабинеты группируются по BC-владельцу; задачи идут в фоне, прогресс — в accessLastJob.
import { h, fill, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import * as bus from '../lib/bus.js';
import { targetPicker, short } from './share.js';

const ID = /^\d{5,30}$/;

export function groupByBc(accounts = []) {
  const map = new Map();
  for (const item of accounts) {
    if (!ID.test(item.bcId || '')) continue;
    if (!map.has(item.bcId)) map.set(item.bcId, []);
    map.get(item.bcId).push(item.id);
  }
  return [...map].map(([sourceBusinessCenterId, accountIds]) => ({ sourceBusinessCenterId, accountIds }));
}

function savePartners(ctx, partners) {
  ctx.saveSettings({ automation: { ...ctx.settings.automation, partners } }).catch(() => {});
}

export function openTransferSheet(ctx, { accounts = [], onStarted } = {}) {
  const auto = ctx.settings?.automation || {};
  let partners = [...(auto.partners || [])];
  let target = auto.transfer?.targetBusinessCenterId || '';
  const own = ctx.accounts.peek()?.businessCenters || [];
  const groups = groupByBc(accounts);
  const skipped = accounts.filter((item) => !ID.test(item.bcId || '')).length;
  const sources = groups.map((group) => group.sourceBusinessCenterId);
  const total = groups.reduce((sum, group) => sum + group.accountIds.length, 0);
  const body = h('div', { class: 'stack' });
  const submit = h('button', { class: 'btn primary', type: 'button', disabled: !total }, icon('swap', 14), `Передать ${total} РК`);

  function render() {
    fill(body,
      h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null,
        h('b', null, 'Transfer меняет владельца РК.'),
        h('p', { class: 'small' }, 'TikTok разрешает его eligible-BC: оба BC Approved, валюта РК = валюте BC получателя, нет неоплаченных счетов Auto Pay. Активные кампании могут остановиться, средства между разными Company не переходят. Получатель должен одобрить запрос.'))),
      h('div', { class: 'alert info' }, icon('info', 15), h('div', null,
        h('b', null, `${total} РК`), sources.length ? ` из ${sources.length > 1 ? `${sources.length} BC` : `BC ${short(sources[0])}`}` : '',
        skipped ? h('p', { class: 'small' }, `${skipped} РК без BC-владельца пропущены: личный кабинет передаётся только шарингом/Request Access.`) : null,
        h('p', { class: 'small muted' }, 'Если меню Transfer у BC нет, используйте «Расшарить» — это работает для любых BC.'))),
      targetPicker({
        label: 'Кому передать (BC получателя)', partners, own, value: target ? [target] : [], exclude: sources.length === 1 ? sources : [],
        onChange: (next) => { target = next.filter((id) => id !== target).at(-1) || next.at(-1) || ''; render(); },
        onPartners: (next) => { partners = next; savePartners(ctx, partners); }
      }));
  }

  submit.onclick = async () => {
    if (!ID.test(target)) return toast('Выберите BC получателя', 'error');
    submit.disabled = true;
    try {
      const job = await bus.access.batch({ type: 'transfer', groups, targetBusinessCenterId: target });
      ctx.saveSettings({ automation: { ...ctx.settings.automation, partners, transfer: { ...(ctx.settings.automation.transfer || {}), targetBusinessCenterId: target } } }).catch(() => {});
      closeSheet();
      toast('Transfer запущен — окно можно закрыть, итог в журнале и на вкладке «Доступ»', 'ok', 6000);
      onStarted?.(job);
    } catch (error) {
      toast(error.message, 'error', 7000);
      submit.disabled = false;
    }
  };

  render();
  openSheet({ title: 'Передать владение РК', body, foot: [h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Отмена'), submit] });
}

export function openPortfolioSheet(ctx, { accounts = [], onStarted } = {}) {
  const groups = groupByBc(accounts);
  const total = groups.reduce((sum, group) => sum + group.accountIds.length, 0);
  const skipped = accounts.length - total;
  const portfolio = h('input', { class: 'input mono', inputmode: 'numeric', maxlength: '30', placeholder: 'ID Payment Portfolio (необязательно)' });
  const submit = h('button', { class: 'btn primary', type: 'button', disabled: !total }, icon('card', 14), `Подключить ${total} РК`);
  const body = h('div', { class: 'stack' },
    h('div', { class: 'alert info' }, icon('info', 15), h('div', null,
      h('b', null, `${total} РК в ${groups.length} BC`),
      h('p', { class: 'small' }, 'Расширение откроет Finance → Payment management каждого BC и свяжет РК с Payment Portfolio: кабинеты получат общую карту и средства портфеля. Нужны роли BC Admin и Finance Manager.'),
      skipped ? h('p', { class: 'small muted' }, `${skipped} РК без BC пропущены: карту личного кабинета привязывают на вкладке «Оплата».`) : null)),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Payment Portfolio'), portfolio),
    h('p', { class: 'small muted' }, 'Пусто — TikTok предложит портфель BC по умолчанию. Финансовое подтверждение выполняется только этим нажатием.'));

  submit.onclick = async () => {
    const portfolioId = portfolio.value.replace(/\D+/g, '');
    if (portfolioId && !ID.test(portfolioId)) return toast('ID Portfolio — это 5–30 цифр', 'error');
    submit.disabled = true;
    try {
      const job = await bus.access.batch({ type: 'link-portfolio', groups, portfolioId });
      closeSheet();
      toast('Привязка запущена — итог в журнале и на вкладке «Доступ»', 'ok', 6000);
      onStarted?.(job);
    } catch (error) {
      toast(error.message, 'error', 7000);
      submit.disabled = false;
    }
  };

  openSheet({ title: 'Общая карта: Payment Portfolio', body, foot: [h('button', { class: 'btn', type: 'button', onclick: () => closeSheet() }, 'Отмена'), submit] });
}

const BATCH_STATE = {
  running: ['выполняется…', 'info'], complete: ['готово', 'ok'], partial: ['готово частично', 'warn'],
  'needs-user': ['нужно действие во вкладке TikTok', 'warn'], error: ['ошибка', 'err'], interrupted: ['прервано', 'warn']
};

// Статус последней пакетной операции (transfer / Portfolio) для «Обзора» и «Доступа».
export function batchJobBlock(job, { onOpen, onHide } = {}) {
  if (!job || !/-batch$/.test(job.type || '')) return null;
  const [label, kind] = BATCH_STATE[job.state] || [job.state, 'info'];
  const transfer = job.plan?.type === 'transfer';
  const results = job.results || [];
  return h('div', { class: `alert ${kind}` }, icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert', 15),
    h('div', { class: 'grow' },
      h('b', null, `${transfer ? `Transfer → BC ${short(job.plan.targetBusinessCenterId)}` : 'Payment Portfolio'}: ${label}`),
      job.progress ? h('p', { class: 'small' }, `BC ${short(job.progress.sourceBusinessCenterId)} (${job.progress.current}/${job.progress.total})`) : null,
      results.map((result) => h('p', { class: 'small' }, `${(result.accountIds || []).length} РК из BC ${short(result.sourceBusinessCenterId)}: `,
        result.success ? (transfer ? 'запрос отправлен, ждёт одобрения получателя' : 'связано ✓') : result.error || (result.needsUser ? 'подтвердите во вкладке' : result.pending ? 'TikTok обрабатывает' : 'не выполнено'))),
      job.error ? h('p', { class: 'small' }, job.error) : null,
      h('div', { class: 'row' },
        job.tabId && !['complete', 'running'].includes(job.state) ? h('button', { class: 'linklike', type: 'button', onclick: onOpen }, 'Открыть вкладку') : null,
        h('span', { class: 'spacer' }),
        onHide && job.state !== 'running' ? h('button', { class: 'linklike', type: 'button', onclick: onHide }, 'скрыть') : null)));
}
