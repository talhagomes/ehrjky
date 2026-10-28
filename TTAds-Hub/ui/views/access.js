// Доступ/владение: Request Access, self-service transfer и массовая связь с Payment Portfolio.
import { h, fill, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { openShareSheet, shareJobBlock, short } from './share.js';

const parseIds = (value) => [...new Set(String(value || '').match(/\d{5,30}/g) || [])];

export function mountAccess(root, ctx) {
  let stopped = false, running = '', last = null, scan = null;
  const cache = () => ctx.accounts.peek() || { accounts: [], businessCenters: [] };
  const currentBc = cache().accounts.find((account) => account.id === ctx.account)?.bcId || cache().businessCenters[0]?.id || '';
  let sourceBcId = currentBc;
  let targetBcId = cache().businessCenters.find((center) => center.id !== sourceBcId)?.id || '';
  let permission = 'Admin';
  let customIds = '';
  let shareJob = null, shareIds = '', created = [];
  const shareSel = new Set();
  const host = h('div', { class: 'stack' });
  root.append(host);

  const centers = () => cache().businessCenters || [];
  const accountsFor = (bcId) => cache().accounts.filter((account) => account.bcId === bcId);
  const personal = () => cache().accounts.filter((account) => !account.bcId);
  const requestedIds = () => parseIds(customIds).length ? parseIds(customIds) : personal().map((account) => account.id);

  function centerSelect(value, onchange, exclude = '') {
    const select = h('select', { class: 'select' }, centers().filter((center) => center.id !== exclude).map((center) =>
      h('option', { value: center.id, selected: center.id === value }, `${center.name} · …${center.id.slice(-8)}`)));
    select.onchange = () => onchange(select.value);
    return select;
  }

  function jobBlock() {
    if (!last) return null;
    const results = last.results || [];
    const success = results.filter((result) => result?.success || result?.requested || result?.linked).length;
    const errors = results.filter((result) => result?.error);
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('activity', 15), 'Последняя операция'),
        h('button', { class: 'btn sm', type: 'button', onclick: openLast, disabled: !last.tabId }, icon('external', 13), 'Открыть')),
      h('div', { class: `alert ${last.state === 'complete' ? 'ok' : errors.length ? 'err' : 'info'}` }, icon(last.state === 'complete' ? 'check' : errors.length ? 'alert' : 'info', 15),
        h('div', { class: 'grow' },
          h('b', null, `${last.type || 'Операция'} · ${last.state}`),
          h('p', { class: 'small' }, `Успешно: ${success} · ошибок: ${errors.length}`),
          last.error ? h('p', { class: 'small' }, last.error) : null,
          errors.slice(0, 4).map((result) => h('p', { class: 'small mono' }, `${result.accountId || ''} ${result.error}`.trim())),
          results.some((result) => result?.ownerApprovalRequired) ? h('p', { class: 'small' }, 'Владелец должен принять запрос в Notifications → Business Center в Ads Manager.') : null,
          results.some((result) => result?.recipientApprovalRequired) ? h('p', { class: 'small' }, 'Admin получающего BC должен одобрить transfer.') : null)));
  }

  async function run(kind, input) {
    if (running) return;
    running = kind; render();
    try {
      last = kind === 'request' ? await bus.access.request(input)
        : kind === 'transfer' ? await bus.access.transfer(input)
          : await bus.access.linkPortfolio(input);
      const errors = (last?.results || []).filter((result) => result?.error);
      if (last?.state === 'complete') toast('Операция TikTok выполнена', 'ok', 7000);
      else if (last?.state === 'needs-user') toast('TikTok открыл шаг, требующий подтверждения или finance-role', 'info', 7000);
      else toast(errors[0]?.error || last?.error || 'Операция завершена частично', errors.length ? 'error' : 'info', 7000);
    } catch (error) { toast(error.message, 'error', 7000); }
    running = '';
    if (!stopped) render();
  }

  async function inspect() {
    if (!sourceBcId) return toast('Business Center не выбран', 'error');
    running = 'inspect'; scan = null; render();
    try { scan = await bus.access.inspect(sourceBcId); toast('Возможности BC проверены', 'ok'); }
    catch (error) { scan = { error: error.message }; toast(error.message, 'error'); }
    running = ''; if (!stopped) render();
  }

  async function openLast() {
    try { await bus.access.openLast(); if (ctx.mode === 'popup') window.close(); }
    catch (error) { toast(error.message, 'error'); }
  }

  // Шаринг: РК выбранного BC (из кэша Ads Manager и списка созданных) + ручные ID.
  function shareCard() {
    const known = new Map(accountsFor(sourceBcId).map((account) => [account.id, account.name]));
    for (const item of created) if (item.businessCenterId === sourceBcId && !known.has(item.adAccountId)) known.set(item.adAccountId, item.adAccountName || item.adAccountId);
    const rows = [...known].slice(0, 60);
    const manual = parseIds(shareIds);
    const chosen = [...new Set([...rows.map(([id]) => id).filter((id) => shareSel.has(id)), ...manual])];
    const idsInput = h('textarea', { class: 'textarea mono', rows: '2', placeholder: 'Или вставьте ID РК этого BC' });
    idsInput.value = shareIds;
    idsInput.oninput = () => { shareIds = idsInput.value; };
    idsInput.onchange = () => render();
    return h('section', { class: 'card share-hero' },
      h('div', { class: 'card-title' }, icon('send', 15), 'Расшарить РК в другой BC'),
      h('p', { class: 'card-sub', style: { marginTop: '7px' } }, 'Partners: получатель становится партнёром и получает права на выбранные РК. Владелец не меняется, карта остаётся в вашем Portfolio.'),
      rows.length ? h('div', { class: 'share-pick' }, rows.map(([id, name]) => {
        const box = h('input', { type: 'checkbox', checked: shareSel.has(id) });
        box.onchange = () => { if (box.checked) shareSel.add(id); else shareSel.delete(id); render(); };
        return h('label', { class: 'check' }, box, h('span', null, name && name !== id ? `${name} · ` : '', h('span', { class: 'mono' }, short(id))));
      })) : h('p', { class: 'small muted' }, sourceBcId ? 'В кэше нет РК этого BC — вставьте ID вручную или обновите кабинеты в Ads Manager.' : 'Выберите рабочий Business Center выше.'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'ID вручную — необязательно'), idsInput),
      h('button', { class: 'btn primary block', type: 'button', disabled: !sourceBcId || !chosen.length,
        onclick: () => openShareSheet(ctx, { accounts: chosen.map((id) => ({ id, bcId: sourceBcId, name: known.get(id) || '' })), onStarted: (job) => { shareJob = job; render(); } }) },
        icon('send', 14), chosen.length ? `Расшарить ${chosen.length} РК…` : 'Отметьте РК для шаринга'));
  }

  function render() {
    const bcs = centers();
    const sourceAccounts = accountsFor(sourceBcId);
    const idsForRequest = requestedIds();
    const sourceSelect = centerSelect(sourceBcId, (value) => {
      sourceBcId = value;
      shareSel.clear();
      if (targetBcId === value) targetBcId = centers().find((center) => center.id !== value)?.id || '';
      scan = null; render();
    });
    const targetSelect = centerSelect(targetBcId, (value) => { targetBcId = value; render(); }, sourceBcId);
    const permissionSelect = h('select', { class: 'select' }, ['Admin', 'Operator', 'Analyst'].map((item) => h('option', { value: item, selected: permission === item }, item)));
    permissionSelect.onchange = () => { permission = permissionSelect.value; };
    const idsInput = h('textarea', { class: 'textarea mono', rows: '3', placeholder: 'ID РК через пробел, запятую или новую строку' });
    idsInput.value = customIds;
    idsInput.oninput = () => { customIds = idsInput.value; };

    fill(host,
      h('section', { class: 'card access-hero' },
        h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('swap', 16), 'Доступ, передача и наследование оплаты'),
          h('button', { class: 'btn sm', type: 'button', disabled: Boolean(running) || !sourceBcId, onclick: inspect }, running === 'inspect' ? h('span', { class: 'spinner' }) : icon('refresh', 13), 'Проверить')),
        h('p', { class: 'card-sub' }, 'Три разных механизма TikTok: Request Access не меняет владельца; Transfer переносит ownership; Payment Portfolio даёт связанным РК одну карту и общие платежные методы.'),
        bcs.length ? h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', { class: 'label' }, 'Рабочий Business Center'), sourceSelect)
          : h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, 'Список Business Center не загружен. Откройте Ads Manager и обновите кабинеты.')),
        scan ? h('div', { class: `alert ${scan.error ? 'err' : 'info'}` }, icon(scan.error ? 'alert' : 'info', 15), h('div', null,
          scan.error || `РК в BC: ${scan.accounts?.length || 0} · Add/Request: ${scan.canRequestAccess ? 'да' : 'нет'} · Transfer entry: ${scan.transferEntryVisible ? 'да' : 'не показан'} · Finance Manager: ${scan.financeManager ? 'есть' : 'нет'}`)) : null),

      shareCard(),
      shareJobBlock(shareJob, {
        onResume: async () => { try { shareJob = await bus.share.resume(); toast('Повторяю шаринг', 'ok'); } catch (error) { toast(error.message, 'error', 7000); } render(); },
        onOpen: async () => { try { await bus.share.openLast(); if (ctx.mode === 'popup') window.close(); } catch (error) { toast(error.message, 'error'); } }
      }),

      h('section', { class: 'card' },
        h('div', { class: 'card-title' }, icon('user-plus', 15), 'Добавить чужие/личные РК в BC'),
        h('p', { class: 'card-sub', style: { marginTop: '7px' } }, 'Отправляет Request Access. Исходный владелец сохраняется и должен одобрить запрос в Ads Manager.'),
        h('div', { class: 'two-col', style: { marginTop: '9px' } },
          h('label', { class: 'field' }, h('span', { class: 'label' }, 'Уровень'), permissionSelect),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Автовыбор'), h('div', { class: 'pill' }, `${personal().length} личных РК`))),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Конкретные ID — необязательно'), idsInput),
        h('button', { class: 'btn primary block', type: 'button', disabled: Boolean(running) || !sourceBcId || !idsForRequest.length,
          onclick: () => run('request', { businessCenterId: sourceBcId, accountIds: idsForRequest, permission }) },
          running === 'request' ? h('span', { class: 'spinner' }) : icon('send', 14), `Запросить ${permission} для ${idsForRequest.length} РК`)),

      h('section', { class: 'card' },
        h('div', { class: 'card-title' }, icon('card', 15), 'Одна карта для всех РК этого BC'),
        h('p', { class: 'card-sub', style: { marginTop: '7px' } }, 'Связывает все доступные РК выбранного BC с его Payment Portfolio. Нужны Admin + Finance Manager; РК должен быть Approved.'),
        h('div', { class: 'access-count' }, h('b', null, sourceAccounts.length), h('span', null, 'РК будут проверены и связаны с Portfolio')),
        h('button', { class: 'btn primary block', type: 'button', disabled: Boolean(running) || !sourceBcId || !sourceAccounts.length,
          onclick: () => run('portfolio', { businessCenterId: sourceBcId, accountIds: sourceAccounts.map((account) => account.id) }) },
          running === 'portfolio' ? h('span', { class: 'spinner' }) : icon('layers', 14), 'Связать все РК с Payment Portfolio')),

      h('section', { class: 'card' },
        h('div', { class: 'card-title' }, icon('swap', 15), 'Передать ownership в другой BC'),
        h('p', { class: 'card-sub', style: { marginTop: '7px' } }, 'Self-service transfer: до 30 РК за запрос. Кампании могут приостановиться; получающий BC должен одобрить запрос и пройти финансовые проверки.'),
        h('label', { class: 'field', style: { marginTop: '9px' } }, h('span', { class: 'label' }, 'Получающий Business Center'), targetSelect),
        h('div', { class: 'access-count warn' }, h('b', null, sourceAccounts.length), h('span', null, 'РК выбранного исходного BC; в один запрос попадут первые 30')),
        h('button', { class: 'btn danger block', type: 'button', disabled: Boolean(running) || !sourceBcId || !targetBcId || !sourceAccounts.length,
          onclick: () => run('transfer', { sourceBusinessCenterId: sourceBcId, targetBusinessCenterId: targetBcId, accountIds: sourceAccounts.slice(0, 30).map((account) => account.id) }) },
          running === 'transfer' ? h('span', { class: 'spinner' }) : icon('swap', 14), 'Передать ownership выбранных РК')),
      jobBlock(),
      h('section', { class: 'card' },
        h('div', { class: 'card-title' }, icon('info', 15), 'Что нельзя унаследовать автоматически'),
        h('p', { class: 'small muted', style: { marginTop: '7px' } }, 'Request Access не переносит владельца или карту. При Transfer owned assets перемещаются, но linked pixels, catalogs, audiences, TikTok accounts и Shops требуют отдельных прав. Между разными Company остаток может вернуться в исходный Portfolio; unpaid Auto Pay invoices блокируют transfer.')));
  }

  async function load() {
    try { await ctx.accounts.get({ force: true }); }
    catch { /* показываем доступный кэш */ }
    if (!sourceBcId) sourceBcId = cache().businessCenters[0]?.id || '';
    if (!targetBcId || targetBcId === sourceBcId) targetBcId = cache().businessCenters.find((center) => center.id !== sourceBcId)?.id || '';
    if (!stopped) render();
  }

  const unwatch = bus.watch(['shareLastJob', 'createdAssets'], (key, value) => {
    if (key === 'shareLastJob') shareJob = value; else created = Array.isArray(value) ? value : [];
    const el = document.activeElement;
    if (!stopped && !(el && host.contains(el) && el.tagName === 'TEXTAREA')) render();
  });
  render();
  Promise.all([ctx.accounts.get().catch(() => null), bus.access.status().catch(() => null), bus.share.status().catch(() => null), bus.registry.list().catch(() => [])]).then(([, job, lastShare, list]) => {
    last = job; shareJob = lastShare; created = list || []; load();
  });
  return () => { stopped = true; unwatch(); };
}
