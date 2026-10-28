import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, normalizeAutomation, normalizePresets } from '../TTAds-Hub/background/lib/storage.js';
import { normalizeGroups } from '../TTAds-Hub/background/access/engine.js';
import { renderName } from '../TTAds-Hub/background/pipeline/engine.js';

test('автоматизация: transfer и шаринг взаимоисключающие, ID проверяются', () => {
  const both = normalizeAutomation({ share: { enabled: true, targets: ['7700000000000000001'] }, transfer: { enabled: true, targetBusinessCenterId: '7700000000000000002' } });
  assert.equal(both.share.enabled, true);
  assert.equal(both.transfer.enabled, false);
  const only = normalizeAutomation({ transfer: { enabled: true, targetBusinessCenterId: '7700000000000000002' } });
  assert.deepEqual(only.transfer, { enabled: true, targetBusinessCenterId: '7700000000000000002' });
  assert.equal(normalizeAutomation({ transfer: { enabled: true, targetBusinessCenterId: 'abc' } }).transfer.targetBusinessCenterId, '');
  assert.equal(normalizeAutomation({ count: 99 }).count, 20);
});

test('профили: чистятся, не вкладываются друг в друга, не больше 12', () => {
  const presets = normalizePresets([
    { id: 'a b!', name: '  Тест   профиль ', config: { count: 5, linkPortfolio: true, presets: [{ id: 'x', name: 'x' }], partners: [{ id: '7700000000000000001' }] } },
    { id: '', name: 'без id' }, { id: 'dup', name: 'one' }, { id: 'dup', name: 'two' },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))
  ]);
  assert.equal(presets[0].id, 'ab');
  assert.equal(presets[0].name, 'Тест профиль');
  assert.equal(presets[0].config.count, 5);
  assert.equal(presets[0].config.linkPortfolio, true);
  assert.equal('presets' in presets[0].config, false);
  assert.equal('partners' in presets[0].config, false);
  assert.equal(presets.length, 12);
  assert.equal(presets.filter((p) => p.id === 'dup').length, 1);
});

test('настройки: фильтры здоровья, автопроверка, значения по умолчанию', () => {
  const s = normalizeSettings({ overview: { filter: 'no-card' }, health: { concurrency: 9, auto: { enabled: true, intervalMin: 100, notify: true } } });
  assert.equal(s.overview.filter, 'no-card');
  assert.equal(s.health.concurrency, 3);
  assert.deepEqual(s.health.auto, { enabled: true, intervalMin: 60, notify: true });
  assert.equal(normalizeSettings({ overview: { filter: 'bogus' } }).overview.filter, 'all');
  assert.deepEqual(normalizeSettings({}).health, { concurrency: 2, includeBc: true, auto: { enabled: false, intervalMin: 60, notify: false } });
});

test('пакетные операции: группы по BC, лимит запроса, дубли и мусор', () => {
  const bc1 = '7700000000000000001', bc2 = '7700000000000000002';
  const ids = (n, from = 7700000000001000) => Array.from({ length: n }, (_, i) => String(from + i));
  const groups = normalizeGroups([
    { sourceBusinessCenterId: bc1, accountIds: ids(35) }, { sourceBusinessCenterId: bc2, accountIds: ['7700000000002000', 'oops'] },
    { sourceBusinessCenterId: bc1, accountIds: ids(5, 7700000000001100) }, { sourceBusinessCenterId: 'bad', accountIds: ids(2) }
  ], 30);
  assert.deepEqual(groups.map((g) => [g.sourceBusinessCenterId, g.accountIds.length]), [[bc1, 30], [bc1, 10], [bc2, 1]]);
  const merged = normalizeGroups([{ sourceBusinessCenterId: bc1, accountIds: ids(35) }, { sourceBusinessCenterId: bc1, accountIds: ids(5, 7700000000001030) }], 30);
  assert.deepEqual(merged.map((g) => g.accountIds.length), [30, 5]);
  assert.deepEqual(normalizeGroups([], 30), []);
});

test('имена конвейера: подстановки', () => {
  assert.equal(renderName('RK {date}-{rand}-{n}', { n: 3, rand: 'ABCD', now: new Date(2026, 9, 28, 9, 5) }), 'RK 1028-ABCD-3');
  assert.equal(renderName('{time}', { now: new Date(2026, 9, 28, 9, 5) }), '0905');
});

test('предупреждение о 2027: до даты считает дни, после — предупреждает', async () => {
  const { sunsetNotice, MANUAL_API_SUNSET } = await import('../TTAds-Hub/background/lib/sunset.js');
  assert.equal(MANUAL_API_SUNSET, Date.UTC(2027, 0, 1));
  const before = sunsetNotice(Date.UTC(2026, 9, 28));
  assert.equal(before.kind, 'info');
  assert.equal(before.days, 65);
  assert.match(before.text, /через 65 дн\./);
  assert.match(before.text, /Sales, App Promotion и Lead Generation/);
  const after = sunsetNotice(Date.UTC(2027, 0, 2));
  assert.equal(after.kind, 'warn');
  assert.equal(after.days, 0);
  assert.doesNotMatch(after.text, /через \d+ дн/);
  assert.equal(sunsetNotice(Date.UTC(2027, 0, 1) - 1).days, 1);
});

test('подпись переключателя Smart+: значение по умолчанию, чистка и ограничения', () => {
  const d = normalizeSettings({});
  assert.deepEqual(d.manual.smartLabels, ['Power your campaign with Smart+']);
  const custom = normalizeSettings({ manual: { smartLabels: ['  Управляйте кампанией с помощью Smart+  ', '', 'x'.repeat(300)] } });
  assert.equal(custom.manual.smartLabels[0], 'Управляйте кампанией с помощью Smart+');
  assert.equal(custom.manual.smartLabels.length, 2);
  assert.equal(custom.manual.smartLabels[1].length, 120);
  assert.deepEqual(normalizeSettings({ manual: { smartLabels: [] } }).manual.smartLabels, ['Power your campaign with Smart+']);
});
