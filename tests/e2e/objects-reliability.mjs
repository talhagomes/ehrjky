import { boot, openAds, openUi, sleep, checks } from './harness.mjs';
import { installMutations, state } from './mock-tiktok.mjs';

const env = await boot();
const log = (...a) => console.log(...a);
const A1 = env.ACC.A1, A2 = env.ACC.A2, A3 = env.ACC.A3;
const IDS = ['7700100000000000001', '7700100000000000002', '7700100000000000003', '7700100000000000004'];
const waitFor = async (fn, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } throw new Error('timeout'); };
const t = checks('Надёжность массовых действий: лимит, потерянный ответ, смена контракта');
const verdict = (name, ok, extra = '') => t.ok(name, ok, extra);
const camp = (id) => Object.values(state.campaigns).flat().find((c) => c.campaign_id === id);
const reset = () => { for (const id of IDS) camp(id).opt_status = 1, camp(id).primary_status = 'delivery_ok'; state.calls.length = 0; };
const mutationCalls = (id) => state.calls.filter((c) => /update_status/.test(c.path) && c.body.includes(id)).length;

try {
  installMutations();
  const base = state.handler;
  let hook = null;                                         // (id, attempt) => ответ | undefined
  const attempts = new Map();
  state.handler = (req, url, body) => {
    if (req.method === 'POST' && /update_status/.test(url.pathname) && hook) {
      const id = JSON.parse(body).campaign_ids?.[0];
      const n = (attempts.get(id) || 0) + 1; attempts.set(id, n);
      const out = hook(id, n, () => base(req, url, body));
      if (out) return out;
    }
    return base(req, url, body);
  };

  const { tabId, page: ads } = await openAds(env);
  const ui = await openUi(env, tabId);
  const store = (key) => ui.evaluate((k) => chrome.storage.local.get(k).then((v) => v[k]), key);
  const send = (type, input) => ui.evaluate((t, i) => chrome.runtime.sendMessage({ ns: 'objects', type: t, input: i }), type, input);
  const native = (path, body) => ads.evaluate(async (p, b) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8', 'x-csrftoken': 'tok' }, body: JSON.stringify(b) })).status, path, body);
  await ui.waitForSelector('.account-card', { timeout: 30000 });
  await env.evalSw(() => { globalThis.__tth.objects.RETRY.rate = [400, 800]; globalThis.__tth.objects.RETRY.transient = [200, 400]; });

  const learnStatus = async () => {                         // обучение вкл/выкл «нативными» запросами
    for (const [opt, label] of [[2, 'disable'], [1, 'enable']]) {
      const r = await send('learnStart', { account: A1, level: 'campaign', kind: 'status', objectId: IDS[1], tabId });
      if (!r.ok) throw new Error(`learnStart: ${r.error}`);
      if (opt === 1 && camp(IDS[1]).opt_status === 1) camp(IDS[1]).opt_status = 2;   // чтобы состояние объекта менялось
      await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, { campaign_ids: [IDS[1]], opt_status: opt, advertiser_id: A1 });
      await waitFor(async () => (await store('objectsLearn'))?.learned?.includes(label));
      if (opt === 2) await send('learnStop'); 
    }
  };
  const lastJob = async (pred = () => true) => waitFor(async () => { const j = await store('objectsJob'); return j && j.state !== 'running' && pred(j) ? j : null; });
  const apply = (extra = {}) => send('apply', { action: 'disable', level: 'campaign', accounts: [A1, A2, A3], ...extra });
  const info = async (action = 'disable') => (await send('status')).data.contracts.campaign[action];

  // обучение: сначала «выключить», потом «включить» (нужны оба варианта для отката и сценариев)
  await send('learnStart', { account: A1, level: 'campaign', kind: 'status', objectId: IDS[1], tabId });
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, { campaign_ids: [IDS[1]], opt_status: 2, advertiser_id: A1 });
  await waitFor(async () => (await store('objectsLearn'))?.learned?.includes('disable'));
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, { campaign_ids: [IDS[1]], opt_status: 1, advertiser_id: A1 });
  await waitFor(async () => (await store('objectsLearn'))?.state === 'done');
  verdict('обучено: контракт готов, возраст 0 дн.', (await info('disable')).state === 'ready' && (await info('enable')).state === 'ready');

  // A: лимит запросов → пауза, повтор, успех
  reset(); attempts.clear();
  let limited = 2;
  hook = () => (limited-- > 0 ? { status: 429, text: '{"code":40133,"msg":"Too many requests"}' } : null);
  let r = await apply();
  let job = await lastJob();
  const tries = job.items.map((i) => i.request.tries);
  verdict('A 429: все подтверждены повторным чтением', r.ok && job.state === 'complete' && job.verified === job.total, `${job.state} ${job.verified}/${job.total}`);
  verdict('A 429: были повторы, ошибок в итоге нет', Math.max(...tries) > 1 && job.failed === 0 && !job.errorKinds?.rate, JSON.stringify({ tries, errorKinds: job.errorKinds }));

  // B: ответ потерян (500), но изменение применилось → повтор не отправляется, итог «late»
  reset(); attempts.clear(); const lateId = IDS[0];
  hook = (id, n, doApply) => { if (id === lateId && n === 1) { doApply(); return { status: 500, text: 'oops' }; } return null; };
  r = await apply();
  job = await lastJob();
  const lateItem = job.items.find((i) => i.id === lateId);
  verdict('B потерянный ответ: изменение засчитано без второго запроса', lateItem.request.ok && lateItem.request.late === true && lateItem.verified === true && mutationCalls(lateId) === 1, JSON.stringify({ req: lateItem.request, calls: mutationCalls(lateId) }));
  verdict('B итог полный, повторы только по необходимости', job.state === 'complete' && job.verified === job.total, `${job.state} ${job.verified}/${job.total}`);

  // C: 401 → сразу остановка, контракт цел
  reset(); attempts.clear();
  hook = () => ({ status: 401, text: '{"code":40105,"msg":"Access token is incorrect"}' });
  r = await apply();
  job = await lastJob();
  verdict('C 401: остановка после первых ответов, остальные пропущены', job.state === 'error' && job.items.some((i) => i.request.skipped) && /вход|Сессия/.test(job.error), `${job.state}: ${job.error}`);
  verdict('C 401: контракт не отключён', (await info('disable')).state === 'ready');

  // D: «ок» без эффекта → контракт отключается
  reset(); attempts.clear();
  hook = () => ({ json: { code: 0, msg: 'ok' } });
  r = await apply();
  job = await lastJob((j) => j.invalidated || j.state !== 'running');
  verdict('D «ок» без эффекта: контракт отключён (no-effect)', job.invalidated === 'no-effect' && (await info('disable')).state === 'invalid', `${job.state} ${job.invalidated}`);
  const refused = await apply();
  verdict('D отключённый контракт не запускается и объясняет причину', !refused.ok && /отключено/.test(refused.error || ''), String(refused.error).slice(0, 110));
  const planned = (await send('plan', { action: 'disable', level: 'campaign', accounts: [A1] })).data;
  verdict('D предпросмотр знает, что контракт отключён', planned.ready === false && planned.contract.state === 'invalid');

  // E: адрес изменился (404) → остановка и отключение; затем переобучение возвращает работоспособность
  hook = null;
  await send('reset'); await learnStatus();
  reset(); attempts.clear();
  hook = () => ({ status: 404, text: 'not found' });
  r = await apply();
  job = await lastJob();
  verdict('E 404: контракт отключён как «адрес изменился», остальные запросы не отправлены', job.invalidated === 'schema' && job.items.filter((i) => !i.request.skipped).length <= 3 && (await info('disable')).state === 'invalid', `${job.invalidated} sent=${job.items.filter((i) => !i.request.skipped).length}`);
  hook = null;
  await send('reset'); await learnStatus();
  reset(); attempts.clear();
  r = await apply();
  job = await lastJob();
  verdict('E после переобучения массовое действие снова работает', r.ok && job.state === 'complete' && job.verified === job.total && !job.invalidated, `${job.state} ${job.verified}/${job.total}`);

  // F: возраст контракта
  const old = Date.now() - 20 * 24 * 3600 * 1000;
  await ui.evaluate(async (at) => { const v = (await chrome.storage.local.get('objectContracts')).objectContracts; for (const e of Object.values(v)) for (const x of Object.values(e.variants)) x.at = at; await chrome.storage.local.set({ objectContracts: v }); }, old);
  const stale = await info('disable');
  verdict('F контракту 20 дней: «устарел», но работает', stale.state === 'stale' && stale.ageDays === 20);
  reset(); attempts.clear(); r = await apply(); job = await lastJob();
  verdict('F устаревший контракт выполняет действие', r.ok && job.state === 'complete');

  const journal = (await ui.evaluate(() => chrome.runtime.sendMessage({ ns: 'journal', type: 'get' }))).data.filter((e) => e.src === 'objects').map((e) => e.msg);
  log('journal:', journal.slice(-6));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  t.finish(env);
  await env.close();
}
