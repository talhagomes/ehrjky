import {
  DEFAULT_AUTOMATION_FIELDS, DEFAULT_LABELS, DEFAULT_APPEAL_TEXT, PERIODS, MONITOR_INTERVALS, HEALTH_INTERVALS, META_COLORS, DEFAULT_NAME_TEMPLATES
} from './constants.js';
import { normalizeLinksSettings, DEFAULT_LINKS_SETTINGS } from '../links/catalog.js';

const SETTINGS_KEY = 'settings';
const JOURNAL_KEY = 'journal';
const JOURNAL_LIMIT = 300;

export const DEFAULT_SETTINGS = Object.freeze({
  manual: { autoClick: false, labels: [...DEFAULT_LABELS], fields: [...DEFAULT_AUTOMATION_FIELDS] },
  appeals: {
    concurrency: 3,
    reason: 1,
    templateId: 'default',
    templates: [{ id: 'default', name: 'Стандартный', text: DEFAULT_APPEAL_TEXT }]
  },
  s2s: { domain: '', path: '/lander/tts2s', event: 'Purchase', api: '1', value: '', currency: 'USD' },
  links: DEFAULT_LINKS_SETTINGS,
  monitor: { enabled: false, intervalMin: 15, notify: false },
  overview: { period: '7d', sort: 'problems', filter: 'all' },
  accounts: { meta: {} },
  // Конвейер «создать → Portfolio → расшарить» и сохранённые BC партнёров.
  automation: {
    mode: 'new-bc', count: 1, businessCenterId: '',
    bcTemplate: DEFAULT_NAME_TEMPLATES.bc, adTemplate: DEFAULT_NAME_TEMPLATES.ad,
    linkPortfolio: false, closeTabs: true,
    share: { enabled: false, targets: [], permission: 'Admin', autoAccept: true },
    transfer: { enabled: false, targetBusinessCenterId: '' },
    partners: [],
    presets: []
  },
  health: { concurrency: 2, includeBc: true, auto: { enabled: false, intervalMin: 60, notify: false } },
  ui: { theme: 'dark' }
});

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const strList = (v, fallback, max = 200) => {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n/))
    .filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, max);
  return list.length ? list : [...fallback];
};

const nearest = (value, allowed, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return allowed.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), allowed[0]);
};

// Метки кабинетов: { [id]: { label, color, note, pinned } } — только непустые записи, не более 500.
export function normalizeAccountMeta(raw) {
  const out = {};
  for (const [id, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^\d{5,30}$/.test(id) || !v || typeof v !== 'object') continue;
    const label = String(v.label ?? '').trim().slice(0, 24), note = String(v.note ?? '').trim().slice(0, 300), pinned = v.pinned === true;
    if (!label && !note && !pinned) continue;
    out[id] = { label, color: META_COLORS.includes(v.color) ? v.color : 'gray', note, pinned };
    if (Object.keys(out).length >= 500) break;
  }
  return out;
}

const BC_ID = /^\d{5,30}$/;
const idList = (value, max) => [...new Set((Array.isArray(value) ? value : []).map(String).filter((id) => BC_ID.test(id)))].slice(0, max);

const PRESET_LIMIT = 12;

// Профили конвейера: сохранённые наборы «сколько, где, имена, Portfolio, шаринг/transfer» для запуска в один клик.
export function normalizePresets(raw) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const id = String(item?.id ?? '').replace(/[^\w-]/g, '').slice(0, 40);
    const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!id || !name || out.some((p) => p.id === id)) continue;
    const { partners, presets, ...config } = normalizeAutomation(item.config ?? {});
    out.push({ id, name, config });
    if (out.length >= PRESET_LIMIT) break;
  }
  return out;
}

export function normalizeAutomation(raw = {}) {
  const d = DEFAULT_SETTINGS.automation, share = raw.share ?? {}, transfer = raw.transfer ?? {};
  const partners = [];
  for (const item of Array.isArray(raw.partners) ? raw.partners : []) {
    const id = String(item?.id ?? '');
    if (!BC_ID.test(id) || partners.some((p) => p.id === id)) continue;
    partners.push({ id, name: String(item?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) });
    if (partners.length >= 50) break;
  }
  return {
    mode: raw.mode === 'existing-bc' ? 'existing-bc' : 'new-bc',
    count: clampInt(raw.count, 1, 20, d.count),
    businessCenterId: BC_ID.test(String(raw.businessCenterId ?? '')) ? String(raw.businessCenterId) : '',
    bcTemplate: String(raw.bcTemplate ?? '').trim().slice(0, 80) || d.bcTemplate,
    adTemplate: String(raw.adTemplate ?? '').trim().slice(0, 80) || d.adTemplate,
    linkPortfolio: raw.linkPortfolio === true,
    closeTabs: raw.closeTabs !== false,
    share: {
      enabled: share.enabled === true,
      targets: idList(share.targets, 10),
      permission: ['Admin', 'Operator', 'Analyst'].includes(share.permission) ? share.permission : d.share.permission,
      autoAccept: share.autoAccept !== false
    },
    transfer: {
      // Передача владения и шаринг взаимоисключающие: при обоих включённых побеждает шаринг (как в 1.5.0).
      enabled: transfer.enabled === true && share.enabled !== true,
      targetBusinessCenterId: BC_ID.test(String(transfer.targetBusinessCenterId ?? '')) ? String(transfer.targetBusinessCenterId) : ''
    },
    partners,
    presets: Array.isArray(raw.presets) && raw.presets.length ? normalizePresets(raw.presets) : []
  };
}

// Приводит сохранённые данные к безопасной форме: неизвестные ключи отбрасываются, значения ограничиваются.
export function normalizeSettings(raw = {}) {
  const d = DEFAULT_SETTINGS;
  const m = raw.manual ?? {}, a = raw.appeals ?? {}, s = raw.s2s ?? {}, u = raw.ui ?? {}, mon = raw.monitor ?? {}, ov = raw.overview ?? {};
  const templates = (Array.isArray(a.templates) ? a.templates : [])
    .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && t.text.trim())
    .slice(0, 30)
    .map((t) => ({ id: t.id.slice(0, 40), name: String(t.name || 'Шаблон').slice(0, 60), text: t.text.slice(0, 2000) }));
  if (!templates.some((t) => t.id === 'default')) templates.unshift({ ...d.appeals.templates[0] });
  const templateId = templates.some((t) => t.id === a.templateId) ? a.templateId : 'default';
  return {
    manual: {
      autoClick: m.autoClick === true,
      labels: strList(m.labels, d.manual.labels),
      fields: strList(m.fields, d.manual.fields, 100).filter((x) => /^[A-Za-z0-9_]{1,80}$/.test(x))
    },
    appeals: {
      concurrency: clampInt(a.concurrency, 1, 6, d.appeals.concurrency),
      reason: clampInt(a.reason, 1, 5, d.appeals.reason),
      templateId,
      templates
    },
    s2s: {
      domain: String(s.domain ?? '').slice(0, 253),
      path: String(s.path ?? d.s2s.path).slice(0, 200) || d.s2s.path,
      event: /^[A-Za-z0-9_]{1,64}$/.test(s.event ?? '') ? s.event : d.s2s.event,
      api: s.api === '2' ? '2' : '1',
      value: String(s.value ?? '').slice(0, 60),
      currency: /^[A-Za-z]{3}$/.test(s.currency ?? '') ? String(s.currency).toUpperCase() : d.s2s.currency
    },
    links: normalizeLinksSettings(raw.links),
    monitor: {
      enabled: mon.enabled === true,
      intervalMin: nearest(mon.intervalMin, MONITOR_INTERVALS, d.monitor.intervalMin),
      notify: mon.notify === true
    },
    overview: {
      period: PERIODS.some((p) => p.id === ov.period) ? ov.period : d.overview.period,
      sort: ['problems', 'spend', 'name'].includes(ov.sort) ? ov.sort : d.overview.sort,
      filter: ['all', 'issues', 'working', 'off', 'no-card', 'debt', 'suspended', 'review'].includes(ov.filter) ? ov.filter : d.overview.filter
    },
    accounts: { meta: normalizeAccountMeta(raw.accounts?.meta) },
    automation: normalizeAutomation(raw.automation ?? {}),
    health: {
      concurrency: clampInt(raw.health?.concurrency, 1, 3, d.health.concurrency),
      includeBc: raw.health?.includeBc !== false,
      auto: {
        enabled: raw.health?.auto?.enabled === true,
        intervalMin: nearest(raw.health?.auto?.intervalMin, HEALTH_INTERVALS, d.health.auto.intervalMin),
        notify: raw.health?.auto?.notify === true
      }
    },
    ui: { theme: ['auto', 'dark', 'light'].includes(u.theme) ? u.theme : d.ui.theme }
  };
}

export async function getSettings() {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return normalizeSettings(stored ?? {});
}

export async function saveSettings(next) {
  const clean = normalizeSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: clean });
  return clean;
}

export function patchSettings(patch) {
  return withLock('tth-settings', async () => {
    const current = await getSettings();
    const merged = {};
    for (const section of Object.keys(current)) merged[section] = { ...current[section], ...(patch?.[section] ?? {}) };
    return saveSettings(merged);
  });
}

// Журнал: очередь записей сериализуется, чтобы параллельные события не затирали друг друга.
let journalQueue = Promise.resolve();

export function log(level, src, msg, data) {
  const entry = { t: Date.now(), level, src, msg: String(msg).slice(0, 500) };
  if (data !== undefined) entry.data = data;
  journalQueue = journalQueue.then(async () => {
    const list = (await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY] ?? [];
    list.push(entry);
    if (list.length > JOURNAL_LIMIT) list.splice(0, list.length - JOURNAL_LIMIT);
    await chrome.storage.local.set({ [JOURNAL_KEY]: list });
  }).catch(() => {});
  return journalQueue;
}

export async function readJournal() {
  await journalQueue;
  return (await chrome.storage.local.get(JOURNAL_KEY))[JOURNAL_KEY] ?? [];
}

export async function clearJournal() {
  await journalQueue;
  await chrome.storage.local.remove(JOURNAL_KEY);
}

// Эксклюзивная секция для чтения-изменения-записи (navigator.locks есть в сервис-воркере).
const fallbackLocks = new Map();
export async function withLock(name, fn) {
  if (globalThis.navigator?.locks?.request) return navigator.locks.request(name, fn);
  const prev = fallbackLocks.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  fallbackLocks.set(name, run.catch(() => {}));
  return run;
}
