// Привязка карты к выбранному РК через штатный Payment Portfolio TikTok.
import { h, fill, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';

export function mountBilling(root, ctx) {
  let stopped = false;
  let selectedId = ctx.account || '';
  let status = null;
  let loading = false;
  const host = h('div', { class: 'stack' });
  root.append(host);

  const cache = () => ctx.accounts.peek();
  const selected = () => cache()?.accounts?.find((a) => a.id === selectedId) || null;

  function accountOptions(accounts) {
    const byBc = new Map();
    for (const account of accounts) {
      const group = account.businessCenter || 'Личный рекламный кабинет';
      byBc.set(group, [...(byBc.get(group) || []), account]);
    }
    return [...byBc].map(([label, items]) => h('optgroup', { label }, items.map((account) =>
      h('option', { value: account.id, selected: account.id === selectedId }, `${account.name} · …${account.id.slice(-8)}`))));
  }

  function statusBlock(account) {
    if (loading) return h('div', { class: 'alert info' }, icon('refresh', 16), h('div', null, 'Проверяю Payment Portfolio…'));
    if (!status) return h('div', { class: 'alert info' }, icon('info', 16), h('div', null,
      account.bcId ? 'Для РК Business Center проверка и добавление выполняются в Finance → Payment management.' : 'Нажмите «Проверить привязку», чтобы прочитать способы оплаты выбранного РК.'));
    if (status.error) return h('div', { class: 'alert err' }, icon('alert', 16), h('div', null, status.error));
    if (status.mode === 'business-center') return h('div', { class: 'alert warn' }, icon('building', 16), h('div', null, status.message));

    const methods = status.paymentMethods || [];
    return h('div', { class: 'stack' },
      status.automaticPaymentPaused ? h('div', { class: 'alert err' }, icon('alert', 16), h('div', null,
        h('b', null, 'Автоплатёж приостановлен'),
        status.amountDue ? h('p', { class: 'small' }, `К оплате: ${status.amountDue.amount} ${status.amountDue.currency}`) : null)) : null,
      h('div', { class: 'row wrap' },
        status.portfolio ? h('span', { class: 'pill cyan' }, status.portfolio) : null,
        status.billingOption ? h('span', { class: 'pill' }, status.billingOption) : null,
        status.cashBalance ? h('span', { class: 'pill' }, `Баланс ${status.cashBalance.amount} ${status.cashBalance.currency}`) : null),
      methods.length
        ? h('div', { class: 'stack' }, methods.map((method) => h('div', { class: 'payment-method' },
          h('span', { class: 'payment-brand' }, icon('card', 18)),
          h('span', null, h('b', { class: 'mono' }, `•••• ${method.last4}`),
            h('small', { class: 'muted' }, ` ${method.currency || account.currency || ''}${method.expiry ? ` · до ${method.expiry}` : ''}`)),
          h('span', { class: 'pill ok' }, 'привязана'))))
        : h('div', { class: 'alert warn' }, icon('card', 16), h('div', null, 'Привязанных карт не найдено.')));
  }

  async function check(account) {
    loading = true; status = null; render();
    try { status = await bus.billing.probe(account.id, account.bcId || ''); }
    catch (error) { status = { error: error.message }; }
    loading = false;
    if (!stopped) render();
  }

  async function start(account) {
    try {
      const result = await bus.billing.start(account.id, account.bcId || '');
      toast(result.message || 'Платежная страница открыта', result.ok ? 'ok' : 'error', 6000);
      if (ctx.mode === 'popup') window.close();
    } catch (error) { toast(error.message, 'error', 6000); }
  }

  async function open(account) {
    try {
      await bus.billing.open(account.id, account.bcId || '');
      if (ctx.mode === 'popup') window.close();
    } catch (error) { toast(error.message, 'error'); }
  }

  function render() {
    const accounts = cache()?.accounts || [];
    if (!accounts.length) {
      fill(host, h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('card', 23)),
        h('h3', null, 'Сначала загрузите кабинеты'),
        h('p', null, ctx.onAds ? 'Расширение прочитает доступные РК из текущей сессии TikTok.' : 'Откройте ads.tiktok.com и повторите.'),
        ctx.onAds ? h('button', { class: 'btn primary', type: 'button', onclick: load }, icon('refresh', 14), 'Загрузить кабинеты') : null));
      return;
    }
    if (!selectedId || !accounts.some((a) => a.id === selectedId)) selectedId = ctx.account && accounts.some((a) => a.id === ctx.account) ? ctx.account : accounts[0].id;
    const account = selected();
    const select = h('select', { class: 'select', 'aria-label': 'Рекламный кабинет' }, accountOptions(accounts));
    select.addEventListener('change', () => { selectedId = select.value; status = null; render(); });
    const viaBc = Boolean(account.bcId);

    fill(host,
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('card', 16), 'Привязка карты к РК'), h('span', { class: `pill ${viaBc ? 'warn' : 'cyan'}` }, viaBc ? 'через Business Center' : 'через Ads Manager')),
        h('p', { class: 'card-sub' }, 'Выберите рекламный кабинет. Расширение откроет его платежный портфель и сразу запустит штатную форму добавления карты.'),
        h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', { class: 'label' }, 'Рекламный кабинет'), select),
        h('div', { class: 'account-payment-meta' },
          h('b', null, account.name),
          h('span', { class: 'mono muted' }, account.id),
          h('span', { class: 'small muted' }, [account.businessCenter, account.country, account.currency].filter(Boolean).join(' · '))),
        viaBc ? h('div', { class: 'alert warn', style: { marginTop: '10px' } }, icon('building', 16), h('div', null,
          h('b', null, 'Кабинет принадлежит Business Center'),
          h('p', { class: 'small' }, 'TikTok разрешает добавлять карту только через Finance → Payment management. Нужны Business Center Admin и Finance Manager.'))) : null),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('shield', 15), 'Текущая привязка'),
          h('button', { class: 'btn sm', type: 'button', disabled: loading, onclick: () => check(account) }, icon('refresh', 13), 'Проверить')),
        statusBlock(account)),
      h('section', { class: 'card payment-flow' },
        h('div', { class: 'card-title' }, icon('zap', 15), 'Как проходит привязка'),
        h('ol', null,
          h('li', null, `Открывается платежный контур для РК …${account.id.slice(-8)}.`),
          h('li', null, viaBc ? 'В Business Center выбирается Payment management.' : 'Расширение нажимает «Add a payment method».'),
          h('li', null, 'Карта вводится в защищённой форме TikTok/PipoPay и отправляется кнопкой Submit.'),
          h('li', null, 'После проверки карта появляется в Payment Portfolio и используется связанными с ним РК.')),
        h('div', { class: 'row wrap', style: { marginTop: '10px' } },
          h('button', { class: 'btn primary grow', type: 'button', onclick: () => start(account) }, icon('card', 15), 'Привязать карту к РК'),
          h('button', { class: 'btn', type: 'button', onclick: () => open(account) }, icon('external', 14), 'Открыть оплату'))),
      h('section', { class: 'card' },
        h('div', { class: 'card-title' }, icon('layers', 15), 'Когда новый РК получает ту же карту'),
        h('div', { class: 'billing-cases' },
          h('div', { class: 'billing-case ok' }, h('b', null, 'Тот же Payment Portfolio'), h('span', null, 'Да. Связанный РК использует сохранённые способы оплаты портфеля; повторно вводить карту не нужно.')),
          h('div', { class: 'billing-case warn' }, h('b', null, 'Новый BC или другой портфель'), h('span', null, 'Нет автоматической глобальной привязки. Карту нужно добавить в этот портфель или связать РК с портфелем, где она уже есть.')),
          h('div', { class: 'billing-case' }, h('b', null, 'Карта есть в другом РК'), h('span', null, 'Одного совпадения карты недостаточно: решающей является связь РК с Payment Portfolio и финансовые права пользователя.')))));
  }

  async function load() {
    try { await ctx.accounts.get({ force: true }); }
    catch (error) { toast(error.message, 'error'); }
    if (!stopped) render();
  }

  render();
  ctx.accounts.get().then(() => { if (!stopped) render(); }).catch(() => {});
  return () => { stopped = true; };
}
