// Автопроверка РК с оповещением о новых проблемах, выбор объектов в «Подробнее», разделы настроек и диагностика без секретов.
import { boot, openAds, openUi, shot, sleep, waitFor, click, checks } from './harness.mjs';

const env = await boot();
const t = checks('Автопроверка, выбор объектов, настройки, диагностика');
try {
  const { tabId } = await openAds(env);
  const ui = await openUi(env, tabId);
  const store = (key) => ui.evaluate((k) => chrome.storage.local.get(k).then((v) => v[k]), key);
  const send = (ns, type, extra = {}) => ui.evaluate((n, tp, e) => chrome.runtime.sendMessage({ ns: n, type: tp, ...e }), ns, type, extra);
  await ui.waitForSelector('.account-card', { timeout: 30000 });

  t.ok('автопроверка включается настройкой, таймер создан на 60 минут', (await send('settings', 'patch', { patch: { health: { auto: { enabled: true, intervalMin: 60, notify: false } } } })).ok
    && (await ui.evaluate(async () => (await chrome.alarms.get('tth-health'))?.periodInMinutes)) === 60);

  await click(ui, 'Проверить все');
  await waitFor(async () => (await store('healthJob'))?.state === 'complete', 120000);
  t.ok('первая проверка сохраняет базовую линию без оповещений', Boolean(await store('healthBaseline')));
  const quiet = (await send('journal', 'get')).data.filter((e) => /Новые проблемы/.test(e.msg));
  t.ok('первая проверка не оповещает', quiet.length === 0);

  env.state.a1Debt = true;
  await ui.evaluate(() => chrome.alarms.create('tth-health', { when: Date.now() + 300 }));
  await waitFor(async () => { const id = await store('healthAutoJob'); const job = await store('healthJob'); return id && job?.id === id && job.state === 'complete'; }, 120000);
  await sleep(1500);
  const alerts = (await send('journal', 'get')).data.filter((e) => /Новые проблемы/.test(e.msg)).map((e) => e.msg);
  t.ok('автопроверка по таймеру нашла новый долг у Alpha RK 1', alerts.length === 1 && /Alpha RK 1: долг или сбой оплаты/.test(alerts[0]), alerts);
  await shot(ui, 'auto-health');

  await ui.evaluate((id) => [...document.querySelector(`.account-card[data-id="${id}"]`).querySelectorAll('button')].find((b) => /Подробнее/.test(b.textContent)).click(), env.ACC.A1);
  await ui.waitForSelector('.ex-row', { timeout: 20000 });
  for (const box of await ui.$$('.ex-line .select-box input')) await box.click();
  await sleep(300);
  t.ok('строки кампаний выбираются, появляется панель действий', /Выбрано: 2/.test(await ui.$eval('.ov-selection', (e) => e.innerText)));
  await click(ui, 'Выключить');
  await ui.waitForSelector('.sheet[data-kind="objects"]');
  await sleep(500);
  t.ok('действие без обучения предлагает обучить', /Действие ещё не обучено/.test(await ui.$eval('.sheet-body', (e) => e.innerText)));
  await ui.keyboard.press('Escape');

  await ui.evaluate(() => document.querySelector('#btn-settings').click());
  await ui.waitForSelector('.sheet[data-kind="settings"]');
  const settings = await ui.$eval('.sheet-body', (e) => e.innerText);
  t.ok('в настройках есть разделы проверки РК, массовых действий, подпись Smart+ и диагностика', ['Статус, билл и карта', 'Массовые действия', 'Подпись переключателя Smart+', 'Скачать диагностику'].every((x) => settings.includes(x)));
  await ui.keyboard.press('Escape');

  const diag = await ui.evaluate(async () => {
    const { buildDiagnostics } = await import('./lib/diagnostics.js');
    const settings = (await chrome.runtime.sendMessage({ ns: 'settings', type: 'get' })).data;
    return JSON.stringify(await buildDiagnostics({ settings }));
  });
  t.ok('диагностика не содержит неразмаскированных ID (9+ цифр)', !/\d{9,}/.test(diag), diag.match(/\d{9,}/g)?.slice(0, 3));
  t.ok('диагностика содержит журнал, здоровье и задачи', ['journal', 'health', 'jobs', 'objects', 'settings'].every((k) => k in JSON.parse(diag)));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  t.finish(env);
  await env.close();
}
