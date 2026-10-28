// Сводка «здоровья» РК для интерфейса: статус, карта, билл (порог), долг, баланс, оплачено.
// Объединяет кэш проверки (таблица BC + платёжная страница), данные официального API и строку «Обзора». Чистый модуль.
import { STATUS_KINDS, classifyAccountStatus } from './parse.js';

const STALE_MS = 6 * 60 * 60 * 1000;

const money = (m) => (m && Number.isFinite(m.value) ? { value: m.value, currency: m.currency || '' } : null);

function statusOf(entry, api) {
  if (api?.status) {
    const s = classifyAccountStatus(api.status);
    if (s.kind !== 'unknown') return { ...s, source: 'api' };
  }
  const bc = entry?.bc?.status;
  if (bc && bc.kind && bc.kind !== 'unknown') return { kind: bc.kind, label: STATUS_KINDS[bc.kind]?.[0] || bc.label, text: bc.text, source: 'bc' };
  const banner = entry?.ads?.banner;
  if (banner?.kind) return { kind: banner.kind, label: STATUS_KINDS[banner.kind][0], text: banner.text, source: 'page' };
  if (entry?.ads?.ok) return { kind: 'unknown', label: 'Без ограничений', text: 'Платёжная страница открылась без предупреждений', source: 'page' };
  return { kind: 'unknown', label: STATUS_KINDS.unknown[0], text: '', source: '' };
}

function cardOf(ads) {
  const methods = Array.isArray(ads?.paymentMethods) ? ads.paymentMethods : [];
  if (methods.length) {
    const main = methods.find((m) => m.primary) || methods[0];
    return { linked: true, label: `${main.brand ? `${main.brand} ` : ''}•• ${main.last4}${methods.length > 1 ? ` +${methods.length - 1}` : ''}`, expiry: main.expiry || '', methods };
  }
  if (ads?.cardLinked === false) return { linked: false, label: 'Нет карты', methods: [] };
  if (ads?.financeAccessRequired) return { linked: null, label: 'Карта в BC (нет прав Finance)', methods: [] };
  if (ads?.managedByBc) return { linked: null, label: 'Карта в Payment Portfolio BC', methods: [] };
  return { linked: null, label: '', methods: [] };
}

function thresholdOf(entry) {
  const t = entry?.bc?.threshold || entry?.ads?.threshold;
  if (!t?.limit) return null;
  const used = t.used?.value ?? null, limit = t.limit.value;
  return { used, limit, currency: t.limit.currency, pct: used !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null };
}

// account — строка списка/«Обзора» ({ id, spend, currency, … }); entry — healthCache.accounts[id]; api — сведения официального API.
export function healthOf(account = {}, entry = null, api = null) {
  const ads = entry?.ads?.ok ? entry.ads : null;
  const status = statusOf(entry, api);
  const card = cardOf(ads || entry?.ads);
  const amountDue = money(ads?.amountDue);
  const balance = money(api?.balance !== undefined && api?.balance !== null ? { value: Number(api.balance), currency: api.currency || account.currency } : (ads?.cashBalance || entry?.bc?.balance));
  const tx = ads?.transactions || null;
  const billing = {
    mode: ads?.billingMode || '', text: ads?.billingText || '',
    portfolio: ads?.portfolio || '', portfolioId: ads?.portfolioId || '',
    threshold: thresholdOf(entry), billingDate: entry?.bc?.billingDate || ads?.billingDate || '',
    amountDue, balance, adCredit: money(ads?.adCredit),
    autopayPaused: ads?.autopayPaused === true, paymentFailed: ads?.paymentFailed === true,
    paid: tx?.paid?.value ? { value: tx.paid.value, currency: tx.paid.currency, count: tx.paidCount } : null,
    failedCount: tx?.failedCount || 0, lastPayment: tx?.last || null
  };
  const flags = [];
  if (card.linked === false) flags.push('no-card');
  if ((amountDue?.value ?? 0) > 0 || billing.autopayPaused || billing.paymentFailed || billing.failedCount > 0) flags.push('debt');
  if (status.kind === 'suspended') flags.push('suspended');
  if (status.kind === 'review') flags.push('review');
  if (status.kind === 'rejected') flags.push('rejected');
  if (ads?.verifyPhone) flags.push('verify-phone');
  const at = Math.max(entry?.ads?.at || 0, entry?.bc?.at || 0, api?.at || 0) || null;
  return {
    id: account.id || entry?.id || '', status, card, billing, flags,
    spend: Number.isFinite(account.spend) ? account.spend : null, currency: account.currency || billing.threshold?.currency || '',
    error: entry?.ads && !entry.ads.ok ? entry.ads.error || '' : '',
    at, stale: at ? Date.now() - at > STALE_MS : true, checked: Boolean(at)
  };
}

export const HEALTH_FILTERS = Object.freeze([
  ['no-card', 'Без карты'], ['debt', 'Долг/оплата'], ['suspended', 'Бан'], ['review', 'Проверка']
]);

export function countFlags(healths) {
  const out = { checked: 0, 'no-card': 0, debt: 0, suspended: 0, review: 0, rejected: 0, cards: 0 };
  for (const h of healths) {
    if (h.checked) out.checked += 1;
    if (h.card.linked) out.cards += 1;
    for (const flag of h.flags) if (flag in out) out[flag] += 1;
  }
  return out;
}

const fmt = (m) => (m ? `${Number(m.value).toFixed(2)} ${m.currency || ''}`.trim() : '');

export const HEALTH_COLUMNS = Object.freeze([
  { title: 'Статус РК', get: (a) => a.health?.status.label || '' },
  { title: 'Карта', get: (a) => a.health?.card.label || '' },
  { title: 'Оплата', get: (a) => a.health?.billing.text || '' },
  { title: 'Билл (порог)', get: (a) => (a.health?.billing.threshold ? `${a.health.billing.threshold.limit} ${a.health.billing.threshold.currency}` : '') },
  { title: 'Использовано из порога', get: (a) => (a.health?.billing.threshold?.used ?? '') },
  { title: 'Дата списания', get: (a) => a.health?.billing.billingDate || '' },
  { title: 'К оплате', get: (a) => fmt(a.health?.billing.amountDue) },
  { title: 'Баланс', get: (a) => fmt(a.health?.billing.balance) },
  { title: 'Оплачено', get: (a) => (a.health?.billing.paid ? `${a.health.billing.paid.value} ${a.health.billing.paid.currency}` : '') },
  { title: 'Неуспешных платежей', get: (a) => a.health?.billing.failedCount || '' },
  { title: 'Проверено', get: (a) => (a.health?.at ? new Date(a.health.at).toISOString().replace('T', ' ').slice(0, 16) : '') }
]);

/* ---------- автопроверка: что изменилось с прошлого раза ---------- */

export const ALERT_FLAGS = Object.freeze(['no-card', 'debt', 'suspended', 'rejected', 'review']);
export const FLAG_TEXT = Object.freeze({ 'no-card': 'нет карты', debt: 'долг или сбой оплаты', suspended: 'бан', rejected: 'отклонён', review: 'на проверке' });

// accounts — список кабинетов, cache — healthCache.accounts. Только проверенные кабинеты попадают в карту флагов.
export function flagMap(accounts = [], cache = {}) {
  const out = {};
  for (const account of accounts) {
    const health = healthOf(account, cache[account.id] ?? null);
    if (health.checked) out[account.id] = health.flags.filter((flag) => ALERT_FLAGS.includes(flag));
  }
  return out;
}

// Новые проблемы: флаг есть сейчас, а в прошлой проверке этого кабинета его не было. Без прошлой проверки — не оповещаем.
export function newProblems(prev = {}, next = {}) {
  const out = [];
  for (const [id, flags] of Object.entries(next)) {
    if (!(id in prev)) continue;
    const added = flags.filter((flag) => !prev[id].includes(flag));
    if (added.length) out.push({ id, added });
  }
  return out;
}

export function alertText(problems, names = {}, limit = 4) {
  const lines = problems.slice(0, limit).map(({ id, added }) => `${names[id] || `…${id.slice(-6)}`}: ${added.map((flag) => FLAG_TEXT[flag]).join(', ')}`);
  if (problems.length > limit) lines.push(`и ещё ${problems.length - limit}`);
  return lines.join('\n');
}
