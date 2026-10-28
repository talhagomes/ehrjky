// Причины недоставки: перевод кодов TikTok на русский и грубая классификация. Без chrome.* — покрыто тестами.

const EXACT = {
  account_balance_not_enough: 'Недостаточно средств',
  balance_not_enough: 'Недостаточно средств',
  insufficient_balance: 'Недостаточно средств',
  campaign_out_of_budget: 'Закончился бюджет',
  adgroup_out_of_budget: 'Закончился бюджет',
  campaign_disable: 'Кампания выключена',
  adgroup_disable: 'Адсет выключен',
  ad_disable: 'Объявление выключено',
  audit: 'На модерации',
  under_review: 'На модерации',
  rejected: 'Отклонено',
  time_done: 'Расписание завершено',
  time_not_start: 'Расписание ещё не началось',
  not_delivery: 'Нет доставки',
  delivery_limited: 'Доставка ограничена'
};

// balance | budget | rejected | review | schedule | off | other
export function classifyReason(raw) {
  const r = String(raw ?? '').toLowerCase();
  if (!r) return 'other';
  if (/balance|insufficient|no_fund|nofund|payment/.test(r)) return 'balance';
  if (/out_of_budget|budget/.test(r)) return 'budget';
  if (/reject|disapprov|offline_audit|violation/.test(r)) return 'rejected';
  if (/audit|review|pending/.test(r)) return 'review';
  if (/time_done|time_not_start|schedule/.test(r)) return 'schedule';
  if (/disable|paused|off$/.test(r)) return 'off';
  return 'other';
}

const KIND_LABEL = { balance: 'Недостаточно средств', budget: 'Закончился бюджет', rejected: 'Отклонено', review: 'На модерации', schedule: 'Проблема с расписанием', off: 'Выключено' };

export function reasonText(raw) {
  const key = String(raw ?? '').toLowerCase();
  if (!key) return 'Причина не указана';
  if (EXACT[key]) return EXACT[key];
  const kind = classifyReason(key);
  if (KIND_LABEL[kind]) return KIND_LABEL[kind];
  return key.replaceAll('_', ' ');
}

export const BALANCE_KINDS = new Set(['balance']);
