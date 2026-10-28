// Форматирование чисел для интерфейса (русская локаль: пробел между тысячами, запятая в дробной части).
const cache = new Map();
function formatter(digits) {
  if (!cache.has(digits)) cache.set(digits, new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return cache.get(digits);
}
export const num = (v, digits = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : formatter(digits).format(v));
export const money = (v, currency = '', digits = 2) => (v === null || v === undefined ? '—' : `${num(v, digits)} ${currency}`.trim());
export const pct = (v) => (v === null || v === undefined ? '—' : `${num(v, 2)}%`);
export const clock = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} ч назад` : `${Math.round(hrs / 24)} дн назад`;
}
