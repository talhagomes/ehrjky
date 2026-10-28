import { boot, openUi, sleep, checks } from './harness.mjs';
import { manual, installManualMock } from './mock-tiktok.mjs';

const env = await boot();
const log = (...a) => console.log(...a);
const A1 = env.ACC.A1;
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
const t = checks('Manual в unified-редакторе: отказ API → Smart+ через DOM, защита Sales → App, подпись из настроек');
const verdict = (name, ok, extra = '') => t.ok(name, ok, extra);

async function openPage(path) {
  const page = await env.browser.newPage();
  await page.goto(`https://ads.tiktok.com${path}`, { waitUntil: 'load' });
  const tabId = await env.evalSw(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());
  return { page, tabId };
}
const draftPath = (draft) => `/i18n/creation/1nn/create/campaign?aadvid=${A1}&campaign_draft_id=${draft}`;
const sw = (ui, ns, type, extra = {}) => ui.evaluate((n, t, e) => chrome.runtime.sendMessage({ ns: n, type: t, ...e }), ns, type, extra);
const smart = (page) => page.evaluate(() => ({ smart: document.getElementById('smart').getAttribute('aria-checked'), budget: document.getElementById('budget').getAttribute('aria-checked'), clicks: window.__clicks || [] }));
const captured = (ui, tabId) => ui.evaluate((id) => chrome.storage.session.get(`tth:manual:capture:${id}`).then((v) => Boolean(v[`tth:manual:capture:${id}`])), tabId);

try {
  installManualMock();

  // S1: TikTok отверг сохранение → запасной путь выключает Smart+ в том же черновике
  manual.saveMode = 'reject'; manual.dest = 3; manual.saves.length = 0;
  let { page, tabId } = await openPage(draftPath('9100000000000000001'));
  let ui = await openUi(env, tabId, { tab: 'manual' });
  await waitFor(() => captured(ui, tabId));
  let r = (await sw(ui, 'manual', 'activate', { tabId, account: A1 }));
  let s = await smart(page);
  verdict('S1 отказ API → Smart+ выключен через DOM', r.ok && r.data?.fallback === 'unified-dom' && s.smart === 'false', JSON.stringify({ r, s }));
  verdict('S1 затронут только Smart+ (бюджет не тронут)', s.budget === 'true' && s.clicks.join() === 'smart');
  verdict('S1 запрос сохранения действительно отправлялся и был отвергнут', manual.saves.length === 1 && manual.saves[0].mode === 'reject', JSON.stringify(manual.saves.length));
  await page.close(); await ui.close();

  // S2: обычный путь — сохранение принято, страница перезагружается, Smart+ выключается проверкой на странице
  manual.saveMode = 'ok'; manual.saves.length = 0;
  ({ page, tabId } = await openPage(draftPath('9100000000000000002')));
  ui = await openUi(env, tabId, { tab: 'manual' });
  await waitFor(() => captured(ui, tabId));
  r = await sw(ui, 'manual', 'activate', { tabId, account: A1 });
  const off = await waitFor(async () => (await smart(page).catch(() => null))?.smart === 'false');
  verdict('S2 сохранение принято → Smart+ выключен после перезагрузки', Boolean(off) && r.ok, JSON.stringify(r));
  verdict('S2 отправлен один replay с флагами Manual', manual.saves.length === 1 && manual.saves[0].flags.spc_automation_type === 0 && manual.saves[0].flags.spc_upgrade_mode === undefined, JSON.stringify(manual.saves[0]?.flags));
  await page.close(); await ui.close();

  // S3: Sales → App при создании нового черновика — защита не обходится, Smart+ остаётся включённым
  manual.saveMode = 'reject'; manual.dest = 4; manual.saves.length = 0;
  ({ page, tabId } = await openPage(`/i18n/creation/1nn/?aadvid=${A1}`));
  await page.evaluate(() => { window.__draft = '9100000000000000003'; });
  ui = await openUi(env, tabId, { tab: 'manual' });
  r = await sw(ui, 'manual', 'activate', { tabId, account: A1 });
  const arrived = await waitFor(() => page.url().includes('campaign_draft_id=9100000000000000003'), 15000);
  await sleep(6000);
  const status = (await sw(ui, 'manual', 'status', { tabId })).data;
  s = await smart(page).catch(() => ({ smart: '?', clicks: ['?'] }));
  log('   S3 details:', JSON.stringify({ activate: r, arrived: Boolean(arrived), lastError: status?.state?.lastError, smart: s.smart, clicks: s.clicks, replays: manual.saves.length }));
  verdict('S3 Sales → App: Smart+ не тронут', Boolean(arrived) && s.smart === 'true' && s.clicks.length === 0 && manual.saves.length === 0);
  verdict('S3 пользователь видит причину «Sales → App … Черновик не изменён»', /Sales → App/.test(status?.state?.lastError || ''), String(status?.state?.lastError).slice(0, 80));
  await page.close(); await ui.close();

  // S4: интерфейс не на английском — подпись переключателя берётся из настроек
  const RU = 'Управляйте кампанией с помощью Smart+';
  manual.saveMode = 'reject'; manual.dest = 3; manual.label = RU; manual.saves.length = 0;
  ({ page, tabId } = await openPage(draftPath('9100000000000000004')));
  ui = await openUi(env, tabId, { tab: 'manual' });
  await waitFor(() => captured(ui, tabId));
  const t0 = Date.now();
  r = await sw(ui, 'manual', 'activate', { tabId, account: A1 });
  s = await smart(page);
  verdict('S4 без подписи в настройках: ничего не нажато, показана ошибка', s.smart === 'true' && s.clicks.length === 0 && !r.ok, `${Math.round((Date.now() - t0) / 1000)} c ${JSON.stringify(r).slice(0, 120)}`);
  await sw(ui, 'settings', 'patch', { patch: { manual: { smartLabels: [RU] } } });
  r = await sw(ui, 'manual', 'activate', { tabId, account: A1 });
  s = await smart(page);
  verdict('S4 с подписью в настройках: Smart+ выключен', r.ok && s.smart === 'false' && s.clicks.join() === 'smart', JSON.stringify({ r, s }));
  await page.close(); await ui.close();

} catch (error) {
  t.crash(error);
} finally {
  t.finish(env);
  await env.close();
}
