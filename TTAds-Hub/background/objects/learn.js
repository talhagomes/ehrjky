// Обучение контрактов. Пользователь сам выполняет действие в TikTok на одном объекте; расширение только читает
// запрос (webRequest без блокировки) и принимает его, если повторное чтение списка подтвердило изменение.
import { ORIGIN } from '../lib/constants.js';
import { HubError, wait } from '../lib/page.js';
import { log } from '../lib/storage.js';
import { ID_RE, LEVELS, matchEndpoint, collectIds, containsId, makeVariant, pickHeaders, detectNameSlot, detectBudgetSlot, hasBigNumbers } from './contract.js';
import { getSession, setSession, patchSession, saveVariant, readRows, stateOf } from './store.js';

const SESSION_TTL = 10 * 60 * 1000;
const KINDS = ['status', 'name', 'budget'];
const pending = new Map();

// Байты частей склеиваются до декодирования: многобайтовый символ мог разорваться между частями.
function decodeBody(requestBody) {
  try {
    if (requestBody?.raw?.length) {
      const parts = requestBody.raw.map((part) => new Uint8Array(part.bytes));
      const merged = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0));
      let offset = 0;
      for (const bytes of parts) { merged.set(bytes, offset); offset += bytes.length; }
      const text = new TextDecoder().decode(merged);
      return { body: JSON.parse(text), bigNumbers: hasBigNumbers(text) };
    }
  } catch { /* не JSON — не наш запрос */ }
  return null;
}

function onBefore(details) {
  if (details.method !== 'POST' || details.tabId < 0) return;
  let url;
  try { url = new URL(details.url); } catch { return; }
  const endpoint = matchEndpoint(url.pathname);
  const decoded = endpoint ? decodeBody(details.requestBody) : null;
  if (!decoded?.body || typeof decoded.body !== 'object') return;
  pending.set(details.requestId, { endpoint, url: url.href, tabId: details.tabId, body: decoded.body, bigNumbers: decoded.bigNumbers, headers: {}, at: Date.now() });
  if (pending.size > 40) for (const [id, entry] of pending) if (Date.now() - entry.at > 60000) pending.delete(id);
}

function onHeaders(details) {
  const entry = pending.get(details.requestId);
  if (entry) entry.headers = pickHeaders(Object.fromEntries((details.requestHeaders || []).map((header) => [header.name, header.value || ''])));
}

function onCompleted(details) {
  const entry = pending.get(details.requestId);
  pending.delete(details.requestId);
  if (!entry || details.statusCode !== 200) return;
  handleCapture(entry).catch((error) => log('warn', 'objects', `Обучение: ${String(error?.message || error).slice(0, 200)}`));
}

export function registerRecorder() {
  if (!chrome.webRequest?.onBeforeRequest) return;
  const filter = { urls: [`${ORIGIN}/api/*`] };
  chrome.webRequest.onBeforeRequest.addListener(onBefore, filter, ['requestBody']);
  chrome.webRequest.onBeforeSendHeaders.addListener(onHeaders, filter, ['requestHeaders', 'extraHeaders']);
  chrome.webRequest.onErrorOccurred.addListener((details) => pending.delete(details.requestId), filter);
  chrome.webRequest.onCompleted.addListener(onCompleted, filter);
}

const fail = (message, extra = {}) => patchSession({ message, ...extra });

async function handleCapture(entry) {
  const session = await getSession();
  if (!session || session.state !== 'waiting') return;
  if (Date.now() > session.expiresAt) { await patchSession({ state: 'expired', message: 'Время обучения вышло — начните заново.' }); return; }
  const url = new URL(entry.url);
  const expected = `${session.level}.${session.kind}`;
  if (entry.endpoint.id !== expected) {
    await fail(`TikTok отправил другой запрос (${url.pathname}), а ожидался «${expected}». Выполните действие в указанном месте или пришлите диагностику.`, { other: [...(session.other || []), url.pathname].slice(-5) });
    return;
  }
  if (entry.bigNumbers) return void await fail('В запросе ID записаны числами без кавычек: JavaScript теряет в них точность, и повторить такой запрос безопасно нельзя. Пришлите диагностику.');
  const aadvid = url.searchParams.get('aadvid') || session.account;
  if (aadvid !== session.account) return void await fail('Действие выполнено в другом кабинете — повторите в выбранном.');
  if (!containsId(entry.body, session.objectId)) return void await fail(`В запросе нет объекта «${session.objectName}». Измените именно его.`);
  const ids = collectIds(entry.body);
  ids.delete(aadvid);
  if (ids.size !== 1) return void await fail('В запросе несколько объектов. Выберите в TikTok ровно один — тестовый.');

  await patchSession({ state: 'checking', message: 'Запрос получен — проверяю результат повторным чтением…' });
  await wait(1500);
  let row;
  try {
    const read = await readRows(session.account, session.level, entry.tabId);
    row = read.rows.find((item) => item.id === session.objectId);
  } catch (error) {
    return void await patchSession({ state: 'waiting', message: `Не удалось перечитать объект: ${String(error?.message || error).slice(0, 160)}` });
  }
  if (!row) return void await patchSession({ state: 'waiting', message: 'Объект не найден после действия (удалён или скрыт фильтром).' });

  const now = stateOf(row);
  const roles = new Map([[session.objectId, 'object'], [aadvid, 'advertiser']]);
  let key = 'set', label = null, slot = null;
  if (session.kind === 'status') {
    if (typeof now.enabled !== 'boolean' || typeof session.before.enabled !== 'boolean') return void await patchSession({ state: 'waiting', message: 'TikTok не вернул состояние объекта.' });
    if (now.enabled === session.before.enabled) return void await patchSession({ state: 'waiting', message: 'Состояние объекта не изменилось — TikTok мог отклонить запрос. Повторите.' });
    label = now.enabled ? 'enable' : 'disable';
    key = label;
  } else if (session.kind === 'name') {
    if (now.name === session.before.name) return void await patchSession({ state: 'waiting', message: 'Имя не изменилось. Сохраните новое имя в TikTok.' });
    const found = detectNameSlot(entry.body, now.name, roles);
    if (!found.slot) return void await patchSession({ state: 'waiting', message: found.error === 'ambiguous' ? 'Имя встречается в запросе несколько раз — введите уникальное имя.' : 'Имя не найдено в теле запроса — введите имя без спецсимволов.' });
    slot = found.slot;
  } else {
    if (!(now.budget > 0) || now.budget === session.before.budget) return void await patchSession({ state: 'waiting', message: 'Бюджет не изменился. Сохраните другое значение (например, +1).' });
    const found = detectBudgetSlot(entry.body, now.budget, roles);
    if (!found.slot) return void await patchSession({ state: 'waiting', message: found.error === 'ambiguous' ? 'Значение бюджета неоднозначно — введите «круглое» число, которого нет в запросе иначе.' : 'Не нашёл бюджет в запросе — введите другое значение.' });
    slot = found.slot;
  }

  const variant = makeVariant({ endpoint: entry.endpoint, url: entry.url, body: entry.body, headers: entry.headers, aadvid, objectId: session.objectId, slot, label });
  const store = await saveVariant(variant, key);
  const done = session.kind !== 'status' || Boolean(store[expected]?.variants?.enable && store[expected]?.variants?.disable);
  const learned = session.kind === 'status' ? `«${label === 'enable' ? 'включить' : 'выключить'}»` : session.kind === 'name' ? 'имя' : 'бюджет';
  await patchSession({
    state: done ? 'done' : 'waiting', before: now, learned: [...new Set([...(session.learned || []), key])],
    next: session.kind === 'status' ? (label === 'enable' ? 'disable' : 'enable') : null,
    message: done ? `Готово: запомнил ${learned}.` : `Запомнил ${learned}. Теперь верните переключатель обратно — так запомню второе действие.`
  });
  log('info', 'objects', `Обучение: ${expected}${label ? ` (${label})` : ''} подтверждено повторным чтением`);
}

export async function startLearn({ account, level, kind, objectId, tabId }) {
  if (!ID_RE.test(String(account))) throw new HubError('Выберите кабинет.');
  if (!LEVELS.includes(level) || !KINDS.includes(kind)) throw new HubError('Неизвестное действие обучения.');
  if (kind === 'budget' && level === 'ad') throw new HubError('У объявлений нет собственного бюджета.');
  if (!ID_RE.test(String(objectId))) throw new HubError('Выберите тестовый объект.');
  const { rows } = await readRows(String(account), level, tabId);
  const row = rows.find((item) => item.id === String(objectId));
  if (!row) throw new HubError('Объект не найден в кабинете. Обновите список.');
  if (kind === 'status' && typeof row.enabled !== 'boolean') throw new HubError('TikTok не показал состояние этого объекта — выберите другой.');
  if (kind === 'budget' && !(row.budget > 0)) throw new HubError('У этого объекта нет собственного бюджета — выберите кампанию или адсет с бюджетом.');
  const session = {
    id: crypto.randomUUID(), state: 'waiting', account: String(account), level, kind, objectId: row.id, objectName: row.name,
    before: stateOf(row), startedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL, learned: [],
    next: kind === 'status' ? (row.enabled ? 'disable' : 'enable') : 'set', message: ''
  };
  await setSession(session);
  return session;
}

export const stopLearn = () => setSession(null);
