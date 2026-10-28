// Контракты мутаций Ads Manager: «снять один раз — применять массово».
// Тела внутренних запросов (вкл/выкл, имя, бюджет) в исследовании не зафиксированы и меняются вместе с TikTok,
// поэтому расширение запоминает настоящий запрос, который пользователь сам выполнил в TikTok на одном объекте,
// и повторяет его для других ID. Форма тела не предполагается: ID находятся подстановкой, значения — по результату.
// Чистый модуль без chrome.* — покрыт тестами.

export const ID_RE = /^\d{5,30}$/;
export const LEVELS = Object.freeze(['campaign', 'adgroup', 'ad']);

// Во внутренних путях «ad» — это адсет, «creative» — объявление (см. docs/research-2026-10-28/ADS-AUTOMATION-HANDOFF-1.5.0.md).
const PATH_RE = /^\/api\/v\d+\/i18n\/overture\/(campaign|ad|creative)\/(update_status|batch_update\/(?:name|budget))\/?$/;
const LEVEL_OF = { campaign: 'campaign', ad: 'adgroup', creative: 'ad' };

export function matchEndpoint(pathname) {
  const match = PATH_RE.exec(String(pathname || ''));
  if (!match) return null;
  const level = LEVEL_OF[match[1]];
  const kind = match[2] === 'update_status' ? 'status' : match[2].endsWith('name') ? 'name' : 'budget';
  return { id: `${level}.${kind}`, level, kind };
}

/* ---------- очистка перед сохранением ---------- */

const SECRET_KEY = /token|cookie|secret|passw|signature|bogus|csrf|session|verifyfp|authorization/i;
const DYNAMIC_QUERY = /^(aadvid|mstoken|msstoken|x-bogus|x-gnarly|_signature|verifyfp|fp|_rticket|ts|timestamp|device_id|odin_tt)$/i;
const KEPT_HEADERS = ['app-name', 'x-ttam-version', 'x-ttam-uuid'];

// risk_info собирается заново на странице при каждой отправке (поля перечислены в internal-api-catalog.json).
export function splitRisk(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { body, riskInfo: false };
  const { risk_info: risk, ...rest } = body;
  return { body: rest, riskInfo: risk !== undefined };
}

export function sanitizeBody(value, depth = 0) {
  if (depth > 10) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeBody(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!SECRET_KEY.test(key)) out[key] = sanitizeBody(item, depth + 1);
    return out;
  }
  return typeof value === 'string' ? value.slice(0, 500) : value;
}

export function sanitizeQuery(params) {
  const out = [];
  for (const [key, value] of params instanceof URLSearchParams ? params : params || []) {
    if (DYNAMIC_QUERY.test(key) || SECRET_KEY.test(key) || String(value).length > 200) continue;
    out.push([key, String(value)]);
    if (out.length >= 12) break;
  }
  return out;
}

export function pickHeaders(headers = {}) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (KEPT_HEADERS.includes(key) && typeof value === 'string' && value.length <= 200) out[key] = value;
  }
  return out;
}

/* ---------- обход и подстановка ---------- */

// visit(значение, путь, 'value' | 'key'): ключи объектов обходятся отдельно, ID в них встречаются как ключи карт.
export function walk(value, visit, path = []) {
  visit(value, path, 'value');
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, [...path, index]));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      visit(key, [...path, key], 'key');
      walk(item, visit, [...path, key]);
    }
  }
}

// Целые числа длиннее 15 цифр вне строк (ID как числа JSON): JSON.parse округляет их, и повтор запроса исказил бы значение.
export const hasBigNumbers = (text) => /-?\d{16,}/.test(String(text ?? '').replace(/"(?:[^"\\]|\\.)*"/g, '""'));

// Все ID-подобные строки тела (значения и ключи карт): по ним понимаем, сколько объектов затронул запрос.
export function collectIds(body) {
  const found = new Set();
  walk(body, (value) => { if (typeof value === 'string' && ID_RE.test(value)) found.add(value); });
  return found;
}

export function containsId(body, id) {
  let found = false;
  walk(body, (value) => { if (typeof value === 'string' && value === id) found = true; });
  return found;
}

// ID заменяются в строковых значениях и ключах; числа не трогаем (большие ID в JSON-числах теряют точность).
export function substitute(value, map) {
  if (typeof value === 'string') return map.has(value) ? map.get(value) : value;
  if (Array.isArray(value)) return value.map((item) => substitute(item, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[map.has(key) ? map.get(key) : key] = substitute(item, map);
    return out;
  }
  return value;
}

export function getAt(root, path) {
  let node = root;
  for (const segment of path) {
    if (node === null || node === undefined) return undefined;
    node = node[segment];
  }
  return node;
}

export function setAt(root, path, value) {
  if (!path.length) return false;
  let node = root;
  for (const segment of path.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    node = node[segment];
  }
  if (node === null || typeof node !== 'object' || !(path.at(-1) in node)) return false;
  node[path.at(-1)] = value;
  return true;
}

// roles: Map(строка → 'object' | 'advertiser'). Сегменты пути, равные ID, становятся { role } и подставляются при повторе.
export const abstractPath = (path, roles) => path.map((segment) => (typeof segment === 'string' && roles.has(segment) ? { role: roles.get(segment) } : segment));
export const resolvePath = (path, values) => path.map((segment) => (segment && typeof segment === 'object' ? values[segment.role] : segment));

/* ---------- слоты значений ---------- */

function pickHit(hits, keyHint) {
  if (hits.length === 1) return hits[0];
  const narrowed = hits.filter((hit) => keyHint.test(String(hit.path.at(-1))));
  return narrowed.length === 1 ? narrowed[0] : null;
}

// Где в теле лежит новое имя: ищем единственную строку, равную имени, которое TikTok показал после сохранения.
export function detectNameSlot(body, newName, roles) {
  const hits = [];
  walk(body, (value, path, kind) => { if (kind === 'value' && path.length && typeof value === 'string' && value === newName) hits.push({ path }); });
  const hit = pickHit(hits, /name/i);
  return hit ? { slot: { path: abstractPath(hit.path, roles), type: 'string' } } : { error: hits.length ? 'ambiguous' : 'not-found' };
}

const SCALES = [1, 100, 1000, 1000000];

// Бюджет может уходить в валюте, центах или микро-единицах: масштаб определяем по реальной паре «отправили → увидели».
export function detectBudgetSlot(body, newBudget, roles) {
  const wanted = Number(newBudget);
  if (!Number.isFinite(wanted) || wanted <= 0) return { error: 'bad-value' };
  const hits = [];
  walk(body, (value, path, kind) => {
    if (kind !== 'value' || !path.length || (typeof value !== 'number' && typeof value !== 'string')) return;
    if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value.trim())) return;
    const number = Number(value);
    for (const scale of SCALES) {
      if (Math.abs(number - wanted * scale) <= Math.max(1e-6, 1e-4 * scale)) { hits.push({ path, scale, type: typeof value }); break; }
    }
  });
  const hit = pickHit(hits, /budget/i);
  return hit ? { slot: { path: abstractPath(hit.path, roles), scale: hit.scale, type: hit.type } } : { error: hits.length ? 'ambiguous' : 'not-found' };
}

export function formatBudget(value, slot) {
  const raw = Number(value) * (slot.scale || 1);
  const out = slot.scale > 1 ? Math.round(raw) : Math.round(raw * 100) / 100;
  return slot.type === 'string' ? String(out) : out;
}

/* ---------- контракт и повтор ---------- */

export function makeVariant({ endpoint, url, body, headers, aadvid, objectId, slot = null, label = null, at = Date.now() }) {
  const parsed = new URL(url);
  const { body: bare, riskInfo } = splitRisk(body);
  return {
    endpoint: endpoint.id, level: endpoint.level, kind: endpoint.kind, label, at,
    path: parsed.pathname, query: sanitizeQuery(parsed.searchParams), headers: pickHeaders(headers),
    body: sanitizeBody(bare), riskInfo, aadvid: String(aadvid || ''), objectId: String(objectId), slot
  };
}

// value нужен для имени и бюджета; для статуса тело повторяется как снято (вкл и выкл — разные варианты).
export function buildRequest(variant, { aadvid, id, value }) {
  const map = new Map([[variant.objectId, String(id)]]);
  if (variant.aadvid && aadvid && variant.aadvid !== String(aadvid)) map.set(variant.aadvid, String(aadvid));
  const body = substitute(variant.body, map);
  if (variant.slot) {
    const path = resolvePath(variant.slot.path, { object: String(id), advertiser: String(aadvid) });
    const next = variant.kind === 'budget' ? formatBudget(value, variant.slot) : String(value);
    if (!setAt(body, path, next)) throw new Error('В сохранённом запросе нет поля для значения. Обучите действие заново.');
  }
  return { path: variant.path, query: [...variant.query, ['aadvid', String(aadvid)]], headers: variant.headers, body, riskInfo: variant.riskInfo };
}

// store: { 'campaign.status': { variants: { enable, disable } }, 'campaign.name': { variants: { set } }, … }
export function readiness(store = {}) {
  const out = {};
  for (const level of LEVELS) {
    const status = store[`${level}.status`]?.variants || {};
    out[level] = {
      enable: Boolean(status.enable), disable: Boolean(status.disable),
      name: Boolean(store[`${level}.name`]?.variants?.set), budget: Boolean(store[`${level}.budget`]?.variants?.set)
    };
  }
  return out;
}

export function variantFor(store, level, action) {
  if (action === 'enable' || action === 'disable') return store[`${level}.status`]?.variants?.[action] || null;
  if (action === 'rename') return store[`${level}.name`]?.variants?.set || null;
  if (action === 'budget') return store[`${level}.budget`]?.variants?.set || null;
  return null;
}

/* ---------- значения действий ---------- */

const pad = (n) => String(n).padStart(2, '0');

export function renderName(template, { name = '', n = 1, now = new Date() } = {}) {
  return String(template || '').replaceAll('{name}', name).replaceAll('{n}', String(n))
    .replaceAll('{date}', `${pad(now.getMonth() + 1)}${pad(now.getDate())}`).replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function budgetAfter(before, { mode = 'set', value } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  const next = mode === 'multiply' ? Number(before) * v : v;
  return Number.isFinite(next) && next > 0 && next <= 1e8 ? Math.round(next * 100) / 100 : null;
}

// Для диагностики без личных данных: ключи и форма сохраняются, ID и свободный текст маскируются, enum-значения остаются видны.
export function maskBody(value) {
  if (Array.isArray(value)) return value.slice(0, 20).map(maskBody);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[ID_RE.test(key) ? '<id>' : key] = maskBody(item);
    return out;
  }
  if (typeof value === 'string') return ID_RE.test(value) ? '<id>' : /^[A-Za-z0-9_.:-]{1,32}$/.test(value) && !/\d{5,}/.test(value) ? value : '<str>';
  if (typeof value === 'number') return Number.isInteger(value) && Math.abs(value) < 1000 ? value : '<num>';
  return value;
}
