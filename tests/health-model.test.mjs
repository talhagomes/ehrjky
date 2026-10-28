import test from 'node:test';
import assert from 'node:assert/strict';
import { healthOf, countFlags, flagMap, newProblems, alertText, HEALTH_COLUMNS } from '../TTAds-Hub/background/health/model.js';
import { parseBillingPage } from '../TTAds-Hub/background/health/parse.js';

const adsEntry = (text, extra = {}) => ({ id: '1', at: Date.now(), ads: { at: Date.now(), ok: true, ...parseBillingPage({ text }) }, ...extra });

test('healthOf: карта, билл, долг и флаги', () => {
  const entry = adsEntry('Payment Portfolio Advanced Auction Automatic payment Automatic payment paused Amount due 5.00 EUR Available cash balance 1.50 EUR Payment threshold 12.30 / 50.00 EUR Payment methods Visa **** **** **** 4242 EUR Expiry date 01/30 Primary');
  const h = healthOf({ id: '1', spend: 7.5, currency: 'EUR' }, entry);
  assert.equal(h.card.linked, true);
  assert.equal(h.card.label, 'Visa •• 4242');
  assert.equal(h.billing.mode, 'auto');
  assert.deepEqual(h.billing.threshold, { used: 12.3, limit: 50, currency: 'EUR', pct: 25 });
  assert.equal(h.billing.amountDue.value, 5);
  assert.equal(h.billing.balance.value, 1.5);
  assert.deepEqual(h.flags, ['debt']);
  assert.equal(h.spend, 7.5);
  assert.equal(h.checked, true);
  assert.equal(h.stale, false);
});

test('healthOf: нет карты / нет прав Finance / бан по таблице BC', () => {
  assert.deepEqual(healthOf({ id: '1' }, adsEntry('Payment methods No payment method added Add a payment method')).flags, ['no-card']);
  const noRights = healthOf({ id: '1' }, adsEntry('Finance access required'));
  assert.equal(noRights.card.linked, null);
  assert.deepEqual(noRights.flags, []);
  const banned = healthOf({ id: '1' }, { id: '1', at: Date.now(), bc: { at: Date.now(), status: { kind: 'suspended', label: 'Заблокирован', text: 'Disabled' } } });
  assert.deepEqual(banned.flags, ['suspended']);
  assert.equal(banned.status.source, 'bc');
  assert.equal(healthOf({ id: '1' }, null).checked, false);
});

test('healthOf: данные официального API приоритетнее разбора текста', () => {
  const h = healthOf({ id: '1', currency: 'EUR' }, adsEntry('Payment methods Add a payment method'), { status: 'STATUS_LIMIT', balance: 12, currency: 'EUR', at: Date.now() });
  assert.equal(h.status.kind, 'suspended');
  assert.equal(h.status.source, 'api');
  assert.equal(h.billing.balance.value, 12);
});

test('countFlags и колонки CSV', () => {
  const list = [
    healthOf({ id: '1' }, adsEntry('Payment methods No payment method added Add a payment method')),
    healthOf({ id: '2' }, adsEntry('Payment methods Visa **** **** **** 1111 EUR Expiry date 01/30')),
    healthOf({ id: '3' }, null)
  ];
  assert.deepEqual(countFlags(list), { checked: 2, 'no-card': 1, debt: 0, suspended: 0, review: 0, rejected: 0, cards: 1 });
  assert.equal(HEALTH_COLUMNS.find((c) => c.title === 'Карта').get({ health: list[1] }), 'Visa •• 1111');
});

test('flagMap / newProblems / alertText: оповещаем только о новых проблемах проверенных кабинетов', () => {
  const accounts = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }, { id: '3', name: 'Gamma' }];
  const ok = adsEntry('Payment methods Visa **** **** **** 1111 EUR Expiry date 01/30');
  const debt = adsEntry('Amount due 3.00 EUR Payment methods Visa **** **** **** 1111 EUR Expiry date 01/30');
  const before = flagMap(accounts, { 1: ok, 2: ok });
  const after = flagMap(accounts, { 1: debt, 2: ok, 3: debt });
  assert.deepEqual(before, { 1: [], 2: [] });
  assert.deepEqual(newProblems(before, after), [{ id: '1', added: ['debt'] }]);
  assert.deepEqual(newProblems(after, after), []);
  assert.equal(alertText([{ id: '1', added: ['debt', 'suspended'] }], { 1: 'Alpha' }), 'Alpha: долг или сбой оплаты, бан');
  assert.match(alertText(Array.from({ length: 6 }, (_, i) => ({ id: String(100000 + i), added: ['no-card'] }))), /и ещё 2$/);
});
