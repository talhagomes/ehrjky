// Сводка по кабинетам для вкладки «Обзор»: состояние, причины, фильтры, сортировка, итоги, CSV. Чистый модуль.
import { normalizeRows, toCsv, csvCell } from '../explorer/model.js';
import { reasonText, classifyReason } from '../lib/reasons.js';

export { csvCell };

export const ACCOUNT_STATES = Object.freeze({
  delivering: ['Работает', 'ok'], issue: ['Не доставляется', 'warn'], paused: ['Выключено', 'info'], empty: ['Нет рекламы', ''], error: ['Ошибка', 'err']
});

const CAMPAIGN_LIMIT = 30; // сколько кампаний хранится в сводке кабинета (полный список грузит просмотр объектов)

// account — запись из списка кабинетов; result — ответ listObjectsInPage для этого кабинета.
export function summarizeAccount(account, result) {
  const base = { ...account, campaigns: [], totalCampaigns: 0, loadedCampaigns: 0, deliveringCampaigns: 0, enabledCampaigns: 0, problemCampaigns: 0, spend: 0, truncated: false, reasons: [] };
  if (!result || result.error) return { ...base, state: 'error', error: String(result?.error || 'Нет данных от TikTok').slice(0, 240) };
  const campaigns = normalizeRows('campaign', result.rows);
  const working = campaigns.filter((c) => c.status === 'working').length;
  const problems = campaigns.filter((c) => c.status === 'issue');
  const state = working ? 'delivering' : problems.length ? 'issue' : campaigns.length ? 'paused' : 'empty';
  const byReason = new Map();
  for (const c of problems) {
    const key = c.reason || 'Причина не указана';
    const entry = byReason.get(key) ?? { text: key, kind: c.reasonKind || classifyReason(key), count: 0 };
    entry.count += 1;
    byReason.set(key, entry);
  }
  const shown = [...campaigns].sort((a, b) => Number(b.status === 'issue') - Number(a.status === 'issue') || Number(b.status === 'working') - Number(a.status === 'working') || b.spend - a.spend).slice(0, CAMPAIGN_LIMIT);
  return {
    ...base, state, totalCampaigns: Math.max(result.total || 0, campaigns.length), loadedCampaigns: campaigns.length,
    deliveringCampaigns: working, enabledCampaigns: campaigns.filter((c) => c.enabled === true).length, problemCampaigns: problems.length,
    spend: campaigns.reduce((s, c) => s + c.spend, 0), truncated: Boolean(result.truncated),
    reasons: [...byReason.values()].sort((a, b) => b.count - a.count).slice(0, 4),
    campaigns: shown.map(({ id, name, status, enabled, reason, spend }) => ({ id, name, status, enabled, reason, spend }))
  };
}

export const isProblem = (a) => a.state === 'issue' || a.state === 'error';

export function countAccounts(accounts) {
  return {
    all: accounts.length, issues: accounts.filter(isProblem).length,
    working: accounts.filter((a) => a.state === 'delivering').length, off: accounts.filter((a) => a.state === 'paused' || a.state === 'empty').length
  };
}

export function filterAccounts(accounts, { filter = 'all', q = '' } = {}, meta = {}) {
  const needle = String(q).trim().toLowerCase();
  return accounts.filter((a) => {
    if (filter === 'issues' && !isProblem(a)) return false;
    if (filter === 'working' && a.state !== 'delivering') return false;
    if (filter === 'off' && a.state !== 'paused' && a.state !== 'empty') return false;
    if (!needle) return true;
    const m = meta[a.id] ?? {};
    return `${a.name} ${a.id} ${a.businessCenter} ${a.country} ${a.currency} ${m.label ?? ''} ${m.note ?? ''}`.toLowerCase().includes(needle);
  });
}

const STATE_ORDER = { error: 0, issue: 1, delivering: 2, paused: 3, empty: 4 };

export function sortAccounts(accounts, sort = 'problems', meta = {}) {
  const pinned = (a) => (meta[a.id]?.pinned ? 0 : 1);
  const cmp = {
    problems: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.spend - a.spend,
    spend: (a, b) => b.spend - a.spend,
    name: (a, b) => a.name.localeCompare(b.name, 'ru')
  }[sort] ?? (() => 0);
  return [...accounts].sort((a, b) => pinned(a) - pinned(b) || cmp(a, b));
}

export function spendByCurrency(accounts) {
  const map = new Map();
  for (const a of accounts) if (a.state !== 'error' && a.spend > 0) map.set(a.currency || '—', (map.get(a.currency || '—') ?? 0) + a.spend);
  return [...map].map(([currency, spend]) => ({ currency, spend })).sort((x, y) => y.spend - x.spend);
}

// Нужна ли кнопка «Пополнить»: хотя бы одна проблемная кампания с причиной «недостаточно средств».
export const needsTopUp = (a) => a.reasons?.some((r) => r.kind === 'balance') ?? false;

export const ACCOUNT_COLUMNS = Object.freeze([
  { title: 'ID', key: 'id' }, { title: 'Название', key: 'name' }, { title: 'Business Center', key: 'businessCenter' },
  { title: 'Страна', key: 'country' }, { title: 'Валюта', key: 'currency' }, { title: 'Состояние', get: (a) => (ACCOUNT_STATES[a.state] ?? [a.state])[0] },
  { title: 'Кампаний', key: 'totalCampaigns' }, { title: 'Работают', key: 'deliveringCampaigns' }, { title: 'Проблемы', key: 'problemCampaigns' },
  { title: 'Расход', get: (a) => Number(a.spend.toFixed(2)) }, { title: 'Причины', get: (a) => (a.error || a.reasons.map((r) => `${r.text} ×${r.count}`).join('; ')) },
  { title: 'Метка', get: (a) => a.meta?.label ?? '' }, { title: 'Заметка', get: (a) => a.meta?.note ?? '' }
]);

export function accountsToCsv(accounts, meta = {}) {
  return toCsv(accounts.map((a) => ({ ...a, meta: meta[a.id] ?? {} })), ACCOUNT_COLUMNS);
}

export { reasonText };
