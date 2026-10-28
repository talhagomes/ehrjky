// Массовые вкл/выкл, имя и бюджет: обучение по настоящему запросу произвольной формы, предпросмотр, применение, откат, отказ сервера.
import { boot, openAds, openUi, shot, sleep, waitFor, click, checks, } from './harness.mjs';
import { installMutations, state } from './mock-tiktok.mjs';

const env = await boot();
const t = checks('Массовые действия: обучение, применение, откат');
const IDS = ['7700100000000000001', '7700100000000000002', '7700100000000000003', '7700100000000000004', '7700100000000000005'];
const camp = (id) => Object.values(state.campaigns).flat().find((c) => c.campaign_id === id);
try {
  installMutations();
  const { page: ads, tabId } = await openAds(env);
  const ui = await openUi(env, tabId);
  const { A1, A2, A3 } = env.ACC;
  const store = (key) => ui.evaluate((k) => chrome.storage.local.get(k).then((v) => v[k]), key);
  const send = (type, input) => ui.evaluate((tp, i) => chrome.runtime.sendMessage({ ns: 'objects', type: tp, input: i }), type, input);
  const native = (path, body) => ads.evaluate(async (p, b) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8', 'x-csrftoken': 'tok', 'app-name': '@tt4b-vmok/campaign-list' }, body: JSON.stringify(b) })).json(), path, body);
  const risk = { cookie_enabled: true, screen_width: 1, screen_height: 1, browser_language: 'ru', browser_online: true, timezone_name: 'UTC' };
  const sheetText = () => ui.$eval('.sheet-body', (e) => e.innerText.replace(/\s+/g, ' '));
  await ui.waitForSelector('.account-card', { timeout: 30000 });

  for (const id of [A1, A2, A3]) await ui.click(`.account-card[data-id="${id}"] .select-box input`);
  await click(ui, 'Кампании…');
  await ui.waitForSelector('.sheet[data-kind="objects"]');
  await sleep(400);
  t.ok('до обучения действие помечено как необученное', /Действие ещё не обучено/.test(await sheetText()));
  await shot(ui, 'objects-not-learned');

  // ---- обучение «выключить» и «включить» настоящими запросами (форма тела — своя, расширение её не знает) ----
  await click(ui, 'Обучить');
  await waitFor(() => ui.evaluate(() => document.querySelector('.sheet select[aria-label="Тестовый объект"]')?.options.length > 0));
  await click(ui, 'Начать запись');
  await waitFor(async () => (await store('objectsLearn'))?.state === 'waiting');
  t.ok('запись ждёт действие в TikTok и показывает, что именно сделать', /Alpha Camp/.test(await sheetText()) && /выключите|включите/.test(await sheetText()));
  await shot(ui, 'objects-learn-waiting');
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}&msToken=SECRET123&X-Bogus=ZZZ`, { campaign_ids: [IDS[0]], opt_status: 2, advertiser_id: A1, risk_info: risk });
  await waitFor(async () => (await store('objectsLearn'))?.learned?.includes('disable'));
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, { campaign_ids: [IDS[0]], opt_status: 1, advertiser_id: A1, risk_info: risk });
  await waitFor(async () => (await store('objectsLearn'))?.state === 'done');
  const contracts = await store('objectContracts');
  const variant = contracts['campaign.status'].variants.disable;
  t.ok('запомнены оба варианта: выключить и включить', ['disable', 'enable'].every((k) => contracts['campaign.status'].variants[k]));
  t.ok('в хранилище нет токенов, подписей и cookies', !/SECRET123|ZZZ|"tok"/.test(JSON.stringify(contracts)) && JSON.stringify(variant.query) === '[]' && JSON.stringify(Object.keys(variant.headers)) === '["app-name"]', variant);
  t.ok('risk_info не хранится, а помечается для сборки при каждой отправке', variant.riskInfo === true && !('risk_info' in variant.body));

  // ---- применение ----
  await click(ui, 'Закрыть');
  await ui.waitForSelector('.sheet[data-kind="objects"] .seg');
  await sleep(400);
  await click(ui, 'Предпросмотр');
  await ui.waitForSelector('.copy-tree');
  t.ok('предпросмотр: 4 кампании в 3 кабинетах, пример «было → станет»', /Будет изменено: 4/.test(await sheetText()) && /включено → выключено/.test(await sheetText()), await sheetText());
  await shot(ui, 'objects-preview');
  const before = state.calls.length;
  await click(ui, 'Выполнить');
  await waitFor(async () => ['complete', 'partial', 'error'].includes((await store('objectsJob'))?.state), 40000);
  let job = await store('objectsJob');
  t.ok('выключение подтверждено повторным чтением: 4 из 4', job.state === 'complete' && job.verified === 4, `${job.state} ${job.verified}/${job.total}`);
  t.ok('выключены только подходящие объекты, остальные не тронуты', IDS.slice(0, 4).every((id) => camp(id).opt_status === 2));
  const replays = state.calls.slice(before).filter((c) => /update_status/.test(c.path));
  t.ok('отправлено ровно 4 запроса, risk_info собран заново в странице', replays.length === 4 && replays.every((c) => /"risk_info":\{"cookie_enabled":true/.test(c.body)), replays.length);
  await sleep(400);
  await shot(ui, 'objects-job-done');

  ui.on('dialog', (dialog) => dialog.accept());
  await click(ui, 'Откатить');
  await waitFor(async () => { const j = await store('objectsJob'); return j?.rollbackOf && ['complete', 'partial', 'error'].includes(j.state); }, 40000);
  t.ok('откат вернул включённое состояние, выключенная заранее кампания осталась как была', IDS.slice(0, 4).every((id) => camp(id).opt_status === 1) && camp(IDS[4]).opt_status === 2);

  // ---- имя и бюджет: обучение запросами другой формы ----
  await send('learnStart', { account: A1, level: 'campaign', kind: 'name', objectId: IDS[1], tabId });
  await native(`/api/v3/i18n/overture/campaign/batch_update/name/?aadvid=${A1}`, { name_map: { [IDS[1]]: 'Zeta renamed' }, risk_info: risk });
  await waitFor(async () => (await store('objectsLearn'))?.state === 'done');
  await send('learnStart', { account: A1, level: 'campaign', kind: 'budget', objectId: IDS[1], tabId });
  await native(`/api/v3/i18n/overture/campaign/batch_update/budget/?aadvid=${A1}`, { budget_map: [{ campaign_id: IDS[1], budget_cents: 7700 }], risk_info: risk });
  await waitFor(async () => (await store('objectsLearn'))?.state === 'done');
  const slots = (await store('objectContracts'));
  t.ok('место имени (карта по ID) и масштаб бюджета (центы) определены по паре «отправлено → увидено»', JSON.stringify(slots['campaign.name'].variants.set.slot.path) === '["name_map",{"role":"object"}]' && slots['campaign.budget'].variants.set.slot.scale === 100);

  const origName = camp(IDS[0]).campaign_name;
  let r = await send('apply', { action: 'rename', level: 'campaign', accounts: [A1, A2], nameTemplate: '{name} #{n}' });
  await waitFor(async () => (await store('objectsJob'))?.action === 'rename' && ['complete', 'partial', 'error'].includes((await store('objectsJob')).state), 30000);
  t.ok('переименование по шаблону применено и подтверждено', r.ok && camp(IDS[0]).campaign_name === `${origName} #1`, camp(IDS[0]).campaign_name);

  r = await send('apply', { action: 'budget', level: 'campaign', accounts: [A1, A2, A3], budget: { mode: 'multiply', value: 1.5 } });
  t.ok('изменение бюджета без подтверждения расхода отклоняется', !r.ok && /подтвердите/.test(r.error || ''), r);
  const budgetsBefore = IDS.slice(0, 4).map((id) => camp(id).campaign_budget);
  r = await send('apply', { action: 'budget', level: 'campaign', accounts: [A1, A2, A3], budget: { mode: 'multiply', value: 1.5 }, confirmSpend: true });
  await waitFor(async () => (await store('objectsJob'))?.action === 'budget' && ['complete', 'partial', 'error'].includes((await store('objectsJob')).state), 30000);
  job = await store('objectsJob');
  t.ok('бюджет ×1,5 подтверждён повторным чтением', job.state === 'complete' && IDS.slice(0, 4).every((id, i) => Math.abs(camp(id).campaign_budget - budgetsBefore[i] * 1.5) < 0.01), { budgetsBefore, after: IDS.slice(0, 4).map((id) => camp(id).campaign_budget) });

  // ---- отказ сервера: остановка и отключение контракта ----
  state.handler = (req, url) => (/overture/.test(url.pathname) ? { json: { code: 50001, msg: 'signature invalid' } } : null);
  await send('apply', { action: 'disable', level: 'campaign', accounts: [A1, A2, A3] });
  await waitFor(async () => { const j = await store('objectsJob'); return j?.action === 'disable' && !j.rollbackOf && j.state !== 'running' && j.startedAt > Date.now() - 60000; }, 40000);
  job = await store('objectsJob');
  t.ok('при отказе TikTok задача останавливается, остальные запросы не отправляются', job.state === 'error' && job.items.some((i) => i.request.skipped), `${job.state}: ${job.error}`);
  t.ok('контракт отключён с понятной причиной', job.invalidated === 'validation' && /отключено/.test(job.error || ''), job.error);
  const diag = (await send('diagnostics')).data;
  t.ok('диагностика контракта: ключи и enum видны, ID и текст замаскированы', JSON.stringify(diag.contracts['campaign.status'].variants.disable.body) === '{"advertiser_id":"<id>","campaign_ids":["<id>"],"opt_status":2}');
} catch (error) {
  t.crash(error);
} finally {
  t.finish(env);
  await env.close();
}
