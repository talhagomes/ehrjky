import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, describeError, isSuccess, ERROR_KINDS } from '../TTAds-Hub/background/lib/errors.js';

const kindOf = (input) => classifyError(input).kind;

test('classifyError: HTTP-статусы', () => {
  assert.equal(kindOf({ http: 401 }), 'auth');
  assert.equal(kindOf({ http: 403 }), 'permission');
  assert.equal(kindOf({ http: 429 }), 'rate');
  assert.equal(kindOf({ http: 404 }), 'schema');
  assert.equal(kindOf({ http: 405 }), 'schema');
  assert.equal(kindOf({ http: 400 }), 'validation');
  assert.equal(kindOf({ http: 502 }), 'server');
  assert.equal(kindOf({ http: 200, code: 0 }), 'unknown');
});

test('classifyError: коды TikTok Marketing API', () => {
  for (const code of [40104, 40105, 40102, 40106]) assert.equal(kindOf({ http: 200, code }), 'auth', String(code));
  for (const code of [40100, 40016, 40133]) assert.equal(kindOf({ http: 200, code }), 'rate', String(code));
  assert.equal(kindOf({ http: 200, code: 40001 }), 'permission');
  assert.equal(kindOf({ http: 200, code: 40002 }), 'validation');
  assert.equal(kindOf({ http: 200, code: 50000 }), 'server');
  assert.equal(kindOf({ http: 200, code: 51004 }), 'server');
  assert.equal(kindOf({ http: 200, code: 60001 }), 'server');
});

test('classifyError: тексты внутреннего API и сбои сети', () => {
  assert.equal(kindOf({ msg: 'Too many requests, please try again later' }), 'rate');
  assert.equal(kindOf({ msg: 'Operation too frequent' }), 'rate');
  assert.equal(kindOf({ msg: 'Please log in to continue' }), 'auth');
  assert.equal(kindOf({ msg: 'You do not have permission to operate this advertiser' }), 'permission');
  assert.equal(kindOf({ msg: 'Security verification required' }), 'verification');
  assert.equal(kindOf({ msg: 'invalid param: budget' }), 'validation');
  assert.equal(kindOf({ error: 'The operation was aborted due to timeout' }), 'network');
  assert.equal(kindOf({ error: 'Failed to fetch' }), 'network');
  assert.equal(kindOf({ lost: true }), 'network');
  assert.equal(kindOf({ timeout: true }), 'network');
  assert.equal(kindOf({ error: 'Вкладка TikTok была закрыта.' }), 'network');
});

test('classifyError: баланс не путается с правами, а DOM — с остальным', () => {
  assert.equal(kindOf({ msg: 'Insufficient account balance' }), 'unknown');
  assert.equal(kindOf({ step: 'select', error: 'Кнопка не найдена' }), 'dom');
  assert.equal(kindOf({ error: 'Элемент не найден: selector' }), 'dom');
  assert.equal(kindOf({}), 'unknown');
  assert.equal(kindOf(undefined), 'unknown');
});

test('classifyError: повторяемость и признак смены контракта', () => {
  const retryable = Object.entries(ERROR_KINDS).filter(([, v]) => v.retryable).map(([k]) => k).sort();
  assert.deepEqual(retryable, ['network', 'rate', 'server']);
  assert.equal(classifyError({ http: 404 }).invalidatesContract, true);
  assert.equal(classifyError({ http: 400 }).invalidatesContract, false);
  assert.equal(classifyError({ http: 429 }).retryable, true);
  assert.equal(classifyError({ http: 401 }).retryable, false);
});

test('describeError и isSuccess', () => {
  assert.match(describeError({ http: 429, msg: 'slow down' }), /^Лимит запросов: slow down\. TikTok ограничивает/);
  assert.equal(describeError({}), 'Ошибка');
  assert.equal(isSuccess({ http: 200, code: 0 }), true);
  assert.equal(isSuccess({ http: 200, code: 40002 }), false);
  assert.equal(isSuccess({ http: 500, code: 0 }), false);
  assert.equal(isSuccess({ error: 'x', http: 200, code: 0 }), false);
  assert.equal(isSuccess(null), false);
});
