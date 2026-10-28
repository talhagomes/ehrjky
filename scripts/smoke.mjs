// Дымовая проверка в настоящем Chrome: загрузка расширения, запуск service worker, отрисовка всех разделов интерфейса.
// Запуск: npm run smoke [папка расширения] [папка для скриншотов]. Путь к Chrome — переменная CHROME, если он не стандартный.
// Chrome 137+ (не Chromium/Chrome for Testing) не принимает --load-extension, поэтому расширение подключается через enableExtensions.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(process.argv[2] || path.join(here, '..', 'TTAds-Hub'));
const OUT = path.resolve(process.argv[3] || path.join(here, '..', 'test-output', 'smoke'));
const EXPECTED_TABS = ['creation', 'access', 'overview', 'links', 'billing', 'manual', 'appeals', 'pixel', 's2s'];
const version = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true, enableExtensions: [EXT], pipe: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=480,820']
});
try {
  const swTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().includes('service-worker.js'), { timeout: 20000 });
  const id = new URL(swTarget.url()).host;
  const worker = await swTarget.worker();
  worker.on('console', (message) => { if (['error', 'warn'].includes(message.type())) errors.push(`[sw:${message.type()}] ${message.text()}`); });

  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 780 });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[ui] ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`[ui] ${error.message}`));
  await page.goto(`chrome-extension://${id}/ui/app.html`, { waitUntil: 'load' });
  await sleep(700);
  const running = await page.evaluate(() => chrome.runtime.getManifest().version);
  if (running !== version) errors.push(`версия в браузере ${running} не совпадает с manifest ${version}`);
  const tabs = await page.$$eval('#tabs .tab', (nodes) => nodes.map((node) => node.dataset.tab));
  if (JSON.stringify(tabs) !== JSON.stringify(EXPECTED_TABS)) errors.push(`разделы интерфейса: ${tabs.join(', ')}`);
  for (const tab of tabs) {
    await page.click(`#tabs .tab[data-tab="${tab}"]`);
    await sleep(500);
    const view = await page.$eval('#view', (node) => ({ text: node.innerText.replace(/\s+/g, ' ').trim().slice(0, 120), broken: Boolean(node.querySelector('.alert.err')) && /Раздел не открылся/.test(node.innerText) }));
    console.log(`[${tab}] ${view.text}`);
    if (!view.text) errors.push(`раздел ${tab} пуст`);
    if (view.broken) errors.push(`раздел ${tab} не открылся: ${view.text}`);
    await page.screenshot({ path: path.join(OUT, `${tab}.png`) });
  }
} catch (error) { errors.push(error.stack || String(error)); }
finally { await browser.close(); }
console.log(errors.length ? `SMOKE FAILED (${errors.length})\n${errors.join('\n')}` : `SMOKE PASSED (версия ${version}, скриншоты: ${OUT})`);
process.exitCode = errors.length ? 1 : 0;
