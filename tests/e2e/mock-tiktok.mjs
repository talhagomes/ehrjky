// Мок TikTok для сквозных проверок расширения в настоящем Chrome: ads/business.tiktok.com → локальный HTTPS.
// Тексты страниц — упрощённые аналоги живых (проверяют механику движков, а не вёрстку TikTok).
import https from 'node:https';
import selfsigned from 'selfsigned';

export const BC1 = '7700000000000000001', BC2 = '7700000000000000002';
export const ACC = {
  A1: '7700000000000001001', A2: '7700000000000001002', A3: '7700000000000001003', B1: '7700000000000002001', P1: '7700000000000003001'
};
const camp = (id, name, extra = {}) => ({ campaign_id: id, campaign_name: name, primary_status: 'delivery_ok', opt_status: 1, campaign_budget: 50, stat_cost: 0, show_cnt: 0, click_cnt: 0, time_attr_convert_cnt: 0, ...extra });
export const state = {
  campaigns: {
    [ACC.A1]: [camp('7700100000000000001', 'Alpha Camp 1', { stat_cost: 12.34, show_cnt: 900, click_cnt: 40, time_attr_convert_cnt: 3 }), camp('7700100000000000002', 'Alpha Camp 2', { stat_cost: 5.5, show_cnt: 300, click_cnt: 12 })],
    [ACC.A2]: [camp('7700100000000000003', 'No card camp', { primary_status: 'not_delivery', campaign_status: 'account_balance_not_enough' })],
    [ACC.A3]: [camp('7700100000000000004', 'Debt camp', { primary_status: 'not_delivery', campaign_status: 'account_balance_not_enough', stat_cost: 3.2, show_cnt: 100, click_cnt: 2 })],
    [ACC.B1]: [],
    [ACC.P1]: [camp('7700100000000000005', 'Paused camp', { primary_status: 'campaign_disable', opt_status: 2 })]
  },
  calls: []
};
const accounts = {
  [ACC.A1]: { name: 'Alpha RK 1', country: 'DE', currency: 'EUR', bc: BC1 },
  [ACC.A2]: { name: 'Alpha RK 2', country: 'DE', currency: 'EUR', bc: BC1 },
  [ACC.A3]: { name: 'Alpha RK 3', country: 'DE', currency: 'EUR', bc: BC1 },
  [ACC.B1]: { name: 'Beta RK 1', country: 'PL', currency: 'PLN', bc: BC2 },
  [ACC.P1]: { name: 'Personal RK', country: 'ES', currency: 'EUR', bc: '' }
};
const bcs = { [BC1]: 'Alpha BC', [BC2]: 'Beta BC' };

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:14px sans-serif;padding:16px">${body}</body></html>`;

function paymentPage(id) {
  const common = 'Payment Portfolio Advanced ID: 7689111397006967572';
  if (id === ACC.A1) return `${common} Auction Automatic payment ${state.a1Debt ? 'Amount due 3.00 EUR Automatic payment paused' : ''} Available cash balance 25.00 EUR
    <div class="upay-card-manager">Payment methods Visa **** **** **** 4242 EUR Expiry date 01/30 Primary Add a payment method</div>
    Payment threshold 12.30 / 50.00 EUR Next billing date 2026-11-01
    <table><tr><td>2026-10-20 Automatic payment 25.00 EUR Successful</td></tr><tr><td>2026-10-05 Automatic payment 20.50 EUR Successful</td></tr></table>`;
  if (id === ACC.A2) return `Auction Manual payment Available cash balance 0.00 EUR
    <div class="upay-card-manager">Payment methods No payment method added Add a payment method</div>`;
  if (id === ACC.A3) return `${common} Auction Automatic payment Automatic payment paused Amount due 5.00 EUR Available cash balance 0.00 EUR
    <div class="upay-card-manager">Payment methods Mastercard **** **** **** 4444 EUR Expiry date 03/30 Add a payment method</div>
    <table><tr><td>2026-10-20 Automatic payment 5.00 EUR Failed</td></tr></table> Verify your phone number for security.`;
  if (id === ACC.B1) return 'Finance access required. Your ad account has been suspended due to policy violation.';
  return 'Payment methods Add a payment method Your ad account is under review.';
}

function bcTable(bcId, kind) {
  const rows = Object.entries(accounts).filter(([, a]) => a.bc === bcId);
  const head = kind === 'payment' ? ['Account', 'Account status', 'Balance', 'Threshold'] : ['Account', 'Account status'];
  const status = (id) => (id === ACC.B1 ? 'Disabled' : 'Approved');
  const thr = (id) => (id === ACC.A1 ? '12.30 / 50.00 EUR Billing date: 2026-11-01' : id === ACC.A3 ? '0.00 / 5.00 EUR' : '—');
  return `<table><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(([id, a]) =>
    `<tr><td>${a.name} ID: ${id}</td><td>${status(id)}</td>${kind === 'payment' ? `<td>0.00 ${a.currency}</td><td>${thr(id)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}

function route(req, url) {
  const p = url.pathname;
  if (url.hostname === 'ads.tiktok.com') {
    if (p === '/api/v2/i18n/account/account_switch_list/') {
      const data = Object.entries(bcs).map(([id, name]) => ({ id, name, role: '99', child: Object.entries(accounts).filter(([, a]) => a.bc === id).map(([aid, a]) => ({ id: aid, name: a.name, country: a.country, currency: a.currency, status: 1 })) }));
      for (const [aid, a] of Object.entries(accounts)) if (!a.bc) data.push({ id: aid, name: a.name, country: a.country, currency: a.currency, status: 1 });
      return { json: { code: 0, data: { data } } };
    }
    const list = p.match(/^\/api\/v4\/i18n\/statistics\/op\/(campaign|adgroup|ad)\/list\/$/);
    if (list) {
      const rows = list[1] === 'campaign' ? (state.campaigns[url.searchParams.get('aadvid')] || []) : [];
      return { json: { code: 0, data: { table: rows, pagination: { total_count: rows.length, page_count: 1 } } } };
    }
    if (p === '/i18n/account/payment') return { html: page('Payment', paymentPage(url.searchParams.get('aadvid'))) };
    return { html: page('Ads Manager', `<h1>Ads Manager mock</h1><p>${p}</p>`) };
  }
  if (url.hostname === 'business.tiktok.com') {
    const bc = url.searchParams.get('org_id');
    if (p === '/manage/payment/v2') return { html: page('Finance', bc === BC2 ? 'Finance access required' : `Payment management ${bcTable(bc, 'payment')}`) };
    if (p === '/manage/accounts/adv') return { html: page('Accounts', `Advertiser accounts ${bcTable(bc, 'accounts')}`) };
    return { html: page('Business Center', `BC mock ${p}`) };
  }
  return { status: 404, text: 'not found' };
}

export const PORT = 8443;
export const HOSTS = ['ads.tiktok.com', 'business.tiktok.com', 'business-api.tiktok.com'];

// HTTPS-сервер с самоподписанным сертификатом на тестовые имена TikTok; Chrome направляет эти хосты сюда (host-resolver-rules).
export async function startMock(port = PORT) {
  const pems = await selfsigned.generate([{ name: 'commonName', value: HOSTS[0] }], {
    days: 2, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: HOSTS.map((value) => ({ type: 2, value })) }]
  });
  const server = https.createServer({ key: pems.private, cert: pems.cert }, async (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    state.calls.push({ method: req.method, host: url.hostname, path: url.pathname + url.search, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) });
    const out = (typeof state.handler === 'function' && state.handler(req, url, Buffer.concat(chunks).toString('utf8'))) || route(req, url);
    if (out.json) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out.json)); }
    else if (out.html) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(out.html); }
    else { res.writeHead(out.status || 200, { 'content-type': 'text/plain' }); res.end(out.text || ''); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// Мок мутаций: форма тела намеренно отличается от любой «ожидаемой», чтобы проверить, что расширение ничего не предполагает.
export function installMutations(shapes = {}) {
  state.handler = (req, url, bodyText) => {
    const m = url.pathname.match(/^\/api\/v\d+\/i18n\/overture\/(campaign|ad|creative)\/(update_status|batch_update\/(name|budget))\/$/);
    if (!m || req.method !== 'POST') return null;
    let body;
    try { body = JSON.parse(bodyText); } catch { return { json: { code: 40002, msg: 'bad json' } }; }
    const rows = state.campaigns[url.searchParams.get('aadvid')] || [];
    const byId = (id) => rows.find((r) => r.campaign_id === id);
    if (m[2] === 'update_status') {
      if (!Array.isArray(body.campaign_ids) || ![1, 2].includes(body.opt_status)) return { json: { code: 40002, msg: 'invalid params' } };
      for (const id of body.campaign_ids) { const r = byId(id); if (r) { r.opt_status = body.opt_status; r.primary_status = body.opt_status === 1 ? 'delivery_ok' : 'campaign_disable'; } }
      return { json: { code: 0, msg: 'ok' } };
    }
    if (m[3] === 'name') {
      if (!body.name_map || typeof body.name_map !== 'object') return { json: { code: 40002, msg: 'name_map required' } };
      for (const [id, name] of Object.entries(body.name_map)) { const r = byId(id); if (r) r.campaign_name = name; }
      return { json: { code: 0, msg: 'ok' } };
    }
    if (!Array.isArray(body.budget_map)) return { json: { code: 40002, msg: 'budget_map required' } };
    for (const item of body.budget_map) { const r = byId(item.campaign_id); if (r) r.campaign_budget = item.budget_cents / 100; }
    return { json: { code: 0, msg: 'ok' } };
  };
}

// Мок unified-редактора TikTok для сценариев Manual: страница выбора цели, страница черновика с Smart+ switch и сохранение черновика.
export const SAVE_PATH = '/api/v4/i18n/creation/campaign_snap/save/';
export const manual = { saveMode: 'ok', saves: [], label: 'Power your campaign with Smart+', dest: 3, goal: 'Sales' };

const draftPage = (aadvid, draft) => `<!doctype html><meta charset="utf-8"><title>Draft</title>
<style>[role=switch]{display:inline-block;width:30px;height:16px;background:#bbb}button{min-width:50px;min-height:22px}</style>
<div class="campaign-objective"><label role="radio" aria-checked="true" data-testid="new-objective-selection-x">${manual.goal}</label></div>
<section>
  <div><span>Budget optimization</span><div id="budget" role="switch" aria-checked="true"></div></div>
  <div><span>${manual.label}</span><div id="smart" role="switch" aria-checked="true"></div></div>
</section>
<script>
  for (const el of document.querySelectorAll('[role=switch]')) el.onclick = () => { el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true')); (window.__clicks ||= []).push(el.id); };
  fetch('${SAVE_PATH}?aadvid=${aadvid}&req_src=ad_creation', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrftoken': 'tok' }, body: JSON.stringify({
    campaign_sketch_form_data: { campaign_sketch_id: '${draft}', campaign_snap_id: 'S${draft}', objective_type: 3, sales_destination: ${manual.dest},
      universal_type: 1, spc_automation_type: 1, auto_creation_product_type: 1, budget_optimize_switch: 1, spc_upgrade_mode: 1, spc_multi_ad_mode: 1, web_all_in_one_catalog: 1 } }) });
</script>`;

export function installManualMock() {
  state.handler = (req, url, bodyText) => {
    if (url.hostname !== 'ads.tiktok.com') return null;
    if (url.pathname === SAVE_PATH && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(bodyText); } catch { /* пусто */ }
      const replay = body.is_skip_check_fields === true;
      if (replay) manual.saves.push({ mode: manual.saveMode, flags: body.campaign_sketch_form_data });
      if (replay && manual.saveMode === 'reject') return { json: { code: 50000, msg: 'contract changed' } };
      return { json: { code: 0, msg: 'ok', data: { campaign_sketch_id: body.campaign_sketch_form_data?.campaign_sketch_id } } };
    }
    if (url.pathname === '/i18n/creation/1nn/create/campaign') return { html: draftPage(url.searchParams.get('aadvid'), url.searchParams.get('campaign_draft_id')) };
    if (url.pathname === '/i18n/creation/1nn/') {
      const aadvid = url.searchParams.get('aadvid');
      return { html: `<!doctype html><meta charset="utf-8"><style>button{min-width:60px;min-height:24px}</style>
        <div class="campaign-objective"><label role="radio" aria-checked="true" data-testid="new-objective-selection-x">${manual.goal}</label></div>
        <button id="go">Continue</button><script>document.querySelector('#go').onclick = () => { location.href = '/i18n/creation/1nn/create/campaign?aadvid=${aadvid}&campaign_draft_id=' + (window.__draft || '9100000000000000002'); };</script>` };
    }
    return null;
  };
}
