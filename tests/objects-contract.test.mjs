import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchEndpoint, sanitizeBody, sanitizeQuery, pickHeaders, substitute, containsId, makeVariant, buildRequest, detectNameSlot, detectBudgetSlot,
  formatBudget, readiness, variantFor, renderName, budgetAfter, maskBody, setAt, splitRisk, collectIds
} from '../TTAds-Hub/background/objects/contract.js';

const URL_BASE = 'https://ads.tiktok.com';
const OBJ = '7700100000000000001', OTHER = '7700100000000000002', ACC1 = '7700000000000001001', ACC2 = '7700000000000001002';
const roles = new Map([[OBJ, 'object'], [ACC1, 'advertiser']]);

test('matchEndpoint: уровни, версии, check не ловится', () => {
  assert.deepEqual(matchEndpoint('/api/v2/i18n/overture/campaign/update_status/'), { id: 'campaign.status', level: 'campaign', kind: 'status' });
  assert.deepEqual(matchEndpoint('/api/v3/i18n/overture/ad/update_status/'), { id: 'adgroup.status', level: 'adgroup', kind: 'status' });
  assert.deepEqual(matchEndpoint('/api/v2/i18n/overture/creative/update_status/'), { id: 'ad.status', level: 'ad', kind: 'status' });
  assert.deepEqual(matchEndpoint('/api/v9/i18n/overture/campaign/batch_update/name/'), { id: 'campaign.name', level: 'campaign', kind: 'name' });
  assert.deepEqual(matchEndpoint('/api/v3/i18n/overture/ad/batch_update/budget/'), { id: 'adgroup.budget', level: 'adgroup', kind: 'budget' });
  assert.equal(matchEndpoint('/api/v3/i18n/overture/campaign/batch_update/name/check/'), null);
  assert.equal(matchEndpoint('/api/v4/i18n/creation/patch/ad/'), null);
});

test('sanitize: секреты вырезаются, risk_info отделяется, query чистится', () => {
  const clean = sanitizeBody({ campaign_ids: [OBJ], msToken: 'x', nested: { csrf_token: 'y', ok: 1 }, long: 'a'.repeat(900) });
  assert.deepEqual(Object.keys(clean), ['campaign_ids', 'nested', 'long']);
  assert.deepEqual(clean.nested, { ok: 1 });
  assert.equal(clean.long.length, 500);
  assert.deepEqual(splitRisk({ a: 1, risk_info: { cookie_enabled: true } }), { body: { a: 1 }, riskInfo: true });
  assert.deepEqual(sanitizeQuery(new URLSearchParams(`aadvid=${ACC1}&req_src=list&msToken=abc&X-Bogus=zzz&_signature=q`)), [['req_src', 'list']]);
  assert.deepEqual(pickHeaders({ 'App-Name': 'camp', 'x-csrftoken': 'secret', 'X-TTAM-Version': '1.2' }), { 'app-name': 'camp', 'x-ttam-version': '1.2' });
});

test('статус: массив ID + enum-значение, другой кабинет, risk_info', () => {
  const off = makeVariant({
    endpoint: matchEndpoint('/api/v2/i18n/overture/campaign/update_status/'), url: `${URL_BASE}/api/v2/i18n/overture/campaign/update_status/?aadvid=${ACC1}&msToken=1`,
    body: { campaign_ids: [OBJ], opt_status: 2, advertiser_id: ACC1, risk_info: { screen_width: 1 } }, headers: { 'app-name': 'x', 'x-csrftoken': 'secret' },
    aadvid: ACC1, objectId: OBJ, label: 'disable'
  });
  assert.equal(off.riskInfo, true);
  assert.equal(off.body.risk_info, undefined);
  const req = buildRequest(off, { aadvid: ACC2, id: OTHER });
  assert.deepEqual(req.body, { campaign_ids: [OTHER], opt_status: 2, advertiser_id: ACC2 });
  assert.deepEqual(req.query, [['aadvid', ACC2]]);
  assert.equal(req.path, '/api/v2/i18n/overture/campaign/update_status/');
  assert.deepEqual(req.headers, { 'app-name': 'x' });
  assert.equal(req.riskInfo, true);
});

test('имя: карта id → объект, запись списком, скаляр', () => {
  const mapBody = { name_map: { [OBJ]: { name: 'Новое имя' } }, advertiser_id: ACC1 };
  const found = detectNameSlot(mapBody, 'Новое имя', roles);
  assert.deepEqual(found.slot.path, ['name_map', { role: 'object' }, 'name']);
  const variant = makeVariant({ endpoint: matchEndpoint('/api/v3/i18n/overture/campaign/batch_update/name/'), url: `${URL_BASE}/api/v3/i18n/overture/campaign/batch_update/name/`, body: mapBody, aadvid: ACC1, objectId: OBJ, slot: found.slot });
  assert.deepEqual(buildRequest(variant, { aadvid: ACC2, id: OTHER, value: 'Other' }).body, { name_map: { [OTHER]: { name: 'Other' } }, advertiser_id: ACC2 });

  const listBody = { items: [{ campaign_id: OBJ, name: 'Имя' }] };
  const listSlot = detectNameSlot(listBody, 'Имя', roles).slot;
  const listVariant = makeVariant({ endpoint: matchEndpoint('/api/v3/i18n/overture/campaign/batch_update/name/'), url: `${URL_BASE}/x`, body: listBody, aadvid: ACC1, objectId: OBJ, slot: listSlot });
  assert.deepEqual(buildRequest(listVariant, { aadvid: ACC1, id: OTHER, value: 'N2' }).body, { items: [{ campaign_id: OTHER, name: 'N2' }] });

  const scalar = { campaign_id: OBJ, name: 'Имя' };
  assert.deepEqual(detectNameSlot(scalar, 'Имя', roles).slot.path, ['name']);
  assert.equal(detectNameSlot({ a: 'Имя', b: 'Имя' }, 'Имя', roles).error, 'ambiguous');
  assert.deepEqual(detectNameSlot({ new_name: 'Имя', other: 'Имя' }, 'Имя', roles).slot.path, ['new_name']);
  assert.equal(detectNameSlot({ a: 1 }, 'Имя', roles).error, 'not-found');
});

test('бюджет: масштаб определяется по паре отправлено/увидено', () => {
  const cents = detectBudgetSlot({ budget_map: { [OBJ]: 5500 } }, 55, roles);
  assert.equal(cents.slot.scale, 100);
  assert.equal(cents.slot.type, 'number');
  const variant = makeVariant({ endpoint: matchEndpoint('/api/v3/i18n/overture/campaign/batch_update/budget/'), url: `${URL_BASE}/x`, body: { budget_map: { [OBJ]: 5500 } }, aadvid: ACC1, objectId: OBJ, slot: cents.slot });
  assert.deepEqual(buildRequest(variant, { aadvid: ACC1, id: OTHER, value: 12.5 }).body, { budget_map: { [OTHER]: 1250 } });

  const plain = detectBudgetSlot({ campaign_id: OBJ, budget: '55.50' }, 55.5, roles);
  assert.deepEqual([plain.slot.scale, plain.slot.type], [1, 'string']);
  assert.equal(formatBudget(60, plain.slot), '60');
  assert.equal(formatBudget(12.345, { scale: 1, type: 'number' }), 12.35);
  assert.equal(detectBudgetSlot({ budget: 55, daily_budget: 55 }, 55, roles).error, 'ambiguous');
  assert.equal(detectBudgetSlot({ budget: 55, count: 55 }, 55, roles).slot.path[0], 'budget');
  assert.equal(detectBudgetSlot({ x: 1 }, 55, roles).error, 'not-found');
  assert.equal(detectBudgetSlot({ x: 1 }, -1, roles).error, 'bad-value');
});

test('числовые ID в теле не находятся — контракт не принимается', () => {
  assert.equal(containsId({ campaign_ids: [7700100000000000001] }, OBJ), false);
  assert.equal(containsId({ name_map: { [OBJ]: 'a' } }, OBJ), true);
  assert.deepEqual(substitute({ [OBJ]: [OBJ, 'x'], n: 5 }, new Map([[OBJ, OTHER]])), { [OTHER]: [OTHER, 'x'], n: 5 });
  assert.equal(setAt({ a: 1 }, ['b'], 2), false);
  assert.deepEqual([...collectIds({ ids: [OBJ, OTHER], map: { [ACC1]: 1 }, n: 'x', short: '123' })].sort(), [ACC1, OBJ, OTHER].sort());
});

test('readiness / variantFor', () => {
  const store = {
    'campaign.status': { variants: { disable: { x: 1 } } }, 'campaign.name': { variants: { set: { y: 1 } } }, 'adgroup.status': { variants: { enable: {}, disable: {} } }
  };
  const r = readiness(store);
  assert.deepEqual(r.campaign, { enable: false, disable: true, name: true, budget: false });
  assert.deepEqual(r.adgroup, { enable: true, disable: true, name: false, budget: false });
  assert.deepEqual(variantFor(store, 'campaign', 'disable'), { x: 1 });
  assert.equal(variantFor(store, 'campaign', 'enable'), null);
  assert.deepEqual(variantFor(store, 'campaign', 'rename'), { y: 1 });
});

test('значения действий', () => {
  assert.equal(renderName('{name} — копия {n}', { name: 'Кампания', n: 3 }), 'Кампания — копия 3');
  assert.equal(renderName('A {date}', { now: new Date(2026, 9, 5) }), 'A 1005');
  assert.equal(budgetAfter(50, { mode: 'multiply', value: 1.2 }), 60);
  assert.equal(budgetAfter(50, { mode: 'set', value: '75.555' }), 75.56);
  assert.equal(budgetAfter(0, { mode: 'multiply', value: 2 }), null);
  assert.equal(budgetAfter(10, { mode: 'set', value: 0 }), null);
});

test('maskBody скрывает ID и текст, но оставляет enum-значения', () => {
  const masked = maskBody({ campaign_ids: [OBJ], opt_status: 2, status: 'DISABLE', name: 'Моя кампания для клиента', map: { [OBJ]: { v: 1500000 } } });
  assert.deepEqual(masked, { campaign_ids: ['<id>'], opt_status: 2, status: 'DISABLE', name: '<str>', map: { '<id>': { v: '<num>' } } });
});
