// Движок Manual-кампаний (порт Plusone 3.0.10 без обфускации и без серверных «рецептов»).
// Схема: пассивно перехватываем штатное сохранение черновика TikTok → правим флаги автоматизации →
// повторно отправляем сохранение в той же сессии → перезагружаем черновик и показываем Manual.
import { ORIGIN } from '../lib/constants.js';
import { HubError, wait, accountFromUrl, parseAdsUrl, runInPage } from '../lib/page.js';
import { log } from '../lib/storage.js';
import {
  LOCAL_RECIPE, SAVE_PATH, SALES_APP_UNSUPPORTED, campaignKind, recipePatch, safeUrlParams, unsupportedUnifiedSalesApp
} from './recipe.js';
import { selectedGoal, manualView, inspectCreationModal } from './probes.js';

const SAVE_FILTER = { urls: [`${ORIGIN}${SAVE_PATH}*`] };
const KEPT_HEADERS = new Set(['x-csrftoken', 'app-name', 'x-ttam-version', 'x-ttam-uuid']);
const ARM_TTL = 180000;
const VIEW_TTL = 90000;

const key = (name, tabId) => `tth:manual:${name}:${tabId}`;
const sget = async (k) => (await chrome.storage.session.get(k))[k];
const sset = (k, v) => chrome.storage.session.set({ [k]: v });
const sdel = (k) => chrome.storage.session.remove(k);

const pending = new Map();
const busyTabs = new Set();
const activatingTabs = new Set();
const bindingTabs = new Set();
const viewChecks = new Set();
const learnedKinds = new Map();

const isRetryable = (e) => e?.code === 'loading' || /still loading|navigat|receiving end|no frame|loading/i.test(String(e?.message ?? e ?? ''));

function decodeBody(requestBody) {
  try {
    if (requestBody?.raw?.length) {
      return JSON.parse(requestBody.raw.map((part) => new TextDecoder().decode(part.bytes)).join(''));
    }
    if (requestBody?.formData) return requestBody.formData;
  } catch { /* не JSON — не наш запрос */ }
  return null;
}

/* ---------- Перехват штатного сохранения черновика ---------- */

function onBeforeRequest(details) {
  if (details.tabId < 0 || details.method !== 'POST') return;
  const body = decodeBody(details.requestBody);
  if (!body?.campaign_sketch_form_data?.campaign_sketch_id) return;
  pending.set(details.requestId, { tabId: details.tabId, account: accountFromUrl(details.url), body, headers: {}, at: Date.now() });
}

function onBeforeSendHeaders(details) {
  const entry = pending.get(details.requestId);
  if (!entry) return;
  for (const header of details.requestHeaders || []) {
    if (KEPT_HEADERS.has(header.name.toLowerCase()) && typeof header.value === 'string') entry.headers[header.name] = header.value;
  }
}

function onCompleted(details) {
  const entry = pending.get(details.requestId);
  pending.delete(details.requestId);
  if (!entry || details.statusCode < 200 || details.statusCode >= 300) return;
  completeCapture(entry).catch((e) => setError(entry.tabId, e.message));
}

async function setError(tabId, message, context) {
  if (!context) {
    try {
      const u = new URL((await chrome.tabs.get(tabId)).url);
      context = { account: u.searchParams.get('aadvid'), draft: u.searchParams.get('campaign_draft_id') };
    } catch { context = {}; }
  }
  await sset(key('error', tabId), { message: String(message || 'Неизвестная ошибка'), account: context.account || null, draft: context.draft || null });
  log('error', 'manual', String(message || 'Неизвестная ошибка'));
}

async function completeCapture(capture) {
  const { tabId } = capture;
  const form = capture?.body?.campaign_sketch_form_data;
  if (!capture.account || !form?.campaign_sketch_id ||
      !Object.keys(capture.headers || {}).some((h) => h.toLowerCase() === 'x-csrftoken')) return;
  const old = await sget(key('capture', tabId));
  if (old?.at > capture.at) return;
  await sset(key('capture', tabId), capture);

  const armedKey = key('armed', tabId);
  const armed = await sget(armedKey);
  if (!armed || armed.account !== capture.account || Date.now() > armed.expires || capture.at < armed.at || busyTabs.has(tabId)) return;
  const draft = String(form.campaign_sketch_id);
  if (armed.draft && armed.draft !== draft) return;
  if (!form.campaign_snap_id || form.campaign_id) return;

  busyTabs.add(tabId);
  try {
    if (!armed.draft) { armed.draft = draft; await sset(armedKey, armed); }
    await wait(1200);
    const current = await sget(armedKey);
    if (current?.token !== armed.token || Date.now() > current.expires) return;
    const tab = await chrome.tabs.get(tabId);
    const u = new URL(tab.url);
    if (armed.mode === 'create' && !u.searchParams.get('campaign_draft_id') && u.origin === ORIGIN && u.searchParams.get('aadvid') === capture.account) return;
    if (u.origin !== ORIGIN || u.searchParams.get('aadvid') !== capture.account ||
        u.searchParams.get('campaign_draft_id') !== draft || !u.pathname.endsWith('/create/campaign')) {
      throw new HubError('Вкладка переключилась на другой кабинет или черновик.');
    }
    const kind = campaignKind(form, LOCAL_RECIPE, armed.objective, learnedKinds);
    if (!kind || (armed.objective && kind !== armed.objective)) throw new HubError('Цель кампании изменилась. Повторите.');
    learnedKinds.set(String(form.objective_type), kind);
    await sdel(armedKey);
    const result = await applyCaptured(tabId, capture, kind);
    if (result?.error) {
      // API-first: если TikTok сменил контракт save/replay, новый unified editor всё ещё позволяет
      // безопасно выключить Smart+ в текущем черновике без открытия новой страницы.
      const fallback = await inspectView(tabId, { account: capture.account, draft, objective: kind }, true).catch(() => null);
      if (fallback?.shown) {
        await sdel(key('error', tabId));
        log('warn', 'manual', `API переключения изменился; Manual включён через unified Smart+ switch (${result.error})`);
      } else await setError(tabId, result.error);
    }
  } catch (e) {
    await sdel(armedKey);
    await setError(tabId, e.message || 'Не удалось переключить на Manual.');
  } finally {
    busyTabs.delete(tabId);
  }
}

/* ---------- Ожидание, проверка вкладки, сохранение ---------- */

async function waitStable(tabId, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { throw new HubError('Вкладка закрыта. Откройте черновик и повторите.'); }
    if (tab.url?.startsWith(`${ORIGIN}/`) && tab.status === 'complete') return tab;
    if (Date.now() >= deadline) throw new HubError('Вкладка ещё загружается. Подождите и повторите.', 'loading');
    await wait(250);
  }
}

function checkDraftTab(url, ctx) {
  let u;
  try { u = new URL(url); } catch { throw new HubError('Откройте черновик на шаге «Campaign».'); }
  if (u.hostname !== 'ads.tiktok.com' || u.searchParams.get('aadvid') !== ctx.account) throw new HubError('Кабинет на вкладке изменился.');
  if (!u.pathname.endsWith('/create/campaign') || u.searchParams.get('campaign_draft_id') !== ctx.draft) throw new HubError('Откройте черновик на шаге «Campaign».');
  return u;
}

async function saveDraft(tabId, capture, ctx) {
  const tab = await waitStable(tabId);
  checkDraftTab(tab.url, ctx);
  const form = capture?.body?.campaign_sketch_form_data;
  if (String(form?.campaign_sketch_id) !== ctx.draft || form?.campaign_id || !form?.campaign_snap_id) throw new HubError('Данные черновика не совпадают.');
  if (unsupportedUnifiedSalesApp(tab.url, ctx, LOCAL_RECIPE, form)) throw new HubError(SALES_APP_UNSUPPORTED);

  const patch = recipePatch(capture.body, LOCAL_RECIPE, ctx.objective);
  if (patch.changed) {
    const url = new URL(ORIGIN + SAVE_PATH);
    url.searchParams.set('aadvid', ctx.account);
    if (LOCAL_RECIPE.endpoint.query.req_src) url.searchParams.set('req_src', LOCAL_RECIPE.endpoint.query.req_src);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    let response, result;
    try {
      response = await fetch(url.href, {
        method: 'POST', redirect: 'error', credentials: 'include', signal: controller.signal,
        headers: { ...capture.headers, 'content-type': 'application/json; charset=UTF-8', accept: 'application/json, text/plain, */*' },
        body: JSON.stringify(patch.body)
      });
      result = await response.json();
    } finally { clearTimeout(timer); }
    if (!response.ok || result?.code !== 0) throw new HubError(`TikTok отклонил сохранение черновика: ${result?.msg || response.status}`);
    if (String(result?.data?.campaign_sketch_id) !== ctx.draft) throw new HubError('TikTok вернул другой черновик.');
  }
  const latest = await chrome.tabs.get(tabId);
  checkDraftTab(latest.url, ctx);
  return { ok: true, replayed: patch.changed, nextUrl: safeUrlParams(latest.url, LOCAL_RECIPE, ctx.objective, patch.exact, ctx.account, ctx.draft) };
}

async function navigateToDraft(tabId, ctx, nextUrl) {
  const tab = await waitStable(tabId);
  const current = checkDraftTab(tab.url, ctx);
  const target = new URL(nextUrl);
  if (target.origin !== current.origin || target.searchParams.get('aadvid') !== ctx.account || target.searchParams.get('campaign_draft_id') !== ctx.draft) {
    throw new HubError('Вкладка переключилась на другой черновик.');
  }
  await chrome.tabs.update(tabId, { url: target.href });
  await waitStable(tabId, 20000);
}

async function applyCaptured(tabId, capture, hint = null) {
  try {
    const form = capture?.body?.campaign_sketch_form_data;
    if (!form?.campaign_sketch_id || !form.campaign_snap_id || form.campaign_id) throw new HubError('Черновик не найден или уже опубликован.');
    const objective = campaignKind(form, LOCAL_RECIPE, hint || (await inspectGoal(tabId)), learnedKinds);
    if (!objective) throw new HubError('Выберите цель кампании: App Promotion, Lead Generation или Sales.');
    learnedKinds.set(String(form.objective_type), objective);
    const ctx = { account: capture.account, draft: String(form.campaign_sketch_id), objective };

    let saved, lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { saved = await saveDraft(tabId, capture, ctx); break; } catch (e) {
        lastError = e;
        if (attempt < 3 && isRetryable(e)) { await wait(attempt * 600); continue; }
        throw e;
      }
    }
    if (!saved?.ok) throw lastError || new HubError('Не удалось сохранить черновик.');
    await sset(key('view', tabId), { ...ctx, token: crypto.randomUUID(), expires: Date.now() + VIEW_TTL });
    await navigateToDraft(tabId, ctx, saved.nextUrl);
    log('info', 'manual', `Черновик ${ctx.draft} (${objective}) переключён на Manual${saved.replayed ? '' : ' (флаги уже были выставлены)'}`);
    return { ok: true, viewPending: true };
  } catch (e) {
    return { error: e?.message || 'Не удалось переключить на Manual.' };
  }
}

/* ---------- Состояние и действия, доступные из интерфейса ---------- */

async function inspectGoal(tabId) {
  try { return (await runInPage(tabId, selectedGoal)) || null; } catch { return null; }
}

async function inspectView(tabId, ctx, click) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await runInPage(tabId, manualView, [ctx, click]);
      if (result) return result;
    } catch (e) { if (attempt === 2) throw e; }
    if (attempt < 2) { try { await waitStable(tabId, 3000); } catch { /* повторим */ } await wait(500); }
  }
  return { error: 'Страница перезагружается.' };
}

async function creationModal(tabId, account, click, expected = null) {
  const result = await runInPage(tabId, inspectCreationModal, [account, click, expected]);
  return result || { eligible: false, error: 'Не удалось прочитать окно создания кампании.' };
}

async function revealPendingView(tabId) {
  if (viewChecks.has(tabId)) return;
  viewChecks.add(tabId);
  try {
    const viewKey = key('view', tabId);
    const view = await sget(viewKey);
    if (!view) return;
    const tab = await chrome.tabs.get(tabId);
    const u = new URL(tab.url);
    if (view.expires < Date.now() || u.hostname !== 'ads.tiktok.com' || u.searchParams.get('aadvid') !== view.account ||
        u.searchParams.get('campaign_draft_id') !== view.draft || !u.pathname.endsWith('/create/campaign')) {
      await sdel(viewKey);
      return;
    }
    const result = await inspectView(tabId, view, true);
    if ((await sget(viewKey))?.token !== view.token) return;
    await sdel(viewKey);
    if (result.shown) await sdel(key('error', tabId));
    else if (result.error) await setError(tabId, result.error, view);
  } finally { viewChecks.delete(tabId); }
}

async function ensureCapture(tabId) {
  if (bindingTabs.has(tabId)) return;
  bindingTabs.add(tabId);
  try {
    const armedKey = key('armed', tabId);
    const armed = await sget(armedKey);
    if (!armed || armed.mode !== 'create' || armed.expires < Date.now()) return;
    const tab = await chrome.tabs.get(tabId);
    const u = new URL(tab.url);
    if (u.hostname !== 'ads.tiktok.com' || accountFromUrl(tab.url) !== armed.account) { await sdel(armedKey); return; }
    const draftId = u.searchParams.get('campaign_draft_id');
    if (!draftId || !u.pathname.endsWith('/create/campaign')) return;
    if ((armed.draft && armed.draft !== draftId) || (!armed.draft && armed.excludeDraft === draftId)) {
      await sdel(armedKey);
      await setError(tabId, 'Открыт не тот черновик.');
      return;
    }
    if (armed.bootstrapDraft === draftId) return;
    const fresh = await sget(armedKey);
    if (!fresh || fresh.token !== armed.token) return;
    await sset(armedKey, { ...armed, draft: draftId, bootstrapDraft: draftId });
    await wait(2000);
    const after = await sget(armedKey);
    if (!after || after.token !== armed.token || after.expires < Date.now() || busyTabs.has(tabId)) return;
    const now = new URL((await chrome.tabs.get(tabId)).url);
    if (now.hostname !== 'ads.tiktok.com' || now.searchParams.get('aadvid') !== armed.account ||
        now.searchParams.get('campaign_draft_id') !== draftId || !now.pathname.endsWith('/create/campaign')) { await sdel(armedKey); return; }
    const capture = await sget(key('capture', tabId));
    const form = capture?.body?.campaign_sketch_form_data;
    if (capture?.account === armed.account && capture.at >= armed.at && String(form?.campaign_sketch_id) === draftId && form.campaign_snap_id) {
      await completeCapture(capture);
    } else {
      await chrome.tabs.reload(tabId); // TikTok пересохранит черновик при загрузке — перехватим
    }
  } finally { bindingTabs.delete(tabId); }
}

export async function getState(tabId, tabUrl) {
  const info = parseAdsUrl(tabUrl);
  if (!info.ok) throw new HubError('Откройте TikTok Ads Manager.', 'not_ads');
  const { account, draft } = info;
  const keys = [key('capture', tabId), key('armed', tabId), key('error', tabId), key('view', tabId)];
  const values = await chrome.storage.session.get(keys);
  const capture = values[key('capture', tabId)];
  const form = capture?.body?.campaign_sketch_form_data;
  const valid = Boolean(draft && capture?.account === account && String(form?.campaign_sketch_id) === draft && !form?.campaign_id);
  const hint = draft ? await inspectGoal(tabId) : null;
  const kind = valid ? campaignKind(form, LOCAL_RECIPE, hint, learnedKinds) : hint;
  if (valid && kind) learnedKinds.set(String(form.objective_type), kind);

  let canCreate = false, creationObjective = null;
  if (account && !draft && !busyTabs.has(tabId)) {
    try {
      const modal = await creationModal(tabId, account, false);
      canCreate = Boolean(modal.eligible);
      creationObjective = modal.objective || null;
    } catch { /* окно создания не открыто */ }
  }
  const onDraftPage = Boolean(draft && info.path.endsWith('/create/campaign'));
  let manual = null;
  if (onDraftPage && !busyTabs.has(tabId) && !activatingTabs.has(tabId)) {
    try {
      const v = await inspectView(tabId, { account, draft }, false);
      if (!v.error) manual = { present: Boolean(v.manual), shown: Boolean(v.shown), mode: v.mode || 'legacy', smartPlus: v.smartPlus === true };
    } catch { /* страница меняется */ }
  }
  const view = values[key('view', tabId)];
  const viewPending = Boolean(view && view.account === account && view.draft === draft && view.expires >= Date.now());
  const armed = values[key('armed', tabId)];
  const error = values[key('error', tabId)];
  return {
    account, draft, path: info.path,
    canActivate: Boolean((draft && onDraftPage && (!valid || kind)) || canCreate),
    canCreate,
    objective: creationObjective || kind || hint,
    ready: Boolean(valid && kind && form.campaign_snap_id),
    busy: busyTabs.has(tabId) || activatingTabs.has(tabId) || viewChecks.has(tabId) || viewPending,
    viewPending,
    armed: Boolean(armed && armed.account === account && armed.expires >= Date.now()),
    manual,
    lastError: error?.account === account && error?.draft === draft ? error.message : ''
  };
}

export async function activate(tabId, tabUrl) {
  if (activatingTabs.has(tabId) || busyTabs.has(tabId) || viewChecks.has(tabId)) return { error: 'Идёт обработка, подождите…' };
  activatingTabs.add(tabId);
  try { return await startActivation(tabId, tabUrl); } finally { activatingTabs.delete(tabId); }
}

async function startActivation(tabId, tabUrl) {
  const state = await getState(tabId, tabUrl);
  if (!state.account) return { error: 'Не удалось определить рекламный кабинет (нет aadvid в адресе).' };
  if (!state.canActivate) return { error: 'Выберите цель кампании: App Promotion, Lead Generation или Sales.' };
  if (state.armed || state.viewPending || busyTabs.has(tabId)) return { error: 'Идёт обработка, подождите…' };
  await sdel(key('error', tabId));
  const capture = await sget(key('capture', tabId));

  if (state.draft) {
    const ctx = { account: state.account, draft: state.draft };
    const formForCheck = capture?.account === ctx.account ? capture.body?.campaign_sketch_form_data : null;
    if (unsupportedUnifiedSalesApp(tabUrl, ctx, LOCAL_RECIPE, formForCheck)) return { error: SALES_APP_UNSUPPORTED };
    const view = await inspectView(tabId, ctx, false);
    if (view.manual) {
      const shown = view.shown ? view : await inspectView(tabId, ctx, true);
      if (shown.error) await setError(tabId, shown.error);
      return shown.shown ? { ok: true, shown: true } : shown;
    }
  }
  if (busyTabs.has(tabId)) return { error: 'Переключаю на Manual…' };

  if (state.ready) {
    busyTabs.add(tabId);
    await sdel(key('armed', tabId));
    try {
      const result = await applyCaptured(tabId, capture);
      if (result?.error) {
        const fallback = await inspectView(tabId, { account: state.account, draft: state.draft }, true).catch(() => null);
        if (fallback?.shown) {
          await sdel(key('error', tabId));
          log('warn', 'manual', `API переключения изменился; Manual включён через unified Smart+ switch (${result.error})`);
          return { ok: true, shown: true, fallback: 'unified-dom', apiError: result.error };
        }
        await setError(tabId, result.error);
      }
      return result;
    } catch (e) { await setError(tabId, e.message); return { error: e.message }; } finally { busyTabs.delete(tabId); }
  }

  const now = Date.now();
  await sset(key('armed', tabId), {
    account: state.account, draft: state.draft, objective: state.objective,
    mode: state.canCreate ? 'create' : 'draft',
    excludeDraft: capture?.account === state.account ? String(capture.body?.campaign_sketch_form_data?.campaign_sketch_id || '') : '',
    at: now, expires: now + ARM_TTL, token: crypto.randomUUID()
  });
  try {
    if (state.canCreate) {
      const modal = await creationModal(tabId, state.account, true, state.objective);
      if (!modal.clicked) throw new HubError(modal.error || 'TikTok ещё не создал черновик.');
      ensureCapture(tabId).catch((e) => setError(tabId, e.message));
      wait(15000).then(async () => {
        const armed = await sget(key('armed', tabId));
        if (armed?.at === now && !armed.draft) {
          await sdel(key('armed', tabId));
          await setError(tabId, 'TikTok не создал черновик. Проверьте экран.');
        }
      });
      return { armed: true, creating: true };
    }
    await chrome.tabs.reload(tabId);
    return { armed: true, reloading: true };
  } catch (e) {
    await sdel(key('armed', tabId));
    return { error: e.message };
  }
}

export async function cancel(tabId) {
  await sdel(key('armed', tabId));
  await sdel(key('view', tabId));
  return { cancelled: true };
}

export function registerManualListeners() {
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, SAVE_FILTER, ['requestBody']);
  chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, SAVE_FILTER, ['requestHeaders', 'extraHeaders']);
  chrome.webRequest.onErrorOccurred.addListener((d) => pending.delete(d.requestId), SAVE_FILTER);
  chrome.webRequest.onCompleted.addListener(onCompleted, SAVE_FILTER);
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.status === 'complete') ensureCapture(tabId).catch((e) => setError(tabId, e.message));
    if (change.status === 'complete') revealPendingView(tabId).catch((e) => setError(tabId, e.message));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove([key('capture', tabId), key('armed', tabId), key('error', tabId), key('view', tabId)]);
  });
}
