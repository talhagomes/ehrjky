// DOM-контракты Manual (legacy и unified редакторы TikTok) в настоящем Chrome: страницы подменяются локальным HTML.
// Запуск: npm run test:dom (нужен Chrome; путь — переменная CHROME, если он не стандартный).
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../../scripts/lib/chrome.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'TTAds-Hub');
const { selectedGoal, manualView, inspectCreationModal } = await import(pathToFileURL(path.join(root, 'background', 'manual', 'probes.js')).href);

const ACCOUNT = '7000000000000000001', DRAFT = '8000000000000000001';
const ctx = (extra = {}) => ({ account: ACCOUNT, draft: DRAFT, ...extra });
const failures = [];
const check = (value, label, details = value) => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${label}`);
  if (!value) failures.push(`${label}: ${JSON.stringify(details)}`);
};

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let html = '';
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (request) => request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
const STYLE = '<style>[role=switch]{display:inline-block;width:30px;height:16px}button{min-width:40px;min-height:20px}</style>';
const FLIP = '<script>for (const el of document.querySelectorAll("[role=switch]")) el.onclick = () => { el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true")); (window.__clicks ||= []).push(el.id); };</script>';
const open = async (body, query = `aadvid=${ACCOUNT}&campaign_draft_id=${DRAFT}`) => {
  html = `<!doctype html>${STYLE}${body}`;
  await page.goto(`https://ads.tiktok.com/i18n/creation/1nn/create/campaign?${query}`, { waitUntil: 'domcontentloaded' });
};
const view = (click, extra) => page.evaluate(manualView, ctx(extra), click);
const clicks = () => page.evaluate(() => window.__clicks || []);
const state = (id) => page.evaluate((x) => document.getElementById(x).getAttribute('aria-checked'), id);
const objective = (name) => `<div class="campaign-objective"><label role="radio" aria-checked="true" data-testid="new-objective-selection-test">${name}</label></div>`;

try {
  /* ---------- unified: цель и Smart+ (проверки из аудита 1.6.0) ---------- */
  await open(`${objective('Sales')}<section><div><span>Power your campaign with Smart+</span><div id="smart" role="switch"><input type="checkbox"></div></div></section>`);
  check(await page.evaluate(selectedGoal) === 'sales', 'unified objective is detected');
  let result = await view(false);
  check(result.manual && result.shown && result.mode === 'unified' && result.smartPlus === false, 'Smart+ OFF is Manual', result);

  await open(`${objective('Lead generation')}<section><div><span>Power your campaign with Smart+</span><div id="smart" role="switch" class="is-checked"><input type="checkbox" checked><span class="vi-switch__core"></span></div></div></section>
    <script>document.querySelector('.vi-switch__core').onclick=()=>{const s=document.querySelector('#smart'),i=s.querySelector('input');i.checked=false;s.classList.remove('is-checked')}</script>`);
  check(await page.evaluate(selectedGoal) === 'lead', 'Lead generation is detected');
  result = await view(false);
  check(!result.manual && result.smartPlus === true, 'Smart+ ON is not Manual', result);
  result = await view(true);
  check(result.manual && result.shown && result.clicked, 'click turns Smart+ off', result);

  await open(`${objective('App promotion')}<button id="continue">Continue</button><script>document.querySelector('#continue').onclick=()=>window.__continued=true</script>`, `aadvid=${ACCOUNT}`);
  const creation = await page.evaluate(inspectCreationModal, ACCOUNT, false, null);
  check(creation.eligible && creation.objective === 'app' && creation.mode === 'unified', 'unified creation page is eligible', creation);
  const clicked = await page.evaluate(inspectCreationModal, ACCOUNT, true, 'app');
  check(clicked.clicked && await page.evaluate(() => window.__continued === true), 'unified Continue is clicked', clicked);
  check((await page.evaluate(inspectCreationModal, ACCOUNT, true, 'sales')).error === 'Цель изменилась. Откройте панель заново.', 'changed objective is rejected');

  await open(`${objective('Sales')}<button>Continue</button><button>Continue</button>`, `aadvid=${ACCOUNT}`);
  check((await page.evaluate(inspectCreationModal, ACCOUNT, true, null)).eligible === false, 'ambiguous Continue is not clicked');

  /* ---------- переключатель выбирается по ближайшей подписи ---------- */
  await open(`${objective('Sales')}<section><div class="row"><span>Budget optimization</span><div id="budget" role="switch" aria-checked="true"></div></div>
    <div class="row"><span>Power your campaign with Smart+</span><div id="smart" role="switch" aria-checked="true"></div></div></section>${FLIP}`);
  result = await view(true);
  check(result.manual && await state('smart') === 'false' && await state('budget') === 'true' && (await clicks()).join() === 'smart', 'only the Smart+ switch is toggled when another switch shares the container', { result, clicks: await clicks() });

  await open(`${objective('Sales')}<section><div id="other"><div id="n1" role="switch" aria-checked="true"></div></div><div><span>Power your campaign with Smart+</span><div id="smart" role="switch" aria-checked="false"></div></div></section>${FLIP}`);
  result = await view(false);
  check(result.manual && result.smartPlus === false && (await clicks()).length === 0, 'state is read from the nearest labelled switch, nothing is clicked', result);

  /* ---------- switch без input: aria-checked ---------- */
  await open(`${objective('Sales')}<div><span>Power your campaign with Smart+</span><button id="smart" role="switch" aria-checked="true"></button></div>${FLIP}`);
  result = await view(true);
  check(result.manual && result.clicked && await state('smart') === 'false', 'aria-checked switch without input is turned off', result);

  /* ---------- локализация: подпись задаётся в настройках ---------- */
  const RU = 'Управляйте кампанией с помощью Smart+';
  await open(`${objective('Sales')}<div><span>${RU}</span><div id="smart" role="switch" aria-checked="true"></div></div>${FLIP}`);
  result = await view(false);
  check(!result.manual && result.smartPlus !== true && (await clicks()).length === 0 && result.mode === 'legacy', 'unknown language: nothing is detected and nothing is clicked', result);
  result = await view(false, { labels: [RU] });
  check(!result.manual && result.smartPlus === true && result.mode === 'unified', 'custom label finds the switch', result);
  result = await view(true, { labels: [RU] });
  check(result.manual && await state('smart') === 'false', 'custom label: switch is turned off', result);

  /* ---------- нет переключателя: ничего не трогаем ---------- */
  await open(`${objective('Sales')}<div><span>Budget optimization</span><div id="budget" role="switch" aria-checked="true"></div></div>${FLIP}`);
  result = await view(false);
  check(!result.manual && (await clicks()).length === 0 && await state('budget') === 'true', 'page without Smart+ switch is left untouched', result);

  /* ---------- legacy редактор ---------- */
  await open('<div class="cs-campaign-option" data-cs-selected="true" data-cs-name="Lead_Generation"><div class="cs-campaign-option__title"><span class="truncate">Lead Generation</span></div></div>');
  check(await page.evaluate(selectedGoal) === 'lead', 'legacy objective is detected');
  await open('<div data-cs-name="Sales_Manual" data-cs-selected="true"><div class="cs-campaign-option__title"><span class="truncate">Manual campaign</span></div></div>');
  result = await view(false);
  check(result.manual && result.shown && result.mode === 'legacy', 'legacy Manual card is detected', result);

  await open(`<div data-testid="campaign-selector-1"><div class="cs-campaign-option" data-cs-selected="true" data-cs-name="Sales"><div class="cs-campaign-option__title"><span class="truncate">Sales</span></div><div id="host"></div></div></div>
    <script>const root=document.querySelector('#host').attachShadow({mode:'open'});const b=document.createElement('button');b.setAttribute('part','confirmButton');b.textContent='Confirm';b.style.minWidth='40px';b.style.minHeight='20px';b.onclick=()=>window.__confirmed=true;root.append(b)</script>`, `aadvid=${ACCOUNT}`);
  result = await page.evaluate(inspectCreationModal, ACCOUNT, true, 'sales');
  check(result.eligible && result.clicked && result.objective === 'sales' && !result.mode && await page.evaluate(() => window.__confirmed === true), 'legacy Shadow DOM Confirm is clicked', result);
} finally { await browser.close(); }

if (failures.length) {
  console.error(`MANUAL PROBES FAILED (${failures.length})\n${failures.join('\n')}`);
  process.exitCode = 1;
} else console.log('MANUAL PROBES PASSED');
