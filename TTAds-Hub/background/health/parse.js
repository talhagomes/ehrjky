// Разбор текстов платёжных страниц TikTok и таблиц Business Center: статус РК, карта, билл (порог), долг, баланс.
// Чистый модуль: на входе строки, снятые page-скриптом, на выходе — нормализованные данные. Без chrome.* — покрыт тестами.

const CUR = '[A-Z]{3}';
// Пробел внутри числа допускается только как разделитель тысяч («1 234,56»), иначе «2026 5.00» склеилось бы в одно число.
const NUM = '-?(?:\\d{1,3}(?:[\\u00a0\\u202f ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)*)';
const MONEY_AFTER = new RegExp(`(${NUM})\\s*(${CUR})\\b`);
const MONEY_BEFORE = new RegExp(`\\b(${CUR})\\s*(${NUM})`);
const DATE = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|[A-Z][a-z]{2,8}\\.? \\d{1,2},? \\d{4})';
// Трёхбуквенные слова, которые не являются валютой (часто стоят рядом с суммами в интерфейсе TikTok).
const NOT_CURRENCY = new Set(['UTC', 'GMT', 'CPC', 'CPM', 'CTR', 'CPA', 'CVR', 'ROI', 'VAT', 'GST', 'PST', 'EST', 'CET', 'API', 'BCI']);

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// «1,234.56», «1 234,56», «1.234,56», «0.00», «5» → число. Одна запятая/точка с тремя цифрами после — разделитель тысяч.
export function parseMoney(raw) {
  let s = String(raw ?? '').replace(/[\s\u00a0\u202f]/g, '');
  if (!s) return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const seps = s.match(/[.,]/g) || [];
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let decimal = -1;
  if (seps.length) {
    const after = s.length - last - 1;
    const mixed = s.includes('.') && s.includes(',');
    if (mixed) decimal = last;
    else if (seps.length === 1) decimal = after === 3 && !/^0[.,]/.test(s) ? -1 : last;
    else decimal = -1;
  }
  const int = (decimal >= 0 ? s.slice(0, decimal) : s).replace(/[.,]/g, '');
  const frac = decimal >= 0 ? s.slice(decimal + 1).replace(/[.,]/g, '') : '';
  const value = Number(`${int || '0'}${frac ? `.${frac}` : ''}`);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const moneyOf = (amount, currency) => {
  const value = parseMoney(amount);
  return value === null ? null : { amount: clean(amount), currency, value };
};

// Первая сумма с валютой в строке: «5.00 EUR» или «EUR 5.00».
export function firstMoney(text) {
  const s = clean(text);
  const after = s.match(MONEY_AFTER);
  if (after && !NOT_CURRENCY.has(after[2])) return moneyOf(after[1], after[2]);
  const before = s.match(MONEY_BEFORE);
  if (before && !NOT_CURRENCY.has(before[1])) return moneyOf(before[2], before[1]);
  return null;
}

// Сумма сразу после подписи (в пределах window символов без перехода к следующей подписи).
export function moneyAfterLabel(text, label, window = 90) {
  const s = clean(text);
  const re = new RegExp(label.source, label.flags.includes('g') ? label.flags : `${label.flags}g`);
  for (const match of s.matchAll(re)) {
    const tail = s.slice(match.index + match[0].length, match.index + match[0].length + window);
    const found = firstMoney(tail);
    if (found) return found;
  }
  return null;
}

/* ---------- статус рекламного кабинета ---------- */

// Порядок важен: «Not approved» содержит «approved», «Disabled» — «enabled».
const STATUS_RULES = [
  ['suspended', 'Заблокирован', /suspend|\bdisabled?\b|\bban(?:ned)?\b|deactivat|restrict|frozen|closed|punish|STATUS_LIMIT|STATUS_DISABLE|заблок|приостанов|отключ/i],
  ['rejected', 'Отклонён', /not approved|reject|review failed|denied|CONFIRM_FAIL|отклон|не одобрен/i],
  ['review', 'На проверке', /in review|under review|pending|reviewing|awaiting|STATUS_PENDING|WAIT_FOR|UNAUDITED|CONTRACT_PENDING|на проверке|на рассмотрении|ожида/i],
  ['active', 'Активен', /approved|\bactive\b|\benabled?\b|STATUS_ENABLE|одобрен|активен/i]
];

export const STATUS_KINDS = Object.freeze({
  active: ['Активен', 'ok'], review: ['На проверке', 'warn'], rejected: ['Отклонён', 'err'], suspended: ['Заблокирован', 'err'], unknown: ['Статус неизвестен', '']
});

export function classifyAccountStatus(raw) {
  const text = clean(raw);
  if (!text) return { kind: 'unknown', label: STATUS_KINDS.unknown[0], text: '' };
  for (const [kind, label, re] of STATUS_RULES) if (re.test(text)) return { kind, label, text: text.slice(0, 80) };
  return { kind: 'unknown', label: STATUS_KINDS.unknown[0], text: text.slice(0, 80) };
}

/* ---------- платёжная страница Ads Manager ---------- */

const LABELS = {
  amountDue: /Amount due|Outstanding (?:balance|amount)|Unpaid (?:amount|balance)|Overdue amount|Amount owed|Сумма к оплате|Задолженность|К оплате/i,
  cashBalance: /Available cash balance|Cash balance|Available balance|Доступный (?:денежный )?баланс|Баланс денежных средств/i,
  adCredit: /Ad credits?|Promotional credits?|Coupon balance|Рекламн(?:ый|ые) кредит|Купон/i,
  totalBalance: /Total balance|Account balance|Общий баланс|Баланс (?:аккаунта|кабинета)/i,
  threshold: /(?:Payment|Billing|Charge) threshold|Threshold|Порог(?: оплаты| списания)?/i
};

const BRANDS = /(Visa|Master ?Card|Maestro|American Express|Amex|Discover|JCB|UnionPay|Diners|Mir|МИР|PayPal)/i;

export function parseCards(text) {
  const s = clean(text);
  const cards = [];
  const seen = new Set();
  const add = (last4, index, length, currency = '') => {
    if (seen.has(last4)) return;
    seen.add(last4);
    const head = s.slice(Math.max(0, index - 70), index);
    const tail = s.slice(index + length, index + length + 180);
    const brand = (head.match(new RegExp(`${BRANDS.source}(?![\\s\\S]*${BRANDS.source})`, 'i'))?.[1] || tail.slice(0, 40).match(BRANDS)?.[1] || '').replace(/master ?card/i, 'Mastercard');
    const expiry = tail.match(/(?:Expiry date|Expiration date|Expires|Exp\.?|Срок действия|Действует до)\s*:?\s*(\d{1,2}\s*\/\s*\d{2,4})/i)?.[1]?.replace(/\s+/g, '') || '';
    cards.push({ last4, brand, currency, expiry, primary: /\b(?:Primary|Default|Основн)/i.test(tail.slice(0, 80)) });
  };
  for (const m of s.matchAll(/(?:[*•·●]{2,}\s*){1,4}(\d{4})\b(?:\s+([A-Z]{3})\b)?/g)) add(m[1], m.index, m[0].length, m[2] && !NOT_CURRENCY.has(m[2]) ? m[2] : '');
  for (const m of s.matchAll(/(?:ending in|ends with|ending|заканчивается на|оканчивается на)\s*(\d{4})\b/gi)) add(m[1], m.index, m[0].length);
  return cards.slice(0, 10);
}

function billingOptionOf(text) {
  const s = clean(text);
  const near = s.match(/(?:Billing option|Payment method type|auction(?: ads)?|Способ оплаты|Вариант оплаты)\s*:?\s*(Automatic payment|Manual payment|Monthly invoicing|Prepay(?:ment)?|Автоматическ\S* оплат\S*|Ручн\S* оплат\S*|Ежемесячн\S* сч[её]т\S*)/i)?.[1] || '';
  const source = near || s;
  if (/Automatic payment|Автоматическ\S* оплат/i.test(source)) return { mode: 'auto', text: 'Автоплатёж (билл)' };
  if (/Monthly invoic|Ежемесячн\S* сч[её]т|credit line/i.test(source)) return { mode: 'invoice', text: 'Инвойс (кредитная линия)' };
  if (/Manual payment|Prepay|Ручн\S* оплат|Предоплат/i.test(source)) return { mode: 'manual', text: 'Ручная оплата (предоплата)' };
  return { mode: '', text: '' };
}

function thresholdOf(text) {
  const s = clean(text);
  for (const match of s.matchAll(new RegExp(LABELS.threshold.source, 'gi'))) {
    const tail = s.slice(match.index + match[0].length, match.index + match[0].length + 100);
    const pair = tail.match(new RegExp(`(${NUM})\\s*\\/\\s*(${NUM})\\s*(${CUR})\\b`));
    if (pair) return { used: moneyOf(pair[1], pair[3]), limit: moneyOf(pair[2], pair[3]) };
    const single = firstMoney(tail);
    if (single) return { used: null, limit: single };
  }
  return null;
}

function bannerOf(text) {
  const s = clean(text);
  const pick = (re) => s.match(re)?.[0]?.slice(0, 160) || '';
  const suspended = pick(/(?:your )?(?:ad )?account (?:has been |was |is |is temporarily |has been permanently )?(?:suspended|disabled|banned|deactivated|restricted|closed|frozen)[^.]{0,80}|(?:Аккаунт|Кабинет|Рекламный кабинет) (?:был )?(?:заблокирован|приостановлен|отключ[её]н)[^.]{0,60}/i);
  if (suspended) return { kind: 'suspended', text: suspended };
  const rejected = pick(/(?:ad )?account (?:review )?(?:failed|was rejected|has been rejected|not approved)[^.]{0,80}/i);
  if (rejected) return { kind: 'rejected', text: rejected };
  const review = pick(/(?:ad )?account (?:is )?(?:under|in|pending) review[^.]{0,80}|Аккаунт (?:находится )?на проверке[^.]{0,60}/i);
  if (review) return { kind: 'review', text: review };
  return null;
}

// rows — тексты строк таблиц (транзакции/счета). Возвраты не считаются оплатой.
export function parseTransactions(rows = []) {
  const totals = new Map();
  let paidCount = 0, failedCount = 0, pendingCount = 0, last = null;
  for (const raw of Array.isArray(rows) ? rows.slice(0, 80) : []) {
    const row = clean(raw);
    if (!row || row.length > 400) continue;
    const money = firstMoney(row);
    if (!money) continue;
    if (/refund|возврат/i.test(row)) continue;
    const status = /\b(?:failed|declined|unsuccessful|error)\b|не удалось|отклон|ошибк/i.test(row) ? 'failed'
      : /\b(?:success(?:ful)?|succeeded|paid|completed)\b|успешн|оплачен/i.test(row) ? 'paid'
        : /\b(?:processing|pending|in progress)\b|в обработке/i.test(row) ? 'pending' : '';
    if (!status) continue;
    const date = row.match(new RegExp(DATE))?.[1] || '';
    if (status === 'paid') {
      paidCount += 1;
      totals.set(money.currency, (totals.get(money.currency) || 0) + Math.abs(money.value));
    } else if (status === 'failed') failedCount += 1;
    else pendingCount += 1;
    if (!last) last = { date, amount: money.amount, currency: money.currency, status };
  }
  if (!paidCount && !failedCount && !pendingCount) return null;
  const [currency, value] = [...totals].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  return { paid: { value: Math.round(value * 100) / 100, currency }, paidCount, failedCount, pendingCount, last };
}

// page — ответ readAdsBillingPageInPage: { text, cardText, rows, ready, iframe }.
export function parseBillingPage(page = {}) {
  const text = clean(page.text);
  const cardText = clean(page.cardText);
  const scope = cardText || text;
  const portfolio = text.match(/Payment Portfolio\s*(Advanced|Standard)?/i);
  const portfolioId = text.match(/Payment Portfolio[^]{0,90}?\bID\s*:?\s*(\d{5,30})\b/i)?.[1] || '';
  const cards = parseCards(cardText ? `${cardText} ${text}` : text);
  const financeAccessRequired = /Finance access required|need (?:finance|financial) (?:access|permission)|Требуется доступ к финансам/i.test(text);
  const managedByBc = /managed (?:in|by|through) (?:the )?(?:Business Center|Payment Portfolio)|payment methods are managed|use this Payment Portfolio's funds/i.test(text);
  const noMethodText = /No payment methods?|You haven't added a payment method|Add a payment method|Нет способов оплаты|Добавить способ оплаты/i.test(scope);
  const option = billingOptionOf(text);
  return {
    ready: page.ready !== false && text.length > 0,
    portfolio: portfolio ? `Payment Portfolio${portfolio[1] ? ` ${portfolio[1]}` : ''}` : '',
    portfolioType: portfolio?.[1] ? portfolio[1].toLowerCase() : '',
    portfolioId,
    billingMode: option.mode,
    billingText: option.text,
    paymentMethods: cards,
    cardLinked: cards.length ? true : financeAccessRequired || !text ? null : noMethodText ? false : null,
    canAdd: /Add a payment method|Добавить способ оплаты/i.test(scope),
    autopayPaused: /Automatic payment (?:is |has been )?paused|Auto-?pay(?:ment)? (?:is )?paused|Автоплат[её]ж приостановлен/i.test(text),
    paymentFailed: /payment (?:failed|declined|unsuccessful|was unsuccessful)|card (?:was )?declined|unable to (?:charge|process)|charge failed|Плат[её]ж не прош[её]л|Оплата не прошла|Карта отклонена/i.test(text),
    amountDue: moneyAfterLabel(text, LABELS.amountDue),
    cashBalance: moneyAfterLabel(text, LABELS.cashBalance),
    adCredit: moneyAfterLabel(text, LABELS.adCredit),
    totalBalance: moneyAfterLabel(text, LABELS.totalBalance),
    threshold: thresholdOf(text),
    billingDate: text.match(new RegExp(`(?:Next billing date|Billing date|Next payment date|Дата (?:списания|оплаты|выставления сч[её]та))\\s*:?\\s*${DATE}`, 'i'))?.[1] || '',
    transactions: parseTransactions(page.rows),
    banner: bannerOf(text),
    financeAccessRequired,
    managedByBc,
    verifyPhone: /Verify your phone number|Подтвердите (?:свой )?номер телефона/i.test(text),
    addDialogOpen: Boolean(page.iframe),
    iframeOrigin: String(page.iframeOrigin || '')
  };
}

/* ---------- таблицы Business Center (Payment management / Advertiser accounts) ---------- */

const HEADER_RULES = {
  account: /^(?:ad )?account(?: name)?$|advertiser account|рекламный кабинет|^аккаунт$/i,
  status: /account status|^status$|статус/i,
  threshold: /threshold|порог/i,
  balance: /balance|баланс/i,
  spend: /spend|cost|расход|затрат/i,
  budget: /budget|бюджет/i
};

function columnIndex(headers) {
  const index = {};
  headers.forEach((header, i) => {
    const text = clean(header);
    for (const [key, re] of Object.entries(HEADER_RULES)) if (index[key] === undefined && re.test(text)) { index[key] = i; break; }
  });
  return index;
}

// table — ответ readBcTableInPage: { headers: [..], rows: [{ text, cells: [..] }] }.
export function parseBcRows(table = {}) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const col = columnIndex(headers);
  const out = new Map();
  for (const row of Array.isArray(table.rows) ? table.rows : []) {
    const text = clean(row?.text);
    const id = text.match(/\bID\s*:?\s*(\d{5,30})\b/i)?.[1];
    if (!id || out.has(id)) continue;
    const cells = Array.isArray(row.cells) ? row.cells.map(clean) : [];
    const cell = (key) => (col[key] !== undefined ? cells[col[key]] || '' : '');
    const accountCell = cell('account') || text;
    const name = clean(accountCell.split(/\bID\s*:?/i)[0]).slice(0, 160);
    const statusSource = cell('status') || text.match(/\b(Approved|In review|Under review|Not approved|Rejected|Suspended|Disabled|Deactivated|Closed|Pending(?: review)?|Restricted|Frozen)\b/i)?.[0] || '';
    const thresholdSource = cell('threshold') || text;
    const pair = thresholdSource.match(new RegExp(`(${NUM})\\s*\\/\\s*(${NUM})\\s*(${CUR})\\b`));
    out.set(id, {
      id,
      name,
      status: classifyAccountStatus(statusSource),
      threshold: pair ? { used: moneyOf(pair[1], pair[3]), limit: moneyOf(pair[2], pair[3]) } : null,
      billingDate: text.match(new RegExp(`Billing date\\s*:?\\s*${DATE}`, 'i'))?.[1] || '',
      balance: col.balance !== undefined ? firstMoney(cell('balance')) : null,
      spend: col.spend !== undefined ? firstMoney(cell('spend')) : null
    });
  }
  return [...out.values()];
}
