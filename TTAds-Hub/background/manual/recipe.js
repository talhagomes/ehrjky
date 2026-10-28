// Чистая логика Manual-режима (порт Plusone 3.0.10): распознавание цели кампании и патч черновика.
// Модуль без обращений к chrome.* — покрыт юнит-тестами.

export const SAVE_PATH = '/api/v4/i18n/creation/campaign_snap/save/';

// Проверенные настройки Manual. Применяются только к текущему черновику кампании.
export const LOCAL_RECIPE = Object.freeze({
  objectives: {
    lead: { objective_type: 8 },
    sales: { objective_type: 3, sales_destination: 3 }
  },
  form: {
    common: { universal_type: 0, spc_automation_type: 0, auto_creation_product_type: 0, budget_optimize_switch: 0 },
    lead: { universal_type_default_on: false },
    sales: { web_all_in_one_catalog: 0 },
    delete: ['spc_upgrade_mode', 'spc_multi_ad_mode']
  },
  body: { is_from_startup: false, with_sketch: true, clear_lower_level_sketches: false, is_skip_check_fields: true },
  endpoint: { path: SAVE_PATH, query: { req_src: 'ad_creation' } },
  urlParams: { sales: { web_all_in_one_catalog: '0' }, lead: {} }
});

export const SALES_APP_UNSUPPORTED =
  'Sales → App в Manual не поддерживается в этом редакторе TikTok. Черновик не изменён. ' +
  'Обходной путь: выберите Sales / Website, включите Manual, затем в старом Manual-редакторе смените цель на App.';

export const GOALS = new Set(['app', 'lead', 'sales']);

const FORM_KEYS = new Set([
  'universal_type', 'spc_automation_type', 'auto_creation_product_type', 'budget_optimize_switch',
  'universal_type_default_on', 'web_all_in_one_catalog', 'spc_upgrade_mode', 'spc_multi_ad_mode',
  'is_spc', 'is_smart_performance', 'is_smart_plus', 'is_manual', 'campaign_mode', 'creation_mode',
  'campaign_type', 'spc_type'
]);
const BODY_KEYS = new Set(['is_from_startup', 'with_sketch', 'is_skip_check_fields', 'clear_lower_level_sketches']);
const MODE_PARAM = /^(?:is_spc|is_smart_performance|is_smart_plus|is_manual|campaign_mode|creation_mode|campaign_type|spc_type|web_all_in_one_catalog)$/;

const scalar = (v) =>
  ['boolean', 'string', 'number'].includes(typeof v) &&
  !(typeof v === 'number' && !Number.isFinite(v)) &&
  (typeof v !== 'string' || v.length <= 80);

export function profileFor(recipe, kind) {
  return recipe?.objectives?.[kind] || null;
}

export function exactProfile(form, recipe, kind) {
  const p = profileFor(recipe, kind);
  return !!p && typeof p === 'object' && Object.keys(p).length > 0 && Object.hasOwn(p, 'objective_type') &&
    Object.entries(p).every(([k, v]) => form[k] === v);
}

// app | lead | sales | null. `learned` — карта objective_type → цель, накопленная за сессию.
export function campaignKind(form, recipe = LOCAL_RECIPE, hint = null, learned = null) {
  if (form?.objective_type === undefined || form?.objective_type === null || form?.objective_type === '') return null;
  const type = String(form.objective_type);
  if (type === '16') return 'app';     // App Promotion: подтверждено на живом черновике
  if (type === '15') return 'sales';   // Sales → TikTok Shop
  for (const kind of ['lead', 'sales']) {
    const p = recipe?.objectives?.[kind];
    if (p && p.objective_type === form.objective_type && Object.entries(p).every(([k, v]) => form[k] === v)) return kind;
  }
  for (const kind of ['lead', 'sales']) {
    const p = recipe?.objectives?.[kind];
    if (p && p.objective_type === form.objective_type) return kind;
  }
  if (GOALS.has(hint)) return hint;
  const known = learned?.get?.(type);
  return GOALS.has(known) ? known : null;
}

// Возвращает копию тела запроса с Manual-настройками. changed=false — черновик уже в Manual.
export function recipePatch(body, recipe, kind) {
  const form = body?.campaign_sketch_form_data;
  if (!form) throw new Error('В запросе нет данных черновика.');
  const exact = exactProfile(form, recipe, kind);
  const known = profileFor(recipe, kind);
  if (known?.objective_type !== undefined && known.objective_type !== form.objective_type &&
      !(kind === 'sales' && String(form.objective_type) === '15')) {
    throw new Error('Настройки Manual не соответствуют выбранной цели черновика.');
  }
  const original = JSON.stringify(body);
  const next = structuredClone(body);
  const target = next.campaign_sketch_form_data;
  for (const part of [recipe?.form?.common, exact && recipe?.form?.[kind]]) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    for (const [k, v] of Object.entries(part)) if (FORM_KEYS.has(k) && scalar(v)) target[k] = v;
  }
  for (const k of recipe?.form?.delete || []) if (typeof k === 'string' && FORM_KEYS.has(k)) delete target[k];
  for (const [k, v] of Object.entries(recipe?.body || {})) if (BODY_KEYS.has(k) && typeof v === 'boolean') next[k] = v;
  return { body: next, exact, changed: JSON.stringify(next) !== original };
}

export function safeUrlParams(url, recipe, kind, exact, account, draft) {
  const next = new URL(url);
  if (next.origin !== 'https://ads.tiktok.com' || !next.pathname.endsWith('/create/campaign') ||
      next.searchParams.get('aadvid') !== account || next.searchParams.get('campaign_draft_id') !== draft) {
    throw new Error('Адрес черновика изменился.');
  }
  if (exact) {
    for (const [k, v] of Object.entries(recipe?.urlParams?.[kind] || {})) {
      if (MODE_PARAM.test(k) && scalar(v)) next.searchParams.set(k, String(v));
    }
  }
  return next.href;
}

// Sales → App в новом едином редакторе TikTok не проходит валидацию: не трогаем такой черновик.
export function unsupportedUnifiedSalesApp(tabUrl, ctx, recipe, form) {
  const url = new URL(tabUrl);
  if (url.origin !== 'https://ads.tiktok.com' || !url.pathname.startsWith('/i18n/creation/1nn/') ||
      !url.pathname.endsWith('/create/campaign') || url.searchParams.get('aadvid') !== ctx.account ||
      url.searchParams.get('campaign_draft_id') !== ctx.draft) return false;
  const matching = form && String(form.campaign_sketch_id) === ctx.draft && !form.campaign_id ? form : null;
  const objective = matching?.objective_type ?? url.searchParams.get('objective_type');
  const destination = matching?.sales_destination ?? url.searchParams.get('sales_destination');
  if (String(objective) !== '3' || String(destination) !== '4') return false;
  if (matching) return !exactProfile(matching, recipe, 'sales');
  const profile = profileFor(recipe, 'sales');
  return String(profile?.objective_type) !== '3' || String(profile?.sales_destination) !== '4';
}
