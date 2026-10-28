// DOM-адаптер платежной страницы Ads Manager. Запускается в MAIN world и работает только
// с оболочкой TikTok; реквизиты карты вводятся внутри отдельного iframe PipoPay.

export async function inspectBillingInPage(expectedAccount = '', waitMs = 12000) {
  try {
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    const accountId = new URL(location.href).searchParams.get('aadvid') || '';
    if (expectedAccount && accountId !== String(expectedAccount)) return { error: 'На платежной странице открыт другой рекламный кабинет.' };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const end = Date.now() + Math.max(0, Number(waitMs) || 0);
    while (Date.now() < end) {
      const text = document.body?.innerText || '';
      if (/Payment methods|Add a payment method|Способ(?:ы)? оплаты|Добавить способ оплаты/i.test(text)) break;
      await pause(250);
    }

    const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const cardManager = document.querySelector('[class*="upay-card-manager"]');
    const cardText = String(cardManager?.innerText || '').replace(/\s+/g, ' ').trim();
    const paymentMethods = [];
    const seen = new Set();
    const cardPattern = /(?:\*{2,}\s*){3}(\d{4})(?:\s+([A-Z]{3}))?/g;
    for (const source of [cardText, bodyText]) {
      for (const match of source.matchAll(cardPattern)) {
        if (seen.has(match[1])) continue;
        seen.add(match[1]);
        const tail = source.slice(match.index, match.index + 180);
        const expiry = tail.match(/(?:Expiry date|Срок действия)\s*(\d{1,2}\/\d{2,4})/i)?.[1] || '';
        paymentMethods.push({ last4: match[1], currency: match[2] || '', expiry });
      }
    }

    const frame = document.querySelector('iframe[src*="pipopay.com"],iframe[src*="pipo"]');
    let iframeOrigin = '';
    try { if (frame?.src) iframeOrigin = new URL(frame.src).origin; } catch { /* адрес необязателен */ }
    const amountDue = bodyText.match(/(?:Amount due)[^\d]{0,100}([\d.,]+)\s*([A-Z]{3})/i);
    const balance = bodyText.match(/(?:Available cash balance)[^\d]{0,80}([\d.,]+)\s*([A-Z]{3})/i);
    const portfolio = bodyText.match(/Payment Portfolio\s*(Advanced|Standard)?/i);
    const billingOption = bodyText.match(/(?:Auction)\s+(Automatic payment|Manual payment|Monthly invoicing)/i);
    return {
      ready: Boolean(cardManager || /Payment methods|Add a payment method/i.test(bodyText)),
      accountId,
      portfolio: portfolio ? `Payment Portfolio${portfolio[1] ? ` ${portfolio[1]}` : ''}` : '',
      billingOption: billingOption?.[1] || '',
      paymentMethods,
      canAdd: /Add a payment method/i.test(cardText || bodyText),
      addDialogOpen: Boolean(frame),
      iframeOrigin,
      automaticPaymentPaused: /Automatic payment paused/i.test(bodyText),
      amountDue: amountDue ? { amount: amountDue[1], currency: amountDue[2] } : null,
      cashBalance: balance ? { amount: balance[1], currency: balance[2] } : null,
      at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 240) };
  }
}

export async function openAddPaymentMethodInPage(expectedAccount = '', waitMs = 16000) {
  try {
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    const accountId = new URL(location.href).searchParams.get('aadvid') || '';
    if (expectedAccount && accountId !== String(expectedAccount)) return { error: 'Открыт другой рекламный кабинет.' };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const end = Date.now() + Math.max(1000, Number(waitMs) || 0);
    let target = null;
    while (Date.now() < end && !target) {
      const scope = document.querySelector('[class*="upay-card-manager"]') || document.body;
      target = [...scope.querySelectorAll('button,a,[role="button"],div,span')].find((el) =>
        visible(el) && String(el.textContent || '').replace(/\s+/g, ' ').trim() === 'Add a payment method');
      if (!target) await pause(250);
    }
    if (!target) return { error: 'TikTok не показал кнопку «Add a payment method». Возможно, картой управляет Business Center или нет финансовых прав.' };
    target.click();

    let frame = null;
    while (Date.now() < end && !frame) {
      frame = document.querySelector('iframe[src*="pipopay.com"],iframe[src*="pipo"]');
      if (!frame && !/Add payment method\s+Your payments are secure/i.test(document.body?.innerText || '')) await pause(200);
      else if (!frame) await pause(350);
    }
    let iframeOrigin = '';
    try { if (frame?.src) iframeOrigin = new URL(frame.src).origin; } catch { /* адрес необязателен */ }
    return { opened: Boolean(frame || /Add payment method\s+Your payments are secure/i.test(document.body?.innerText || '')), accountId, iframeOrigin, at: Date.now() };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 240) };
  }
}
