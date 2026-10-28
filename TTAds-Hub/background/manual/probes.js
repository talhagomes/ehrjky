// Функции, которые выполняются ВНУТРИ страницы TikTok Ads Manager (chrome.scripting, world: MAIN).
// Каждая функция обязана быть самодостаточной: без импортов и обращений к внешним переменным модуля.

// Какая цель кампании выбрана в интерфейсе: 'app' | 'lead' | 'sales' | null
export function selectedGoal() {
  const visible = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const title = (e) => ((e.querySelector('.cs-campaign-option__title .truncate,.cs-campaign-option__title') || e).textContent || '').trim().toLowerCase();
  for (const e of document.querySelectorAll('.cs-campaign-option[data-cs-selected="true"]')) {
    if (!visible(e)) continue;
    const n = (e.getAttribute('data-cs-name') || '').replace(/[\s_-]/g, '').toLowerCase(), t = title(e);
    if (n === 'apppromotion' || t === 'app promotion') return 'app';
    if (n === 'leadgeneration' || t === 'lead generation') return 'lead';
    if (n === 'sales' || t === 'sales') return 'sales';
  }
  return null;
}

// Проверяет (и при click=true открывает) отображение Manual-кампании в редакторе черновика.
// Возвращает { manual, shown } либо { error }.
export async function manualView(ctx, click) {
  const onDraft = () => {
    const u = new URL(location.href);
    return u.hostname === 'ads.tiktok.com' && u.searchParams.get('aadvid') === ctx.account &&
      u.searchParams.get('campaign_draft_id') === ctx.draft && u.pathname.endsWith('/create/campaign');
  };
  const visible = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  let clicked = false;
  const deadline = Date.now() + (click ? 25000 : 0);
  do {
    if (!onDraft()) return { error: 'Вкладка переключилась на другой черновик.' };
    const selected = Array.from(document.querySelectorAll('[data-cs-name][data-cs-selected="true"], [role="radio"][aria-checked="true"]')).find((e) => {
      const t = e.querySelector('.cs-campaign-option__title');
      const text = ((t?.querySelector('.truncate') || t)?.textContent || e.textContent).trim();
      return visible(e) && (/_Manual$/i.test(e.getAttribute('data-cs-name') || '') ||
        /^(Chiến dịch thủ công|Manual campaign|Ручная кампания)(?:\s|$)/i.test(text));
    });
    if (selected) return { manual: true, shown: true };
    const label = Array.from(document.querySelectorAll('[data-testid="lego-hybrid-section-item-displayText"]'))
      .find((e) => visible(e) && /\(\s*(?:Manual|Thủ công|Ручн\S*|Вручную)\s*\)/i.test(e.textContent));
    if (!click) return { manual: Boolean(label), shown: false };
    const op = label?.parentElement?.querySelector('[data-testid="lego-hybrid-section-item-operation"]');
    if (!clicked && op && visible(op) && op.disabled !== true && !op.hasAttribute('disabled') && op.getAttribute('aria-disabled') !== 'true') {
      op.click();
      clicked = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return { error: 'Не удалось открыть Manual-вариант. Нажмите кнопку ещё раз.' };
}

// Окно выбора цели кампании: определяет цель и (при click=true) нажимает «Confirm» в Shadow DOM.
export function inspectCreationModal(account, click, expected) {
  const u = new URL(location.href);
  if (u.origin !== 'https://ads.tiktok.com' || u.searchParams.get('aadvid') !== account || u.searchParams.has('campaign_draft_id')) {
    return { eligible: false, error: 'Другой кабинет или черновик уже открыт.' };
  }
  const title = (e) => ((e.querySelector('.cs-campaign-option__title .truncate,.cs-campaign-option__title') || e).textContent || '').trim().toLowerCase();
  let goal = null, section = null;
  for (const e of document.querySelectorAll('.cs-campaign-option[data-cs-selected="true"],.cs-objective-option[data-cs-selected="true"]')) {
    const holder = e.closest('[data-testid^="campaign-selector-"]');
    if (!holder) continue;
    const n = (e.getAttribute('data-cs-name') || '').replace(/[\s_-]/g, '').toLowerCase(), t = title(e);
    if (n === 'apppromotion' || t === 'app promotion') goal = 'app';
    if (n === 'leadgeneration' || t === 'lead generation') goal = 'lead';
    if (n === 'sales' || t === 'sales') goal = 'sales';
    if (goal) section = holder;
  }
  if (!goal) return { eligible: false, error: 'Выберите App Promotion, Lead Generation или Sales.' };
  if (expected && goal !== expected) return { eligible: false, error: 'Цель изменилась. Откройте панель заново.' };
  const usable = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
  };
  const buttons = [];
  const find = (root) => {
    if (root.shadowRoot) find(root.shadowRoot);
    for (const e of root.querySelectorAll('*')) {
      if (e.getAttribute('part') === 'confirmButton' && usable(e)) buttons.push(e);
      if (e.shadowRoot) find(e.shadowRoot);
    }
  };
  find(section);
  if (buttons.length !== 1) return { eligible: false, error: 'Кнопка Confirm в окне TikTok не найдена.' };
  if (click) buttons[0].click();
  return { eligible: true, clicked: Boolean(click), objective: goal };
}
