// Нормализация строк списков кампаний / адсетов / объявлений, производные метрики, итоги, сортировка, CSV.
// Чистый модуль: принимает «сырые» строки, спроецированные page-скриптом, и ничего не знает о chrome.*.
import { classifyReason, reasonText } from '../lib/reasons.js';
import { PERIODS } from '../lib/constants.js';

export const LEVELS = Object.freeze([
  { id: 'campaign', title: 'Кампании', one: 'Кампания' },
  { id: 'adgroup', title: 'Адсеты', one: 'Адсет' },
  { id: 'ad', title: 'Объявления', one: 'Объявление' }
]);

// Поля строки, которые читаем из ответа TikTok (page-скрипт отдаёт только их).
export const ROW_KEYS = Object.freeze([
  'campaign_id', 'campaign_name', 'name', 'ad_id', 'ad_name', 'creative_id', 'creative_name',
  'opt_status', 'primary_status', 'campaign_status', 'campaign_status_list', 'ad_status', 'ad_status_list',
  'creative_status', 'creative_status_list', 'budget_auto_reset_fail_reason', 'campaign_budget', 'ad_budget', 'budget',
  'appeal_result', 'creative_aggr_tag_info', 'creative_detail_tag_info',
  'stat_cost', 'show_cnt', 'click_cnt', 'time_attr_convert_cnt'
]);

const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const str = (v, n = 180) => (v === null || v === undefined ? '' : String(v)).slice(0, n);
const asList = (value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : [value]; } catch { return [value]; }
};
const MODERATION = /offline_audit|reject|disapprov|review[ _]?issue|appeal[ _-]*reject/i;

export function normalizeRow(level, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ids = {
    campaign: { id: r.campaign_id, name: r.campaign_name ?? r.name },
    adgroup: { id: r.ad_id, name: r.ad_name ?? r.name },
    ad: { id: r.creative_id, name: r.creative_name ?? r.name }
  }[level];
  if (!ids) return null;
  const id = str(ids.id, 40);
  if (!/^\d{5,30}$/.test(id)) return null;
  const primary = str(r.primary_status, 60);
  const opt = r.opt_status === undefined || r.opt_status === null || r.opt_status === '' ? null : Number(r.opt_status);
  const enabled = opt === null ? (primary ? primary !== 'disable' : null) : opt === 1;
  const own = level === 'campaign' ? [r.campaign_status, ...asList(r.campaign_status_list)]
    : level === 'adgroup' ? [r.ad_status, ...asList(r.ad_status_list)]
      : [r.creative_status, ...asList(r.creative_status_list)];
  const reasons = [...new Set([...own, r.budget_auto_reset_fail_reason].map((x) => str(x, 80)).filter((x) => x && x !== '-' && x !== primary))].slice(0, 6);
  const evidence = [primary, ...reasons, str(r.appeal_result, 300), str(r.creative_aggr_tag_info, 300), str(r.creative_detail_tag_info, 300)].join(' ');
  const moderation = level === 'ad' && MODERATION.test(evidence) ? (/offline_audit|appeal[ _-]*reject|reject|disapprov/i.test(evidence) ? 'rejected' : 'review') : null;
  const working = primary === 'delivery_ok';
  const status = working ? 'working' : (moderation || enabled === true) ? 'issue' : 'off';
  const reasonRaw = moderation ? (reasons.find((x) => MODERATION.test(x)) || reasons[0] || moderation) : reasons[0] || primary;
  return {
    level, id, name: str(ids.name || id), enabled, status,
    primaryStatus: primary, reasons, moderation,
    reason: status === 'issue' ? reasonText(reasonRaw) : '',
    reasonKind: status === 'issue' ? classifyReason(reasonRaw) : '',
    campaignId: str(r.campaign_id, 40), campaignName: str(r.campaign_name, 180),
    adgroupId: level === 'ad' ? str(r.ad_id, 40) : '', adgroupName: level === 'ad' ? str(r.ad_name, 180) : '',
    budget: level === 'campaign' ? num(r.campaign_budget) : num(r.ad_budget ?? r.budget),
    spend: num(r.stat_cost), impressions: num(r.show_cnt), clicks: num(r.click_cnt), conversions: num(r.time_attr_convert_cnt)
  };
}

const ratio = (a, b, k = 1) => (b > 0 ? (a / b) * k : null);

export function withDerived(m) {
  return {
    ...m,
    ctr: ratio(m.clicks, m.impressions, 100), cpc: ratio(m.spend, m.clicks), cpm: ratio(m.spend, m.impressions, 1000),
    cpa: ratio(m.spend, m.conversions), cvr: ratio(m.conversions, m.clicks, 100)
  };
}

export function normalizeRows(level, rawRows) {
  return (Array.isArray(rawRows) ? rawRows : []).map((r) => normalizeRow(level, r)).filter(Boolean).map(withDerived);
}

export function totals(rows) {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return withDerived({ spend: sum('spend'), impressions: sum('impressions'), clicks: sum('clicks'), conversions: sum('conversions') });
}

export const STATUS_FILTERS = Object.freeze([
  { id: 'all', title: 'Все' }, { id: 'issue', title: 'Проблемы' }, { id: 'working', title: 'Работают' }, { id: 'off', title: 'Выключены' }
]);

export function filterRows(rows, { q = '', status = 'all' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((r) => (status === 'all' || r.status === status) &&
    (!needle || `${r.name} ${r.id} ${r.campaignName} ${r.adgroupName}`.toLowerCase().includes(needle)));
}

export const SORTS = Object.freeze([
  { id: 'problems', title: 'Проблемы' }, { id: 'spend', title: 'Расход ↓' }, { id: 'conversions', title: 'Конверсии ↓' },
  { id: 'cpa', title: 'CPA ↑' }, { id: 'ctr', title: 'CTR ↓' }, { id: 'impressions', title: 'Показы ↓' }, { id: 'name', title: 'Название' }
]);
const STATUS_ORDER = { issue: 0, working: 1, off: 2 };

// Сортировка не меняет исходный массив; пустые значения (null) всегда в конце.
export function sortRows(rows, sort = 'problems') {
  const copy = [...rows];
  const byNumber = (key, dir) => (a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return dir * (x - y);
  };
  const bySpend = (a, b) => b.spend - a.spend;
  switch (sort) {
    case 'spend': return copy.sort(bySpend);
    case 'conversions': return copy.sort((a, b) => b.conversions - a.conversions || bySpend(a, b));
    case 'cpa': return copy.sort(byNumber('cpa', 1));
    case 'ctr': return copy.sort(byNumber('ctr', -1));
    case 'impressions': return copy.sort((a, b) => b.impressions - a.impressions);
    case 'name': return copy.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    default: return copy.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || bySpend(a, b));
  }
}

/* ---------- Период ---------- */

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function periodRange(periodId, now = new Date()) {
  const p = PERIODS.find((x) => x.id === periodId) ?? PERIODS.find((x) => x.id === '7d');
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p.offset);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (p.days - 1));
  return { st: fmtDate(start), et: fmtDate(end) };
}

/* ---------- CSV ---------- */

// Защита от CSV-инъекций: ячейки, начинающиеся с = + - @ или табуляции, получают префикс «'».
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// Разделитель «;» — русская локаль Excel открывает такой файл по колонкам (запятая дала бы одну колонку).
export function toCsv(rows, columns, delimiter = ';') {
  const header = columns.map((c) => csvCell(c.title)).join(delimiter);
  const lines = rows.map((row) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(row) : row[c.key])).join(delimiter));
  return `\ufeff${[header, ...lines].join('\r\n')}\r\n`;
}

const round = (v, d = 2) => (v === null || v === undefined ? '' : Number(v.toFixed(d)));

export const ROW_COLUMNS = Object.freeze([
  { title: 'ID', key: 'id' }, { title: 'Название', key: 'name' }, { title: 'Статус', get: (r) => ({ working: 'работает', issue: 'проблема', off: 'выключено' }[r.status]) },
  { title: 'Причина', key: 'reason' }, { title: 'Кампания', key: 'campaignName' },
  { title: 'Расход', get: (r) => round(r.spend) }, { title: 'Показы', key: 'impressions' }, { title: 'Клики', key: 'clicks' },
  { title: 'CTR %', get: (r) => round(r.ctr) }, { title: 'CPC', get: (r) => round(r.cpc, 3) }, { title: 'CPM', get: (r) => round(r.cpm) },
  { title: 'Конверсии', key: 'conversions' }, { title: 'CPA', get: (r) => round(r.cpa) }, { title: 'CVR %', get: (r) => round(r.cvr) }
]);
