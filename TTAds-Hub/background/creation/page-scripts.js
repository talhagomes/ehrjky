// DOM-автоматизация официального мастера business.tiktok.com/account/create.
// Функции самодостаточны: chrome.scripting сериализует их и запускает в MAIN world.

export async function automateAccountCreationInPage(plan, submit = true) {
  try {
    if (location.origin !== 'https://business.tiktok.com' || location.pathname !== '/account/create') {
      return { error: 'Открыт не мастер создания TikTok Business Center.' };
    }
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (document.querySelector('input[placeholder="Enter ad account name"]')) break;
      await pause(250);
    }
    if (!document.querySelector('input[placeholder="Enter ad account name"]')) {
      return { error: 'TikTok не загрузил форму создания. Проверьте авторизацию и обновите страницу.' };
    }

    const exact = (text, root = document) => [...root.querySelectorAll('button,[role="button"],label,div,span,p,ks-text-b0kpeh8i')]
      .filter((element) => visible(element) && clean(element.textContent) === text);
    const headingTop = (fragment) => {
      const element = [...document.querySelectorAll('div,span,p,ks-text-b0kpeh8i')]
        .filter((candidate) => {
          const value = clean(candidate.textContent);
          return visible(candidate) && (value === fragment || (value.endsWith(fragment) && value.length <= fragment.length + 6));
        }).sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0];
      return element?.getBoundingClientRect().top ?? -Infinity;
    };
    const clickBand = (text, start, finish) => {
      const top = headingTop(start), bottom = headingTop(finish);
      const target = exact(text).find((element) => {
        const y = element.getBoundingClientRect().top;
        return y > top && y < bottom;
      });
      if (!target) return false;
      (target.closest('button,[role="button"],label,[class*="cursor-pointer"]') || target).click();
      return true;
    };
    const input = (placeholder) => document.querySelector(`input[placeholder="${placeholder}"]`);
    const setInput = (element, value) => {
      if (!element || value === undefined || value === null || value === '') return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
      return true;
    };
    const chooseVisibleOption = async (wanted = '') => {
      await pause(180);
      const options = [...document.querySelectorAll('[role="option"],li,[class*="option"],[class*="menu"] [class*="item"]')]
        .filter((element) => visible(element) && clean(element.textContent));
      const target = options.find((element) => wanted && clean(element.textContent).toLowerCase().includes(wanted.toLowerCase())) || options[0];
      if (!target) return false;
      target.click();
      return true;
    };
    const setCheckbox = (hostId, checked) => {
      const host = document.getElementById(hostId);
      const native = host?.shadowRoot?.querySelector('input[type="checkbox"]') || host?.querySelector?.('input[type="checkbox"]');
      if (!host && !native) return false;
      const current = native ? native.checked : host.getAttribute('aria-checked') === 'true';
      if (current !== checked) (visible(host) ? host : native || host)?.click();
      return true;
    };

    // TikTok рекомендует создавать дополнительные BC под существующей Company.
    if (plan.companyMode === 'new') {
      clickBand('Create new', 'Company information', 'Business Center information');
      await pause(180);
      setInput(input('Business website or app download URL'), plan.companyWebsite);
      setInput(input('Enter your business name'), plan.companyName);
      setInput(input('Contact name'), plan.contactName);
      setInput(input('Enter phone number'), plan.phone);
      setInput(input('Please enter your email'), plan.email);
      const industry = exact('Select an industry')[0];
      if (industry) {
        (industry.closest('button,[role="button"],[class*="select"]') || industry).click();
        await chooseVisibleOption(plan.industry);
      }
    } else {
      clickBand('Select existing', 'Company information', 'Business Center information');
      await pause(120);
      if (plan.companyName) {
        const target = exact(plan.companyName).find((element) => element.getBoundingClientRect().top < headingTop('Business Center information'));
        (target?.closest('button,[role="button"],[class*="cursor-pointer"]') || target)?.click();
      }
    }

    if (plan.mode === 'new-bc') {
      clickBand('Create new', 'Business Center information', 'Advertiser Account information');
      await pause(180);
      const bcName = input('Enter a name for your account');
      if (!bcName) return { error: 'TikTok не показал поле имени Business Center.' };
      setInput(bcName, plan.businessCenterName);
    } else {
      clickBand('Select existing', 'Business Center information', 'Advertiser Account information');
      await pause(180);
      const candidates = [plan.businessCenterId, plan.businessCenterName].filter(Boolean);
      let selected = false;
      for (const value of candidates) {
        const target = exact(value).find((element) => {
          const y = element.getBoundingClientRect().top;
          return y > headingTop('Business Center information') && y < headingTop('Advertiser Account information');
        });
        if (target) {
          (target.closest('button,[role="button"],[class*="cursor-pointer"]') || target).click();
          selected = true;
          break;
        }
      }
      if (!selected && plan.businessCenterId) return { error: `Business Center ${plan.businessCenterId} не найден в мастере TikTok.` };
    }

    const advertiser = input('Enter ad account name');
    if (!advertiser) return { error: 'TikTok не показал поле имени рекламного кабинета.' };
    setInput(advertiser, plan.adAccountName);

    // Keystone держит native checkbox внутри Shadow DOM. Основные условия обязательны;
    // необязательный Beta Tester намеренно не включаем.
    setCheckbox('tiktokBusinessTerms', true);
    setCheckbox('betaTesterTerms', false);
    await pause(120);

    const prepared = {
      mode: plan.mode,
      businessCenterName: input('Enter a name for your account')?.value || plan.businessCenterName || '',
      adAccountName: advertiser.value,
      companyMode: plan.companyMode,
      page: location.href,
      at: Date.now()
    };
    if (!submit) return { prepared: true, ...prepared };

    const confirm = [...document.querySelectorAll('button')]
      .find((button) => visible(button) && !button.disabled && clean(button.textContent) === 'Confirm');
    if (!confirm) return { error: 'Кнопка Confirm недоступна. Проверьте обязательные поля в открытой форме.', ...prepared };
    confirm.click();

    const submittedAt = Date.now();
    const resultEnd = Date.now() + 60000;
    while (Date.now() < resultEnd) {
      await pause(300);
      const url = location.href;
      if (location.pathname !== '/account/create') {
        const params = new URL(url).searchParams;
        return {
          success: true, submitted: true, url,
          businessCenterId: params.get('org_id') || params.get('bc_id') || '',
          adAccountId: params.get('aadvid') || params.get('advertiser_id') || params.get('adv_id') || '',
          companyId: params.get('company_id') || '',
          paymentSetupPending: location.pathname === '/account/payment-setup',
          ...prepared, submittedAt, completedAt: Date.now()
        };
      }
      const body = clean(document.body?.innerText);
      const identity = [...document.querySelectorAll('div,section')]
        .find((element) => visible(element) && clean(element.textContent).startsWith('Protect your identity') && /verification code/i.test(clean(element.textContent)));
      if (identity) {
        return { needsUser: true, reason: 'identity-verification', submitted: true, url, ...prepared, submittedAt };
      }
      if (/captcha|verify you are human|security verification/i.test(body)) {
        return { needsUser: true, reason: 'security-verification', submitted: true, url, ...prepared, submittedAt };
      }
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error-message"],[class*="feedback"]')]
        .filter(visible).map((element) => clean(element.textContent)).find((value) => value && value.length < 260);
      if (alert) return { error: alert, submitted: true, url, ...prepared, submittedAt };
    }
    return { pending: true, submitted: true, url: location.href, ...prepared, submittedAt };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

export function inspectAccountCreationInPage(expected = {}) {
  try {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const url = location.href, params = new URL(url).searchParams;
    if (location.pathname !== '/account/create') {
      return {
        success: true, url,
        businessCenterId: params.get('org_id') || params.get('bc_id') || '',
        adAccountId: params.get('aadvid') || params.get('advertiser_id') || params.get('adv_id') || '',
        companyId: params.get('company_id') || '',
        paymentSetupPending: location.pathname === '/account/payment-setup',
        at: Date.now()
      };
    }
    const body = clean(document.body?.innerText);
    const identity = [...document.querySelectorAll('div,section')]
      .some((element) => visible(element) && clean(element.textContent).startsWith('Protect your identity') && /verification code/i.test(clean(element.textContent)));
    const advertiser = document.querySelector('input[placeholder="Enter ad account name"]')?.value || '';
    const businessCenter = document.querySelector('input[placeholder="Enter a name for your account"]')?.value || '';
    return {
      success: false, needsUser: identity || /captcha|verify you are human|security verification/i.test(body),
      reason: identity ? 'identity-verification' : '', prepared: Boolean(advertiser),
      namesMatch: (!expected.adAccountName || advertiser === expected.adAccountName) && (!expected.businessCenterName || !businessCenter || businessCenter === expected.businessCenterName),
      adAccountName: advertiser, businessCenterName: businessCenter, url, at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

// Читает только безопасную сводку страницы payment-setup: идентификаторы и выбранный
// Payment Portfolio. Номера карт, cookies и сетевые подписи никогда не возвращаются.
export function inspectPaymentSetupInPage() {
  try {
    if (location.origin !== 'https://business.tiktok.com' || location.pathname !== '/account/payment-setup') {
      return { onPaymentSetup: false, url: location.href, at: Date.now() };
    }
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const params = new URL(location.href).searchParams;
    const candidates = [...document.querySelectorAll('[role="combobox"],button,div,span')]
      .filter((element) => visible(element) && /portfolio/i.test(clean(element.textContent)) && /\bID\s*:?\s*\d{5,30}\b/i.test(clean(element.textContent)))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);
    const portfolioText = clean(candidates[0]?.textContent);
    const portfolioId = portfolioText.match(/\bID\s*:?\s*(\d{5,30})\b/i)?.[1] || '';
    const heading = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
      .filter((element) => visible(element) && clean(element.textContent) === 'Payment setup')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const headingY = heading?.getBoundingClientRect().top ?? -Infinity;
    const confirmAvailable = [...document.querySelectorAll('button')]
      .some((button) => visible(button) && !button.disabled && clean(button.textContent) === 'Confirm' && button.getBoundingClientRect().top > headingY);
    const body = clean(document.body?.innerText);
    return {
      onPaymentSetup: true,
      paymentSetupPending: true,
      businessCenterId: params.get('bc_id') || params.get('org_id') || '',
      adAccountId: params.get('adv_id') || params.get('aadvid') || '',
      companyId: params.get('company_id') || '',
      advertiserName: params.get('adv_name') || '',
      portfolio: portfolioText ? {
        id: portfolioId,
        name: portfolioText.replace(/\s*ID\s*:?\s*\d{5,30}.*$/i, '').trim(),
        summary: portfolioText.slice(0, 240)
      } : null,
      billingOption: /automatic payment/i.test(body) ? 'automatic-payment' : '',
      budget: /\bunlimited\b/i.test(body) ? 'unlimited' : '',
      confirmAvailable,
      url: location.href,
      at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

// Выполняется только после отдельного явного клика пользователя в расширении.
export async function confirmPaymentSetupInPage(expected = {}) {
  try {
    if (location.origin !== 'https://business.tiktok.com' || location.pathname !== '/account/payment-setup') {
      return { error: 'Открыта не страница Payment setup TikTok.' };
    }
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const params = new URL(location.href).searchParams;
    const bcId = params.get('bc_id') || params.get('org_id') || '';
    const adId = params.get('adv_id') || params.get('aadvid') || '';
    if (expected.businessCenterId && expected.businessCenterId !== bcId) return { error: 'Business Center на странице отличается от созданного.' };
    if (expected.adAccountId && expected.adAccountId !== adId) return { error: 'Рекламный кабинет на странице отличается от созданного.' };
    const portfolioCandidates = [...document.querySelectorAll('[role="combobox"],button,div,span')]
      .filter((element) => visible(element) && /portfolio/i.test(clean(element.textContent)) && /\bID\s*:?\s*\d{5,30}\b/i.test(clean(element.textContent)))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);
    const portfolioText = clean(portfolioCandidates[0]?.textContent);
    const portfolioId = portfolioText.match(/\bID\s*:?\s*(\d{5,30})\b/i)?.[1] || '';
    const portfolio = portfolioId ? {
      id: portfolioId,
      name: portfolioText.replace(/\s*ID\s*:?\s*\d{5,30}.*$/i, '').trim(),
      summary: portfolioText.slice(0, 240)
    } : null;
    if (!portfolio) return { error: 'TikTok не показал существующий Payment Portfolio. Автопривязка остановлена.', businessCenterId: bcId, adAccountId: adId, url: location.href };
    const heading = [...document.querySelectorAll('h1,h2,h3,div,span,p')]
      .filter((element) => visible(element) && clean(element.textContent) === 'Payment setup')
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    const headingY = heading?.getBoundingClientRect().top ?? -Infinity;
    const confirm = [...document.querySelectorAll('button')]
      .filter((button) => visible(button) && !button.disabled && clean(button.textContent) === 'Confirm' && button.getBoundingClientRect().top > headingY)
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    if (!confirm) return { error: 'Кнопка подтверждения Payment Portfolio недоступна.', businessCenterId: bcId, adAccountId: adId, portfolio, url: location.href };
    const before = location.href;
    confirm.click();
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      await pause(300);
      if (location.href !== before || location.pathname !== '/account/payment-setup') {
        return { success: true, linked: true, businessCenterId: bcId, adAccountId: adId, portfolio, url: location.href, at: Date.now() };
      }
      const body = clean(document.body?.innerText);
      if (/successfully|setup complete|completed/i.test(body)) {
        return { success: true, linked: true, businessCenterId: bcId, adAccountId: adId, portfolio, url: location.href, at: Date.now() };
      }
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error-message"],[class*="feedback"]')]
        .filter(visible).map((element) => clean(element.textContent)).find((value) => value && value.length < 260);
      if (alert) return { error: alert, businessCenterId: bcId, adAccountId: adId, portfolio, url: location.href };
    }
    return { pending: true, linked: false, businessCenterId: bcId, adAccountId: adId, portfolio, url: location.href, at: Date.now() };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}
