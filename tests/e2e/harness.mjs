// Запуск настоящего Chrome с расширением и локальным «TikTok» (мок). Нужен Chromium или Chrome for Testing:
// Chrome 137+ с брендингом не принимает --load-extension (для него есть npm run smoke). Путь к браузеру — переменная CHROME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../../scripts/lib/chrome.mjs';
import { startMock, state, ACC, BC1, BC2, HOSTS, PORT } from './mock-tiktok.mjs';

export const EXT = path.resolve(process.env.EXT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'TTAds-Hub'));
export const OUT = path.resolve(process.env.E2E_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-output', 'e2e'));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const waitFor = async (fn, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(250); }
  throw new Error('timeout');
};

export async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startMock();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ttads-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: true, defaultViewport: null, ignoreDefaultArgs: ['--disable-extensions'], userDataDir: profile,
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      `--host-resolver-rules=${HOSTS.map((host) => `MAP ${host} 127.0.0.1:${PORT}`).join(',')}`, '--window-size=500,860']
  });
  const swTarget = await browser.waitForTarget((target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'), { timeout: 20000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  const errors = [];
  sw.on?.('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(`[sw ${message.type()}] ${message.text()}`); });
  return {
    server, browser, extId, sw, errors, state, ACC, BC1, BC2,
    evalSw: (fn, ...args) => sw.evaluate(fn, ...args),
    async close() { await browser.close().catch(() => {}); server.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  };
}

export async function openAds(env, aadvid = ACC.A1) {
  const page = await env.browser.newPage();
  await page.goto(`https://ads.tiktok.com/i18n/manage/campaign?aadvid=${aadvid}`, { waitUntil: 'load' });
  const tabId = await env.evalSw(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  return { page, tabId };
}

export async function openUi(env, tabId, { width = 470, height = 860, tab = 'overview' } = {}) {
  const ui = await env.browser.newPage();
  await ui.setViewport({ width, height, deviceScaleFactor: 1 });
  ui.on('pageerror', (error) => env.errors.push(`[ui pageerror] ${error.message}`));
  ui.on('console', (message) => { if (message.type() === 'error') env.errors.push(`[ui console] ${message.text()}`); });
  await ui.evaluateOnNewDocument((t) => { try { localStorage.setItem('tth.tab', t); } catch { /* необязательно */ } }, tab);
  await ui.goto(`chrome-extension://${env.extId}/ui/app.html?tab=${tabId}`, { waitUntil: 'load' });
  return ui;
}

export const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
export const click = (page, text, scope = 'button') => page.evaluate((t, s) => {
  const element = [...document.querySelectorAll(s)].find((node) => node.textContent.trim().includes(t) && !node.disabled);
  if (!element) throw new Error(`нет кнопки «${t}»`);
  element.click();
}, text, scope);

// Проверки сценария: печатают PASS/FAIL, итог — код выхода процесса. Исключение сценария и ноль проверок считаются провалом.
export function checks(title) {
  const results = [];
  console.log(`\n=== ${title}`);
  return {
    ok(name, value, details = '') {
      results.push(Boolean(value));
      console.log(`${value ? 'PASS' : 'FAIL'} ${name}${!value && details ? ` — ${typeof details === 'string' ? details : JSON.stringify(details)}`.slice(0, 400) : ''}`);
    },
    crash(error) {
      results.push(false);
      console.log(`FAIL сценарий прервался: ${String(error?.stack || error).split('\n').slice(0, 9).join(' | ').slice(0, 900)}`);
    },
    finish(env) {
      const errors = env?.errors?.filter((line) => !/favicon/i.test(line)) || [];
      if (errors.length) { results.push(false); console.log(`FAIL ошибки консоли расширения: ${errors.slice(0, 4).join(' | ').slice(0, 400)}`); }
      if (!results.length) { results.push(false); console.log('FAIL не выполнено ни одной проверки'); }
      const failed = results.filter((value) => !value).length;
      console.log(failed ? `FAILED: ${failed} из ${results.length}` : `ALL PASSED (${results.length})`);
      process.exitCode = failed ? 1 : 0;
    }
  };
}
