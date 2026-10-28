// Обзор: проверка статуса/билла/карты по всем РК через фоновые вкладки, фильтры, выбор, профили конвейера.
import { boot, openAds, openUi, shot, sleep, waitFor, click, checks } from './harness.mjs';

const env = await boot();
const t = checks('Обзор: статус, билл и карта, выбор РК, профили');
try {
  const { tabId } = await openAds(env);
  const ui = await openUi(env, tabId);
  await ui.waitForSelector('.account-card', { timeout: 30000 });
  const card = (name) => ui.evaluate((n) => [...document.querySelectorAll('.account-card')].find((c) => c.querySelector('.item-title')?.textContent.startsWith(n))?.querySelector('.health-box')?.innerText.replace(/\s+/g, ' ') || '', name);

  t.ok('виден список из 5 кабинетов', (await ui.$$('.account-card')).length === 5);
  t.ok('до проверки статус не показан', /не проверены/.test(await ui.$eval('.account-card', (c) => c.innerText)));

  await click(ui, 'Проверить все');
  await waitFor(() => ui.evaluate(() => /Проверено \d+ из \d+/.test(document.querySelector('.health-card .card-sub')?.textContent || '')), 120000);
  await sleep(600);
  await shot(ui, 'overview-health');

  const a1 = await card('Alpha RK 1'), a2 = await card('Alpha RK 2'), a3 = await card('Alpha RK 3'), p1 = await card('Personal'), b1 = await card('Beta');
  t.ok('Alpha RK 1: активен, карта Visa •• 4242, билл 12,30 / 50,00 EUR (25%), списание, баланс, оплачено', /Активен/.test(a1) && /Visa •• 4242/.test(a1) && /Билл: 12,30 \/ 50,00 EUR \(25%\)/.test(a1) && /списание 2026-11-01/.test(a1) && /Баланс: 25,00 EUR/.test(a1) && /Оплачено: 45,50 EUR/.test(a1), a1);
  t.ok('Alpha RK 2: нет карты, ручная оплата', /Нет карты/.test(a2) && /Ручная оплата/.test(a2), a2);
  t.ok('Alpha RK 3: пауза автоплатежа, долг 5,00 EUR, отказ, подтвердить телефон', /Автоплатёж на паузе/.test(a3) && /Долг: 5,00 EUR/.test(a3) && /Отказов: 1/.test(a3) && /Mastercard •• 4444/.test(a3) && /Подтвердить телефон/.test(a3), a3);
  t.ok('личный РК: на проверке, нет карты', /На проверке/.test(p1) && /Нет карты/.test(p1), p1);
  t.ok('РК без прав Finance: бан из таблицы BC, карта «в BC»', /Заблокирован/.test(b1) && /Карта в BC \(нет прав Finance\)/.test(b1), b1);

  const summary = await ui.$eval('.health-card', (e) => e.innerText.replace(/\s+/g, ' '));
  t.ok('сводка: с картой 2, без карты 2, долг 1, бан 1, на проверке 1', ['С картой: 2', 'Без карты: 2', 'Долг/оплата: 1', 'Бан: 1', 'На проверке: 1'].every((x) => summary.includes(x)), summary);

  await click(ui, 'Без карты', '.ov-chips .chip');
  await sleep(300);
  t.ok('фильтр «Без карты» оставляет 2 кабинета', (await ui.$$('.account-card')).length === 2);
  await click(ui, 'Без карты', '.ov-chips .chip');
  await sleep(300);

  const boxes = await ui.$$('.account-card .select-box input');
  await boxes[0].click(); await boxes[1].click();
  await sleep(300);
  const bar = await ui.$eval('.ov-selection', (e) => e.innerText.replace(/\s+/g, ' '));
  t.ok('панель выбора: счётчик и действия', /Выбрано РК: 2/.test(bar) && ['Расшарить в BC', 'Передать', 'Общая карта', 'Проверить', 'Кампании…'].every((x) => bar.includes(x)), bar);
  await shot(ui, 'overview-selection');

  await ui.evaluate(() => document.querySelector('[data-tab="creation"]').click());
  await sleep(400);
  await click(ui, 'Профиль');
  await sleep(150);
  await ui.type('.preset-row input', 'Тест профиль');
  await ui.keyboard.press('Enter');
  await sleep(500);
  t.ok('профиль сохраняется без диалога браузера', /Тест профиль/.test(await ui.$eval('.preset-row', (e) => e.innerText)));
  await click(ui, 'Передать владение', '.seg button');
  await sleep(300);
  t.ok('режим «Передать владение» показывает выбор получателя', /Кому передать/.test(await ui.$eval('.share-box', (e) => e.innerText)));

  await ui.evaluate(() => document.querySelector('[data-tab="overview"]').click());
  await sleep(700);
  t.ok('профиль запускается из «Обзора»', /Тест профиль/.test(await ui.$eval('.quick-create', (e) => e.innerText)));
  t.ok('экспорт и сервисные вызовы не падают: чтение шло через мок ads/business', env.state.calls.some((c) => c.host === 'business.tiktok.com') && env.state.calls.some((c) => /\/i18n\/account\/payment/.test(c.path)));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  t.finish(env);
  await env.close();
}
