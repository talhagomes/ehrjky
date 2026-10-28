// Единая классификация ошибок TikTok: HTTP-статусы, коды (внутренние и Marketing API), сбои fetch и DOM.
// Чистый модуль без chrome.* — покрыт тестами. Коды Marketing API — по docs/research-official-api-2026-10-28/core.md.

export const ERROR_KINDS = Object.freeze({
  auth: { label: 'Нужен вход в TikTok', retryable: false, hint: 'Сессия TikTok истекла или нет входа: откройте ads.tiktok.com, войдите и повторите.' },
  permission: { label: 'Нет прав', retryable: false, hint: 'У вашей учётной записи нет прав на это действие в кабинете (нужна роль Admin или Operator).' },
  rate: { label: 'Лимит запросов', retryable: true, hint: 'TikTok ограничивает частоту запросов: подождите минуту и повторите.' },
  validation: { label: 'Запрос отклонён', retryable: false, hint: 'TikTok не принял параметры запроса: изменились правила или формат запроса.' },
  schema: { label: 'Контракт изменился', retryable: false, hint: 'Адрес внутреннего запроса TikTok изменился: обучите действие заново.' },
  verification: { label: 'Нужна проверка', retryable: false, hint: 'TikTok просит подтверждение (код, CAPTCHA): завершите его во вкладке.' },
  server: { label: 'Сбой TikTok', retryable: true, hint: 'Сервер TikTok ответил ошибкой: повторите позже.' },
  network: { label: 'Нет ответа', retryable: true, hint: 'TikTok не ответил вовремя или пропала сеть или вкладка.' },
  dom: { label: 'Изменился интерфейс', retryable: false, hint: 'Элемент страницы TikTok не найден: интерфейс мог измениться.' },
  unknown: { label: 'Ошибка', retryable: false, hint: '' }
});

const AUTH_CODES = new Set([40101, 40102, 40104, 40105, 40106, 40107, 40110, 40115]);
const PERMISSION_CODES = new Set([40001, 40118, 40119, 40125]);
const RATE_CODES = new Set([40016, 40100, 40133]);
const PARAM_CODES = new Set([40000, 40002, 40011]);
const SERVER_CODES = new Set([50000, 50002, 60001]);

// input: { http, code, msg | error | message, lost, timeout, step }. Порядок проверок важен: сначала то, что нельзя повторять вслепую.
export function classifyError(input = {}) {
  const http = Number(input.http) || 0;
  const code = Number(input.code);
  const text = String(input.msg || input.error || input.message || '').toLowerCase();
  const has = (re) => re.test(text);
  let kind = 'unknown';
  if (input.lost || input.timeout || has(/timed? ?out|aborted|failed to fetch|network ?error|load failed|не ответил|нет ответа|недоступна|вкладка.*закрыта/)) kind = 'network';
  else if (http === 401 || AUTH_CODES.has(code) || has(/not logged|log ?in required|please log ?in|sign ?in|session (?:has )?expired|unauthori[sz]ed|invalid (?:session|token|csrf)|access[ _-]?token|csrf/)) kind = 'auth';
  else if (http === 403 || PERMISSION_CODES.has(code) || has(/permission|forbidden|no access|not allowed|no authority/)) kind = 'permission';
  else if (http === 429 || RATE_CODES.has(code) || has(/too many|rate ?limit|too frequent|frequen|qps|throttl/)) kind = 'rate';
  else if (has(/captcha|verif|security check|identity/)) kind = 'verification';
  else if ([404, 405, 410].includes(http)) kind = 'schema';
  else if (http === 400 || http === 422 || PARAM_CODES.has(code) || has(/invalid|illegal|param|malformed|wrong/)) kind = 'validation';
  else if (http >= 500 || SERVER_CODES.has(code) || (code >= 51000 && code < 52000) || has(/internal|server error|service unavailable|try again later/)) kind = 'server';
  else if (input.step || has(/не найден|selector|не показал|не открылась|element/)) kind = 'dom';
  return { kind, ...ERROR_KINDS[kind], invalidatesContract: kind === 'schema' };
}

export function describeError(input = {}) {
  const { label, hint } = classifyError(input);
  const detail = String(input.msg || input.error || input.message || '').trim().slice(0, 160);
  return `${label}${detail ? `: ${detail}` : ''}${hint ? `. ${hint}` : ''}`;
}

// Успех ответа внутреннего API Ads Manager: HTTP 200 и code 0.
export const isSuccess = (result) => Boolean(result) && !result.error && !result.lost && result.http === 200 && result.code === 0;
