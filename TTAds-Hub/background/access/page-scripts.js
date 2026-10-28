// DOM-адаптеры Business Center: запрос доступа, self-service transfer и Payment Portfolio.
// Каждая функция самодостаточна и исполняется chrome.scripting в MAIN world.

export async function inspectAccountManagementInPage(expectedBcId = '', waitMs = 15000) {
  try {
    if (location.origin !== 'https://business.tiktok.com') return { error: 'Откройте TikTok Business Center.' };
    const bcId = new URL(location.href).searchParams.get('org_id') || '';
    if (expectedBcId && bcId !== String(expectedBcId)) return { error: 'Открыт другой Business Center.' };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const end = Date.now() + Math.max(1000, Number(waitMs) || 0);
    while (Date.now() < end && !/Advertiser accounts|Finance access required|Payment management/i.test(document.body?.innerText || '')) await pause(250);
    const body = clean(document.body?.innerText);
    const accounts = [];
    const seen = new Set();
    for (const row of document.querySelectorAll('tr,[role="row"],[class*="table-row"]')) {
      const text = clean(row.textContent);
      const match = text.match(/\bID\s*:\s*(\d{5,30})\b/i);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      accounts.push({ id: match[1], text: text.slice(0, 240), approved: /\bApproved\b/i.test(text) });
    }
    return {
      businessCenterId: bcId,
      accounts,
      canAddAdvertiser: /Add advertiser account/i.test(body),
      canRequestAccess: /Add advertiser account/i.test(body),
      transferEntryVisible: /Transfer advertiser accounts/i.test(body),
      financeRoleRequired: /Finance access required/i.test(body),
      financeManager: !/Finance access required/i.test(body) && /Payment management/i.test(body),
      url: location.href,
      at: Date.now()
    };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

export async function requestAdvertiserAccessInPage(plan, submit = true) {
  try {
    if (location.origin !== 'https://business.tiktok.com' || location.pathname !== '/manage/accounts/adv') {
      return { error: 'Открыта не страница Accounts → Advertiser accounts.' };
    }
    const params = new URL(location.href).searchParams;
    if (plan.businessCenterId && params.get('org_id') !== String(plan.businessCenterId)) return { error: 'Открыт другой Business Center.' };
    const accountId = String(plan.accountId || '');
    if (!/^\d{5,30}$/.test(accountId)) return { error: 'Некорректный ID рекламного кабинета.' };
    const permission = ['Admin', 'Operator', 'Analyst'].includes(plan.permission) ? plan.permission : 'Admin';
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
    };
    const exact = (text, root = document) => [...root.querySelectorAll('button,[role="button"],label,div,span,p')]
      .filter((element) => visible(element) && clean(element.textContent) === text)
      .sort((a, b) => clean(a.parentElement?.textContent).length - clean(b.parentElement?.textContent).length);
    const clickText = (text) => {
      const target = exact(text)[0];
      if (!target) return false;
      (target.closest('button,[role="button"],label,[class*="card"],[class*="item"]') || target).click();
      return true;
    };
    const waitFor = async (pattern, ms = 12000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (pattern.test(clean(document.body?.innerText))) return true;
        await pause(200);
      }
      return false;
    };
    const enabledButton = (...labels) => [...document.querySelectorAll('button')]
      .find((button) => visible(button) && !button.disabled && labels.includes(clean(button.textContent)));
    const waitForEnabled = async (labels, ms = 12000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const button = enabledButton(...labels);
        if (button) return button;
        await pause(200);
      }
      return null;
    };
    const setInput = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
    };

    if (!clickText('Add advertiser account')) return { error: 'TikTok не показал Add advertiser account.' };
    if (!await waitFor(/Create New[\s\S]{0,300}Request Access/i)) return { error: 'Не открылось окно Add advertiser account.' };
    if (!clickText('Request Access')) return { error: 'В этом Business Center недоступен Request Access.' };
    await pause(150);
    const firstNext = enabledButton('Next');
    if (!firstNext) return { error: 'Кнопка Next недоступна на выборе Request Access.' };
    firstNext.click();
    if (!await waitFor(/Request access to advertiser account/i)) return { error: 'Не открылась форма Request Access.' };

    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const idInput = inputs.find((input) => /account id/i.test(input.placeholder || '')) || inputs[0];
    if (!idInput) return { error: 'TikTok не показал поле Account ID.' };
    setInput(idInput, accountId);
    // TikTok резолвит ID асинхронно. До ответа кнопка Next disabled, а карточки
    // разрешений могут ещё не существовать в DOM.
    const resolved = await waitFor(/Access permission|Manage account|View ads/i, 12000);
    if (!resolved) {
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error"]')].filter(visible).map((element) => clean(element.textContent)).find(Boolean);
      return { error: alert || 'TikTok не смог найти рекламный кабинет по Account ID.', accountId };
    }
    const permissionTarget = exact(permission).find((element) => /Manage|View ads/i.test(clean(element.parentElement?.textContent))) || exact(permission)[0];
    if (!permissionTarget) return { error: `Не найден уровень доступа ${permission}.` };
    (permissionTarget.closest('button,[role="radio"],label,[class*="card"],[class*="option"]') || permissionTarget).click();
    const next = await waitForEnabled(['Next'], 12000);
    if (!next) {
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error"]')].filter(visible).map((element) => clean(element.textContent)).find(Boolean);
      return { error: alert || 'TikTok не принял Account ID или уровень доступа.', accountId, permission };
    }
    next.click();
    await pause(400);
    if (!submit) return { prepared: true, accountId, permission, businessCenterId: plan.businessCenterId, url: location.href, at: Date.now() };

    // Шаг Asset sharing необязательный. Ничего не выбираем и отправляем запрос владельцу.
    const finalEnd = Date.now() + 12000;
    let finalButton = null;
    while (Date.now() < finalEnd && !finalButton) {
      finalButton = enabledButton('Request access', 'Send request', 'Submit', 'Confirm');
      if (!finalButton) {
        const assetSharing = /Asset sharing/i.test(clean(document.body?.innerText));
        // На живой форме без выбранных assets TikTok завершает запрос кнопкой Skip.
        // Это финальный submit, а не переход к ещё одному промежуточному шагу.
        const skip = assetSharing ? enabledButton('Skip') : null;
        if (skip) { finalButton = skip; break; }
        const stepNext = enabledButton('Next');
        if (stepNext && assetSharing) stepNext.click();
        await pause(250);
      }
    }
    if (!finalButton) return { needsUser: true, reason: 'review', accountId, permission, businessCenterId: plan.businessCenterId, url: location.href };
    finalButton.click();
    const doneEnd = Date.now() + 15000;
    while (Date.now() < doneEnd) {
      await pause(250);
      const body = clean(document.body?.innerText);
      if (/request (?:was )?sent|request submitted|pending approval|successfully|account added|automatically approved/i.test(body) || !/Request access to advertiser account/i.test(body)) {
        const automaticallyApproved = /automatically approved/i.test(body);
        return { success: true, requested: true, automaticallyApproved, ownerApprovalRequired: !automaticallyApproved, accountId, permission, businessCenterId: plan.businessCenterId, url: location.href, at: Date.now() };
      }
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error-message"],[class*="feedback"]')]
        .filter(visible).map((element) => clean(element.textContent)).find((value) => value && value.length < 260);
      if (alert) return { error: alert, accountId, permission, businessCenterId: plan.businessCenterId };
    }
    return { pending: true, ownerApprovalRequired: true, accountId, permission, businessCenterId: plan.businessCenterId, url: location.href, at: Date.now() };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

export async function transferAdvertisersInPage(plan, submit = false) {
  try {
    if (location.origin !== 'https://business.tiktok.com' || location.pathname !== '/manage/accounts/adv') return { error: 'Открыта не страница Advertiser accounts.' };
    const currentBc = new URL(location.href).searchParams.get('org_id') || '';
    if (plan.sourceBusinessCenterId && currentBc !== String(plan.sourceBusinessCenterId)) return { error: 'Открыт другой исходный Business Center.' };
    const targetBc = String(plan.targetBusinessCenterId || '');
    const accountIds = [...new Set((Array.isArray(plan.accountIds) ? plan.accountIds : []).map(String).filter((id) => /^\d{5,30}$/.test(id)))].slice(0, 30);
    if (!/^\d{5,30}$/.test(targetBc)) return { error: 'Некорректный ID получателя Business Center.' };
    if (!accountIds.length) return { error: 'Не выбраны рекламные кабинеты для передачи.' };
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const exact = (text) => [...document.querySelectorAll('button,[role="button"],div,span,p')]
      .filter((element) => visible(element) && clean(element.textContent) === text)
      .sort((a, b) => clean(a.parentElement?.textContent).length - clean(b.parentElement?.textContent).length);
    const click = (text) => {
      const element = exact(text)[0];
      if (!element) return false;
      (element.closest('button,[role="button"],[role="menuitem"],[class*="item"]') || element).click();
      return true;
    };
    const enabled = (...labels) => [...document.querySelectorAll('button')].find((button) => visible(button) && !button.disabled && labels.includes(clean(button.textContent)));
    const setInput = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
    };

    if (!click('More')) return { error: 'Self-service transfer недоступен: рядом с Add advertiser account нет меню More.', ineligible: true };
    await pause(250);
    if (!click('Transfer advertiser accounts')) return { error: 'TikTok не показал Transfer advertiser accounts. Функция доступна только eligible-клиентам.', ineligible: true };
    await pause(450);
    const targetInput = [...document.querySelectorAll('input')].filter(visible).find((input) => /business center/i.test(input.placeholder || '')) || [...document.querySelectorAll('input')].filter(visible)[0];
    if (!targetInput) return { error: 'Не найдено поле recipient Business Center ID.' };
    setInput(targetInput, targetBc);
    const firstNext = enabled('Next');
    if (!firstNext) return { error: 'TikTok не принял Business Center получателя.' };
    firstNext.click();
    await pause(500);

    const selected = [];
    for (const id of accountIds) {
      const row = [...document.querySelectorAll('tr,[role="row"],[class*="table-row"],[class*="account"]')]
        .find((element) => visible(element) && clean(element.textContent).includes(id));
      const host = row?.querySelector('input[type="checkbox"],ks-checkbox-xv7ohjev,[role="checkbox"]');
      const native = host?.shadowRoot?.querySelector('input[type="checkbox"]') || (host?.matches?.('input[type="checkbox"]') ? host : null);
      const checked = native?.checked || host?.getAttribute?.('aria-checked') === 'true';
      if (host && !checked) (visible(host) ? host : native || host).click();
      if (host) selected.push(id);
    }
    if (!selected.length) return { error: 'Выбранные РК не найдены среди доступных для transfer.', accountIds };
    let next = enabled('Next');
    if (!next) return { error: 'Нельзя продолжить transfer: проверьте eligibility выбранных РК.', selected };
    next.click();
    await pause(450);
    next = enabled('Next');
    if (next) { next.click(); await pause(450); }
    const summary = { sourceBusinessCenterId: currentBc, targetBusinessCenterId: targetBc, accountIds: selected, maxPerRequest: 30, url: location.href, at: Date.now() };
    if (!submit) return { prepared: true, reviewRequired: true, ...summary };
    const confirm = enabled('Confirm', 'Send transfer request', 'Submit transfer');
    if (!confirm) return { needsUser: true, reason: 'review', ...summary };
    confirm.click();
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      await pause(300);
      const body = clean(document.body?.innerText);
      if (/transfer request (?:was )?(?:sent|submitted)|pending approval|successfully/i.test(body)) return { success: true, transferRequested: true, recipientApprovalRequired: true, ...summary, completedAt: Date.now() };
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error"]')].filter(visible).map((element) => clean(element.textContent)).find((value) => value && value.length < 300);
      if (alert) return { error: alert, ...summary };
    }
    return { pending: true, recipientApprovalRequired: true, ...summary };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}

export async function linkAccountsToPortfolioInPage(plan, submit = true) {
  try {
    if (location.origin !== 'https://business.tiktok.com') return { error: 'Откройте TikTok Business Center.' };
    const bcId = new URL(location.href).searchParams.get('org_id') || '';
    if (plan.businessCenterId && bcId !== String(plan.businessCenterId)) return { error: 'Открыт другой Business Center.' };
    const requestedIds = [...new Set((Array.isArray(plan.accountIds) ? plan.accountIds : []).map(String).filter((id) => /^\d{5,30}$/.test(id)))];
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const body = () => clean(document.body?.innerText);
    const exact = (labels) => [...document.querySelectorAll('button,[role="button"],div,span,a')]
      .filter((element) => visible(element) && labels.includes(clean(element.textContent)))
      .sort((a, b) => clean(a.parentElement?.textContent).length - clean(b.parentElement?.textContent).length);
    const clickAny = (...labels) => {
      const target = exact(labels)[0];
      if (!target) return false;
      (target.closest('button,a,[role="button"],[class*="item"]') || target).click();
      return true;
    };
    if (/Finance access required/i.test(body())) return { error: 'Нужна роль Finance Manager.', needsFinanceRole: true, businessCenterId: bcId };
    const openEnd = Date.now() + 15000;
    while (Date.now() < openEnd && !/Payment Portfolio|Payment management/i.test(body())) await pause(250);
    const currentText = body();
    const alreadyLinked = requestedIds.filter((id) => currentText.includes(id));
    const portfolioId = currentText.match(/Payment Portfolio[\s\S]{0,160}?\bID\s*:\s*(\d{5,30})\b/i)?.[1] || String(plan.portfolioId || '');
    if (requestedIds.length && alreadyLinked.length === requestedIds.length) {
      return {
        success: true,
        linked: true,
        alreadyLinked: true,
        businessCenterId: bcId,
        portfolioId,
        accountIds: alreadyLinked,
        url: location.href,
        at: Date.now()
      };
    }
    if (!clickAny('+Add accounts to link', 'Add accounts to link', 'Link now', 'Add accounts')) {
      return { error: 'TikTok не показал Add accounts to link. Возможно, все РК уже связаны или Portfolio ещё не создан.', businessCenterId: bcId };
    }
    await pause(500);
    const scope = [...document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="drawer"]')].filter(visible).at(-1) || document;
    const selected = [];
    const rows = [...scope.querySelectorAll('tr,[role="row"],[class*="table-row"],[class*="account"]')].filter(visible);
    for (const row of rows) {
      const text = clean(row.textContent);
      const id = text.match(/\b(\d{5,30})\b/)?.[1] || '';
      if (requestedIds.length && !requestedIds.includes(id)) continue;
      const host = row.querySelector('input[type="checkbox"],ks-checkbox-xv7ohjev,[role="checkbox"]');
      const native = host?.shadowRoot?.querySelector('input[type="checkbox"]') || (host?.matches?.('input[type="checkbox"]') ? host : null);
      const checked = native?.checked || host?.getAttribute?.('aria-checked') === 'true';
      if (host && !checked) (visible(host) ? host : native || host).click();
      if (host) selected.push(id || text.slice(0, 80));
    }
    if (!selected.length) return { error: 'Нет доступных несвязанных РК для выбранного Portfolio.', businessCenterId: bcId };
    const enabled = (...labels) => [...scope.querySelectorAll('button')].find((button) => visible(button) && !button.disabled && labels.includes(clean(button.textContent)));
    let next = enabled('Next');
    if (next) { next.click(); await pause(400); }
    const summary = { businessCenterId: bcId, portfolioId, accountIds: selected, at: Date.now(), url: location.href };
    if (!submit) return { prepared: true, ...summary };
    const confirm = [...document.querySelectorAll('button')].find((button) => visible(button) && !button.disabled && ['Confirm', 'Link accounts', 'Save'].includes(clean(button.textContent)));
    if (!confirm) return { needsUser: true, reason: 'review', ...summary };
    confirm.click();
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      await pause(300);
      const text = body();
      if (/successfully linked|accounts linked|success/i.test(text)) return { success: true, linked: true, ...summary, completedAt: Date.now() };
      const alert = [...document.querySelectorAll('[role="alert"],[class*="error"]')].filter(visible).map((element) => clean(element.textContent)).find((value) => value && value.length < 300);
      if (alert) return { error: alert, ...summary };
    }
    return { pending: true, ...summary };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 300) };
  }
}
