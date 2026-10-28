// S2S-инструменты: сборка постбэк-ссылки для Keitaro и тестовая отправка события в TikTok Events API.
// Чистые функции без chrome.* — покрыты юнит-тестами.
import { API_ORIGIN } from '../lib/constants.js';

const VALUE_RE = /^(?:\{[A-Za-z0-9_]{1,40}\}|\d{1,9}(?:\.\d{1,4})?)$/;
const EVENT_RE = /^[A-Za-z0-9_]{1,64}$/;
const PIXEL_RE = /^[A-Za-z0-9_-]{6,64}$/;

export function cleanDomain(input) {
  const host = String(input ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').trim().toLowerCase();
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(host) ? host : '';
}

export function cleanPath(input, fallback = '/lander/tts2s') {
  const raw = String(input ?? '').trim().replace(/\\/g, '/');
  const path = '/' + raw.split('/').filter((part) => part && part !== '.' && part !== '..' && /^[A-Za-z0-9._~-]+$/.test(part)).join('/');
  return path === '/' ? fallback : path;
}

// Ссылка для S2S-постбэка кампании в Keitaro. Макросы в фигурных скобках остаются как есть.
export function buildPostbackUrl({ domain, path, event, api = '1', value = '', currency = 'USD', test = '' }) {
  const host = cleanDomain(domain);
  if (!host) throw new Error('Укажите домен из вашего Keitaro, например track.example.com');
  if (!EVENT_RE.test(event ?? '')) throw new Error('Укажите событие пикселя: латиница, цифры и «_»');
  const query = ['pix={px}', 'at={tk}', 'ttclid={ttclid}', `event=${event}`, 'user_agent={useragent}', 'ip={ip}'];
  if (value) {
    if (!VALUE_RE.test(value)) throw new Error('Value: число или макрос вида {payout}');
    query.push(`value=${value}`);
  }
  if (currency && currency.toUpperCase() !== 'USD') {
    if (!/^[A-Za-z]{3}$/.test(currency)) throw new Error('Валюта: трёхбуквенный код, например EUR');
    query.push(`currency=${currency.toUpperCase()}`);
  }
  if (String(api) === '2') query.push('api=2');
  if (test) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(test)) throw new Error('Тестовый код: латиница, цифры, «-» и «_»');
    query.push(`test=${test}`);
  }
  return `https://${host}${cleanPath(path)}/indexpix1.php?${query.join('&')}`;
}

// Events API 1.0 (/pixel/track/) — формат, который использует исходный S2S-скрипт.
export function buildLegacyPayload({ pixel, event, ttclid, ip, userAgent, value, currency = 'USD', eventId, now = new Date() }) {
  const context = {};
  if (ip) context.ip = ip;
  if (userAgent) context.user_agent = userAgent;
  if (ttclid) context.ad = { callback: ttclid };
  const payload = { pixel_code: pixel, event, timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), context };
  if (eventId) payload.event_id = eventId;
  if (value !== undefined && value !== '' && Number.isFinite(Number(value))) payload.properties = { currency, value: Number(value) };
  return payload;
}

// Events API 2.0 (/event/track/) — рекомендуемый TikTok единый эндпоинт.
export function buildEventsV2Payload({ pixel, event, ttclid, ip, userAgent, value, currency = 'USD', eventId, testCode, now = Date.now() }) {
  const user = {};
  if (ttclid) user.ttclid = ttclid;
  if (ip) user.ip = ip;
  if (userAgent) user.user_agent = userAgent;
  const item = { event, event_time: Math.floor(now / 1000), user };
  if (eventId) item.event_id = eventId;
  if (value !== undefined && value !== '' && Number.isFinite(Number(value))) item.properties = { currency, value: Number(value) };
  const payload = { event_source: 'web', event_source_id: pixel, data: [item] };
  if (testCode) payload.test_event_code = testCode;
  return payload;
}

export function validateTestInput({ pixel, token, event }) {
  if (!PIXEL_RE.test(pixel ?? '')) throw new Error('Некорректный Pixel Code.');
  if (!/^\S{16,512}$/.test(token ?? '')) throw new Error('Некорректный Access Token (Developer token).');
  if (!EVENT_RE.test(event ?? '')) throw new Error('Некорректное событие.');
}

export async function sendTestEvent(input, fetchImpl = globalThis.fetch) {
  validateTestInput(input);
  const api = String(input.api) === '2' ? '2' : '1';
  const common = {
    pixel: input.pixel, event: input.event, ttclid: input.ttclid || undefined, ip: input.ip || undefined,
    userAgent: input.userAgent || 'Mozilla/5.0 (TTAds Hub test)', value: input.value, currency: input.currency || 'USD',
    eventId: input.eventId || undefined
  };
  const endpoint = `${API_ORIGIN}/open_api/v1.3/${api === '2' ? 'event' : 'pixel'}/track/`;
  const payload = api === '2' ? buildEventsV2Payload({ ...common, testCode: input.testCode || undefined }) : buildLegacyPayload(common);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response, text;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Access-Token': input.token },
      body: JSON.stringify(payload)
    });
    text = await response.text();
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? 'TikTok не ответил за 20 секунд.' : 'Не удалось связаться с TikTok: ' + (e?.message || e));
  } finally { clearTimeout(timer); }
  let body = null;
  try { body = JSON.parse(text); } catch { /* не JSON */ }
  const code = typeof body?.code === 'number' ? body.code : null;
  return {
    ok: response.ok && code === 0, http: response.status, code,
    message: String(body?.message ?? body?.msg ?? (body ? '' : text.slice(0, 200))).slice(0, 300),
    requestId: body?.request_id ?? null, endpoint, api, sent: payload
  };
}
