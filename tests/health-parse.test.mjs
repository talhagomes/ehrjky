import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, firstMoney, classifyAccountStatus, parseCards, parseBillingPage, parseBcRows, parseTransactions } from '../TTAds-Hub/background/health/parse.js';

test('parseMoney понимает разные форматы', () => {
  assert.equal(parseMoney('1,234.56'), 1234.56);
  assert.equal(parseMoney('1 234,56'), 1234.56);
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('0.00'), 0);
  assert.equal(parseMoney('12,5'), 12.5);
  assert.equal(parseMoney('1,234'), 1234);
  assert.equal(parseMoney('0,123'), 0.123);
  assert.equal(parseMoney('-5.00'), -5);
  assert.equal(parseMoney('abc'), null);
});

test('firstMoney не склеивает год и сумму', () => {
  assert.deepEqual(firstMoney('Billing date 2026 5.00 EUR'), { amount: '5.00', currency: 'EUR', value: 5 });
  assert.deepEqual(firstMoney('USD 12.40 total'), { amount: '12.40', currency: 'USD', value: 12.4 });
  assert.equal(firstMoney('(UTC+01:00) Madrid'), null);
});

test('classifyAccountStatus: порядок правил', () => {
  assert.equal(classifyAccountStatus('Approved').kind, 'active');
  assert.equal(classifyAccountStatus('Not approved').kind, 'rejected');
  assert.equal(classifyAccountStatus('In review').kind, 'review');
  assert.equal(classifyAccountStatus('Disabled').kind, 'suspended');
  assert.equal(classifyAccountStatus('STATUS_LIMIT').kind, 'suspended');
  assert.equal(classifyAccountStatus('STATUS_ENABLE').kind, 'active');
  assert.equal(classifyAccountStatus('').kind, 'unknown');
});

test('parseCards: маска, бренд, срок, валюта', () => {
  const cards = parseCards('Payment methods Visa **** **** **** 4242 EUR Expiry date 01/30 Primary Add a payment method');
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], { last4: '4242', brand: 'Visa', currency: 'EUR', expiry: '01/30', primary: true });
  assert.equal(parseCards('Mastercard ending in 4421').at(0).brand, 'Mastercard');
  assert.equal(parseCards('Нет способов оплаты').length, 0);
});

test('parseBillingPage: автоплатёж, долг, портфель, карта', () => {
  const page = {
    text: 'Payment Portfolio Advanced ID: 7700000000000009999 Available cash balance 0.00 EUR Billing option For auction ads: Automatic payment Automatic payment paused Amount due 5.00 EUR Payment methods Visa **** **** **** 4242 EUR Expiry date 01/30 Verify your phone number for security.',
    cardText: '', rows: ['2026-10-20 Automatic payment 5.00 EUR Failed', '2026-10-01 Automatic payment 2.50 EUR Successful', '2026-09-01 Refund 1.00 EUR Successful']
  };
  const r = parseBillingPage(page);
  assert.equal(r.portfolio, 'Payment Portfolio Advanced');
  assert.equal(r.portfolioId, '7700000000000009999');
  assert.equal(r.billingMode, 'auto');
  assert.equal(r.autopayPaused, true);
  assert.equal(r.amountDue.value, 5);
  assert.equal(r.cashBalance.value, 0);
  assert.equal(r.cardLinked, true);
  assert.equal(r.paymentMethods[0].last4, '4242');
  assert.equal(r.verifyPhone, true);
  assert.deepEqual(r.transactions.paid, { value: 2.5, currency: 'EUR' });
  assert.equal(r.transactions.failedCount, 1);
});

test('parseBillingPage: нет карты и нет прав Finance', () => {
  assert.equal(parseBillingPage({ text: 'Payment methods No payment method Add a payment method Manual payment' }).cardLinked, false);
  assert.equal(parseBillingPage({ text: 'Payment methods No payment method Add a payment method Manual payment' }).billingMode, 'manual');
  assert.equal(parseBillingPage({ text: 'Finance access required Ask your admin' }).cardLinked, null);
  assert.equal(parseBillingPage({ text: 'Your ad account has been suspended due to policy violation.' }).banner.kind, 'suspended');
});

test('parseBillingPage: порог «x / y CUR»', () => {
  const r = parseBillingPage({ text: 'Payment threshold 12.30 / 50.00 USD Next billing date 2026-11-01' });
  assert.deepEqual(r.threshold.limit, { amount: '50.00', currency: 'USD', value: 50 });
  assert.equal(r.threshold.used.value, 12.3);
  assert.equal(r.billingDate, '2026-11-01');
});

test('parseBcRows: колонки по заголовкам и запасной разбор текста', () => {
  const rows = parseBcRows({
    headers: ['', 'Account', 'Account status', 'Balance', 'Threshold'],
    rows: [
      { text: 'TTAds Hub RK DOM Test ID: 7700000000000004001 Approved 0.00 EUR 0.00 / 5.00 EUR Billing date: 2026-11-01', cells: ['', 'TTAds Hub RK DOM Test ID: 7700000000000004001', 'Approved', '0.00 EUR', '0.00 / 5.00 EUR Billing date: 2026-11-01'] },
      { text: 'Second ID: 7701457656585830499 In review', cells: [] }
    ]
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'TTAds Hub RK DOM Test');
  assert.equal(rows[0].status.kind, 'active');
  assert.equal(rows[0].threshold.limit.value, 5);
  assert.equal(rows[0].billingDate, '2026-11-01');
  assert.equal(rows[0].balance.value, 0);
  assert.equal(rows[1].status.kind, 'review');
});

test('parseTransactions: пусто без статусов', () => {
  assert.equal(parseTransactions(['Campaign 1 5.00 EUR']), null);
});
