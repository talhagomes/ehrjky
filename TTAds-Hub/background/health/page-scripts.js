// Снимки платёжной страницы Ads Manager и таблиц Business Center для проверки «здоровья» РК.
// Функции самодостаточны (chrome.scripting сериализует их целиком) и запускаются в MAIN world.
// Возвращают только видимый текст для разбора в сервис-воркере; он не сохраняется — в кэш попадают разобранные поля.

export async function readAdsBillingPageInPage(expectedAccount = '', waitMs = 15000) {
  try {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    if (location.origin === 'https://business.tiktok.com') return { redirectedToBc: true, url: location.href, at: Date.now() };
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    const accountId = new URL(location.href).searchParams.get('aadvid') || '';
    if (expectedAccount && accountId && accountId !== String(expectedAccount)) return { error: 'Открыт другой рекламный кабинет.', accountId };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const READY = /Payment methods|Add a payment method|Payment Portfolio|Amount due|Available cash balance|Finance access required|Automatic payment|Manual payment|Monthly invoicing|Способ(?:ы)? оплаты|Добавить способ оплаты|Платёжный портфель/i;
    const end = Date.now() + Math.max(1000, Number(waitMs) || 0);
    while (Date.now() < end && !READY.test(document.body?.innerText || '')) await pause(300);
    // Суммы и таблица транзакций догружаются после заголовков.
    await pause(900);
    const text = clean(document.body?.innerText);
    if (/\b(?:Log in|Sign in)\b/i.test(text.slice(0, 400)) && !READY.test(text)) return { login: true, url: location.href, at: Date.now() };
    const cardManager = document.querySelector('[class*="upay-card-manager"],[class*="card-manager" i],[class*="payment-method-list" i]');
    const rows = [...document.querySelectorAll('tr,[role="row"]')]
      .map((row) => clean(row.innerText)).filter((value) => value && value.length <= 400 && /\d/.test(value)).slice(0, 80);
    const frame = document.querySelector('iframe[src*="pipopay.com"],iframe[src*="pipo"]');
    let iframeOrigin = '';
    try { if (frame?.src) iframeOrigin = new URL(frame.src).origin; } catch { /* адрес необязателен */ }
    return {
      accountId, url: location.href, path: location.pathname, ready: READY.test(text),
      text: text.slice(0, 15000), cardText: clean(cardManager?.innerText).slice(0, 3000),
      rows, iframe: Boolean(frame), iframeOrigin, at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 240) };
  }
}

// Таблица РК в Business Center: Finance → Payment management (статус, порог «x / y CUR», дата списания)
// или Accounts → Advertiser accounts (статус). Проходит пагинацию, пока появляются новые строки.
export async function readBcTableInPage(expectedBcId = '', waitMs = 20000, maxPages = 10) {
  try {
    if (location.origin !== 'https://business.tiktok.com') return { error: 'Откройте TikTok Business Center.' };
    const bcId = new URL(location.href).searchParams.get('org_id') || '';
    if (expectedBcId && bcId && bcId !== String(expectedBcId)) return { error: 'Открыт другой Business Center.', bcId };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el || !el.isConnected) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const idRows = () => [...document.querySelectorAll('tr,[role="row"]')].filter((row) => /\bID\s*:?\s*\d{5,30}/i.test(row.textContent || ''));
    const end = Date.now() + Math.max(1000, Number(waitMs) || 0);
    let financeAccessRequired = false, noAccess = false;
    while (Date.now() < end) {
      const body = document.body?.innerText || '';
      financeAccessRequired = /Finance access required/i.test(body);
      noAccess = /no permission|don['’]t have permission|do not have permission|not a member of this business center/i.test(body);
      if (financeAccessRequired || noAccess || idRows().length) break;
      await pause(300);
    }
    await pause(600);
    const headers = [...document.querySelectorAll('thead th,[role="columnheader"]')].filter(visible).map((el) => clean(el.innerText)).slice(0, 30);
    const byId = new Map();
    const collect = () => {
      for (const row of idRows()) {
        const text = clean(row.innerText);
        const id = text.match(/\bID\s*:?\s*(\d{5,30})\b/i)?.[1];
        if (!id || byId.has(id)) continue;
        const cells = [...row.querySelectorAll(':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="gridcell"]')].map((cell) => clean(cell.innerText)).slice(0, 30);
        byId.set(id, { text: text.slice(0, 600), cells });
      }
    };
    collect();
    const nextButton = () => [...document.querySelectorAll('li[title="Next Page"],[class*="pagination" i] [class*="next" i],button[aria-label*="next" i]')]
      .find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/disabled/i.test(String(el.className || '')));
    for (let page = 1; page < Math.max(1, Number(maxPages) || 1); page += 1) {
      const next = nextButton();
      if (!next) break;
      const before = byId.size, firstText = idRows()[0]?.textContent || '';
      (next.querySelector('button,a') || next).click();
      const changeEnd = Date.now() + 8000;
      while (Date.now() < changeEnd) {
        await pause(300);
        const first = idRows()[0];
        if (first && first.textContent !== firstText) break;
      }
      collect();
      if (byId.size === before) break;
    }
    return {
      bcId, path: location.pathname, url: location.href, headers, rows: [...byId.values()].slice(0, 2000),
      financeAccessRequired, noAccess, empty: !byId.size, at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 240) };
  }
}
