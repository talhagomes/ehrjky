// Обучение контрактов: краевые случаи тела запроса (ID числами, кириллица) и обычный путь.
import { boot, openAds, openUi, sleep, waitFor, checks } from './harness.mjs';
import { installMutations, state } from './mock-tiktok.mjs';

const env = await boot();
const t = checks('Обучение контрактов: большие числа, кириллица, обычный путь');
try {
  installMutations();
  const { page: ads, tabId } = await openAds(env);
  const ui = await openUi(env, tabId);
  const { A1 } = env.ACC;
  const C2 = '7700100000000000002';
  const store = (key) => ui.evaluate((k) => chrome.storage.local.get(k).then((v) => v[k]), key);
  const send = (type, input) => ui.evaluate((tp, i) => chrome.runtime.sendMessage({ ns: 'objects', type: tp, input: i }), type, input);
  const native = (path, bodyText) => ads.evaluate(async (p, b) => (await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json;charset=UTF-8', 'x-csrftoken': 'tok' }, body: b })).status, path, bodyText);
  await ui.waitForSelector('.account-card', { timeout: 30000 });

  await send('learnStart', { account: A1, level: 'campaign', kind: 'status', objectId: C2, tabId });
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, `{"campaign_ids":[${C2}],"opt_status":2}`);
  await waitFor(async () => /числами без кавычек/.test((await store('objectsLearn'))?.message || ''));
  t.ok('ID числами без кавычек: запрос не принимается (JavaScript округлил бы число)', (await store('objectsLearn')).state === 'waiting' && !(await store('objectContracts')));
  await send('learnStop');

  await send('learnStart', { account: A1, level: 'campaign', kind: 'name', objectId: C2, tabId });
  const name = 'Новая кампания № 7 — тест';
  await native(`/api/v3/i18n/overture/campaign/batch_update/name/?aadvid=${A1}`, JSON.stringify({ name_map: { [C2]: name } }));
  await waitFor(async () => (await store('objectsLearn'))?.state === 'done');
  const slot = (await store('objectContracts'))['campaign.name'].variants.set.slot;
  t.ok('имя с кириллицей и символами «№ —» распознано целиком', JSON.stringify(slot.path) === '["name_map",{"role":"object"}]' && state.campaigns[A1].find((c) => c.campaign_id === C2).campaign_name === name);

  await send('learnStart', { account: A1, level: 'campaign', kind: 'status', objectId: C2, tabId });
  await native(`/api/v2/i18n/overture/campaign/update_status/?aadvid=${A1}`, JSON.stringify({ campaign_ids: [C2], opt_status: 2 }));
  await waitFor(async () => (await store('objectsLearn'))?.learned?.includes('disable'));
  t.ok('обычный путь: после первого действия просит вернуть переключатель', /верните переключатель/.test((await store('objectsLearn')).message));
} catch (error) {
  t.crash(error);
} finally {
  t.finish(env);
  await env.close();
}
