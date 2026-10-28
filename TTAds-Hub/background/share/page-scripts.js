// DOM-автоматизация раздела Partners в TikTok Business Center (/manage/company/partner?org_id=…;
// старый /manage/partner остаётся допустимым для обратной совместимости):
// шаринг РК в другой BC и принятие партнёрского приглашения на стороне получателя.
// Функции самодостаточны: chrome.scripting сериализует их целиком, внешних переменных и импортов быть не может.
// Подписи кнопок TikTok различаются между версиями интерфейса, поэтому для каждого шага есть набор вариантов.

export async function partnerFlowInPage(task = {}) {
  const trail = [];
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = (value) => clean(value).replace(/^[+＋]\s*/, '').toLowerCase();
  const mask = (value) => clean(value).replace(/\d{6,}/g, (m) => `…${m.slice(-4)}`);
  // Фоновая вкладка не проигрывает CSS-переходы, поэтому прозрачность не учитываем.
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const disabled = (el) => Boolean(el?.disabled || el?.getAttribute?.('aria-disabled') === 'true' || /(^|\s|-)disabled(\s|$)/i.test(String(el?.className?.baseVal ?? el?.className ?? '')));
  const until = async (fn, ms = 12000, step = 200) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await pause(step);
    }
    return null;
  };
  const bodyText = () => clean(document.body?.innerText);
  const CLICKABLE = 'button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="radio"],[role="checkbox"],a,label,li,div,span,p';
  const INTERACTIVE = 'button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="radio"],[role="checkbox"],a,label,li';

  const layers = () => {
    const found = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="drawer" i],[class*="side-sheet" i]')]
      .filter((el) => visible(el) && el.querySelector('button,input,[role="button"]'));
    return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
  };
  const scope = () => layers().at(-1) || document;

  const findByText = (labels, root = document, exact = true, maxLength = 80) => {
    const wanted = labels.map(norm).filter(Boolean);
    const matches = [];
    for (const el of root.querySelectorAll(CLICKABLE)) {
      if (!visible(el)) continue;
      const value = norm(el.textContent);
      if (!value || value.length > maxLength) continue;
      if (wanted.some((label) => (exact ? value === label : value.includes(label)))) matches.push(el);
    }
    const rank = (el) => (el.matches(INTERACTIVE) ? 0 : 1);
    matches.sort((a, b) => rank(a) - rank(b) || norm(a.textContent).length - norm(b.textContent).length);
    for (const el of matches) {
      const target = el.closest(INTERACTIVE) || el;
      if (!disabled(target)) return target;
    }
    return null;
  };

  const press = (el) => {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    const options = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', options));
    el.dispatchEvent(new MouseEvent('mousedown', options));
    el.dispatchEvent(new PointerEvent('pointerup', options));
    el.dispatchEvent(new MouseEvent('mouseup', options));
    el.click();
  };

  const deepAll = (selector, root = document) => {
    const out = [...root.querySelectorAll(selector)];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepAll(selector, el.shadowRoot));
    return out;
  };

  const setValue = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    input.focus();
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  };
  const pressEnter = (input) => {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
    }
  };

  const textInputs = (root) => deepAll('input:not([type]),input[type="text"],input[type="search"],input[type="number"],textarea', root)
    .filter((el) => visible(el) && !el.disabled && !el.readOnly);

  const checkboxOf = (row) => row.querySelector('input[type="checkbox"],[role="checkbox"]')
    || [...row.querySelectorAll('*')].find((el) => el.tagName.toLowerCase().startsWith('ks-checkbox'));
  const checkedState = (box) => {
    if (!box) return null;
    if (box.matches?.('input[type="checkbox"]')) return box.checked;
    const native = box.shadowRoot?.querySelector('input[type="checkbox"]') || box.querySelector?.('input[type="checkbox"]');
    if (native) return native.checked;
    const aria = box.getAttribute?.('aria-checked');
    if (aria) return aria === 'true';
    return /(^|\s|-)checked(\s|$)/i.test(String(box.className || ''));
  };
  const toggleOn = async (box) => {
    if (checkedState(box)) return true;
    const clickable = visible(box) ? box : (box.closest('label') || box.parentElement || box);
    press(clickable);
    await pause(160);
    if (!checkedState(box) && box.matches?.('input[type="checkbox"]')) { box.click(); await pause(120); }
    return checkedState(box) !== false;
  };
  const rowFor = (root, id) => {
    const rows = [...root.querySelectorAll('tr,[role="row"],li,label,[class*="row" i],[class*="item" i],[class*="option" i],[class*="cell" i],div')]
      .filter((el) => visible(el) && clean(el.textContent).includes(id) && checkboxOf(el));
    rows.sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);
    return rows[0] || null;
  };

  const verification = () => {
    const text = layers().map((el) => clean(el.innerText)).join(' ');
    if (/verify (?:your )?identity|verification code|security verification|protect your identity|enter (?:the )?(?:verification )?code|two-step|2-step|captcha|slide to|drag the slider/i.test(text)) return 'verification';
    const captcha = document.querySelector('iframe[src*="captcha" i],#captcha_container,[id*="captcha" i]');
    return captcha && visible(captcha) ? 'captcha' : '';
  };
  const messages = () => [...document.querySelectorAll('[role="alert"],[class*="toast" i],[class*="message" i],[class*="notification" i],[class*="notice" i],[class*="error" i],[class*="feedback" i]')]
    .filter(visible).map((el) => clean(el.textContent)).filter((value) => value && value.length < 260);
  const errorText = () => messages().find((value) => /fail|error|invalid|not exist|doesn['’]t exist|does not exist|already|unable|cannot|can['’]t|not allowed|limit|exceed|no permission|incorrect|try again|not found|ошибк|не удалось/i.test(value)) || '';
  const successText = () => messages().find((value) => /success|invitation (?:has been |was )?sent|has been (?:added|shared|assigned)|added successfully|shared successfully|assigned successfully|request sent/i.test(value))
    || (/add partner request sent|partner request sent/i.test(bodyText()) ? 'Add partner request sent.' : '');
  const noAccess = () => /no permission|don['’]t have permission|do not have permission|permission denied|only (?:bc )?admins? can|not a member of this business center/i.test(bodyText());

  const snapshot = () => {
    try {
      const pick = (selector, max, limit = 60) => [...new Set([...document.querySelectorAll(selector)].filter(visible)
        .map((el) => mask(el.textContent)).filter((value) => value && value.length <= limit))].slice(0, max);
      return {
        path: location.pathname,
        headings: pick('h1,h2,h3,h4,[role="heading"],[class*="title" i]', 15),
        buttons: pick('button,[role="button"],[role="tab"],[role="menuitem"]', 40, 40),
        inputs: textInputs(document).slice(0, 12).map((el) => mask(el.placeholder || el.getAttribute('aria-label') || el.name || el.type)),
        messages: messages().slice(0, 5).map(mask),
        dialogs: layers().length,
        at: Date.now()
      };
    } catch { return null; }
  };
  const fail = (step, error, extra = {}) => ({ error, step, trail, diagnostics: snapshot(), at: Date.now(), ...extra });
  const askUser = (step, reason, hint, extra = {}) => ({ needsUser: true, reason, hint, step, trail, diagnostics: snapshot(), at: Date.now(), ...extra });

  const waitOutcome = async (dialog, ms = 30000) => until(() => {
    const check = verification();
    if (check) return { needsUser: check };
    const error = errorText();
    if (error) return { error };
    const success = successText();
    if (success) return { success };
    if (dialog && dialog !== document && !visible(dialog)) return { success: 'dialog-closed' };
    return null;
  }, ms, 250);

  try {
    if (location.origin !== 'https://business.tiktok.com') return fail('guard', 'Откройте TikTok Business Center.');
    const orgId = new URL(location.href).searchParams.get('org_id') || '';
    if (task.businessCenterId && orgId && orgId !== String(task.businessCenterId)) return fail('guard', 'Открыт другой Business Center.');

    const pageReady = await until(() => noAccess() || findByText(['Add partner', 'Add partners', 'Add Partner', 'Add'], document, true) || /partners?/i.test(bodyText()), 25000, 250);
    if (!pageReady) return fail('ready', 'TikTok не загрузил раздел Partners. Проверьте авторизацию в Business Center.');
    if (noAccess()) return fail('ready', 'Нет прав Admin в этом Business Center — TikTok не даёт управлять партнёрами.', { noAccess: true });
    await pause(600);
    trail.push('ready');

    /* ---------- Принять приглашение (сторона получателя) ---------- */
    if (task.action === 'accept') {
      const fromId = String(task.fromBusinessCenterId || '');
      if (!/^\d{5,30}$/.test(fromId)) return fail('guard', 'Не указан BC-отправитель приглашения.');
      // Вкладки часто содержат счётчик («Pending invitations (2)») — ищем по вхождению, начиная с role=tab.
      const tabLike = [...document.querySelectorAll('[role="tab"],[class*="tab" i]')]
        .filter((el) => visible(el) && clean(el.textContent).length <= 40 && /invitation|pending|приглашени/i.test(clean(el.textContent)));
      const reveal = tabLike.sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0]
        || findByText(['Pending invitations', 'Pending invitation', 'Invitations', 'Received invitations', 'Partner invitations', 'Pending'], document, true)
        || findByText(['pending invitation', 'received invitation', 'partner invitation'], document, false, 40);
      if (reveal) { press(reveal.closest(INTERACTIVE) || reveal); trail.push('invitations-tab'); await pause(800); }
      const findAccept = () => {
        const buttons = [...document.querySelectorAll('button,[role="button"],a')]
          .filter((el) => visible(el) && !disabled(el) && /^(accept|approve|agree|accept invitation)$/i.test(clean(el.textContent)));
        for (const button of buttons) {
          let node = button;
          for (let depth = 0; depth < 9 && node; depth += 1, node = node.parentElement) {
            if (clean(node.textContent).includes(fromId)) return button;
          }
        }
        return null;
      };
      const accept = await until(findAccept, 10000, 300);
      if (!accept) return askUser('accept', 'manual-accept', `Примите приглашение от BC ${fromId} в разделе Partners этого Business Center.`, { fromBusinessCenterId: fromId });
      press(accept);
      trail.push('accept');
      await pause(500);
      const confirm = findByText(['Accept', 'Confirm', 'OK', 'Agree'], scope(), true);
      if (confirm && confirm !== accept) { press(confirm); trail.push('accept-confirm'); }
      const outcome = await waitOutcome(scope() === document ? null : scope(), 20000);
      if (outcome?.needsUser) return askUser('accept', outcome.needsUser, 'TikTok запросил проверку личности. Завершите её во вкладке.', { fromBusinessCenterId: fromId });
      if (outcome?.error) return fail('accept', outcome.error, { fromBusinessCenterId: fromId });
      return { success: true, accepted: true, fromBusinessCenterId: fromId, businessCenterId: orgId, trail, at: Date.now() };
    }

    /* ---------- Шаринг РК партнёру (сторона владельца) ---------- */
    const targetId = String(task.targetBusinessCenterId || '');
    const accountIds = [...new Set((Array.isArray(task.accountIds) ? task.accountIds : []).map(String).filter((id) => /^\d{5,30}$/.test(id)))];
    const permission = ['Admin', 'Operator', 'Analyst'].includes(task.permission) ? task.permission : 'Admin';
    if (!/^\d{5,30}$/.test(targetId)) return fail('guard', 'Некорректный ID Business Center получателя.');
    if (targetId === orgId) return fail('guard', 'Нельзя расшарить РК в тот же Business Center.');
    if (!accountIds.length) return fail('guard', 'Не выбраны рекламные кабинеты.');

    let mode = 'new-partner', pendingPartner = false;
    const partnerRow = () => [...document.querySelectorAll('tr,[role="row"],[class*="row" i],li')]
      .filter((el) => visible(el) && clean(el.textContent).includes(targetId) && el.querySelector('button,[role="button"],a,[class*="icon" i]'))
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0] || null;
    const existing = task.forceExisting || partnerRow();

    if (existing) {
      mode = 'existing-partner';
      const row = partnerRow();
      if (!row) return fail('partner-row', `BC ${targetId} не найден в списке партнёров.`, { mode });
      // Партнёрство ещё не принято получателем — после шаринга попробуем принять приглашение.
      pendingPartner = /pending|invited|awaiting|waiting|ожида/i.test(clean(row.textContent));
      const actionLabels = ['Share assets', 'Assign assets', 'Add assets', 'Share asset', 'Assign asset', 'Manage assets', 'Edit assets', 'Share', 'Assign', 'Manage', 'View details', 'Details', 'View', 'Edit'];
      let action = findByText(actionLabels, row, true);
      if (!action) {
        const more = [...row.querySelectorAll('button,[role="button"],[class*="more" i],[class*="icon" i]')].filter(visible).find((el) => !clean(el.textContent) || /^(…|\.\.\.|⋯|more)$/i.test(clean(el.textContent)));
        if (more) { press(more); await pause(400); action = findByText(actionLabels, document, true); }
      }
      if (!action) { press(row); await pause(700); }
      else press(action);
      trail.push('partner-action');
      await pause(900);
      if (!layers().length || !scope().querySelector('input[type="checkbox"],[role="checkbox"]')) {
        const shareButton = await until(() => findByText(['Share assets', 'Assign assets', 'Add assets', 'Share asset', 'Assign asset', 'Add asset', 'Share', 'Assign'], document, true), 8000);
        if (shareButton) { press(shareButton); trail.push('share-assets'); await pause(900); }
      }
    } else {
      const add = findByText(['Add partner', 'Add partners', 'Add Partner', 'Add'], document, true);
      if (!add) return fail('add-partner', 'TikTok не показал кнопку Add partner. Нужна роль Admin в исходном BC.');
      press(add);
      trail.push('add-partner');
      const idInput = await until(() => {
        const root = scope();
        const inputs = textInputs(root === document ? document : root);
        return inputs.find((el) => /business center|bc id|partner|\bid\b/i.test(`${el.placeholder} ${el.getAttribute('aria-label') || ''} ${el.name || ''}`)) || (root !== document ? inputs[0] : null);
      }, 12000, 250);
      if (!idInput) return fail('enter-id', 'Не открылась форма Add partner (поле Business Center ID).');
      setValue(idInput, targetId);
      trail.push('enter-id');
      // Вопрос о media agency partnership задают не всем — отвечаем «No», это безопасный вариант по умолчанию.
      const dialog = scope();
      if (/agency/i.test(clean(dialog.textContent))) {
        const no = findByText(['No'], dialog, true);
        if (no) { press(no); trail.push('agency-no'); await pause(250); }
      }
      const next = await until(() => findByText(['Next', 'Continue', 'Search', 'Confirm', 'Verify'], scope(), true), 6000);
      if (!next) return fail('enter-id', 'TikTok не принял ID Business Center получателя.', { mode });
      press(next);
      trail.push('next');
      // В UI 28.10.2026 первый Next может только запустить поиск ID. После появления
      // карточки найденного BC нужен второй Next; если lookup уже завершён, сразу откроются assets.
      let step = await until(() => {
        const error = errorText();
        if (error) return { error };
        const check = verification();
        if (check) return { needsUser: check };
        const root = scope();
        if (root.querySelector('input[type="checkbox"],[role="checkbox"]') || [...root.querySelectorAll('*')].some((el) => el.tagName.toLowerCase().startsWith('ks-checkbox'))) return { assets: true };
        if (/select assets to share|account permissions/i.test(clean(root.textContent))) return { assets: true };
        const resolved = [...root.querySelectorAll('div,section,article,li,tr,[role="row"]')]
          .filter(visible).find((el) => clean(el.textContent).includes(targetId) && !el.contains(idInput));
        if (resolved) return { resolved: true };
        return null;
      }, 15000, 250);
      if (step?.resolved) {
        const proceed = await until(() => findByText(['Next', 'Continue'], scope(), true), 6000, 200);
        if (!proceed) return fail('enter-id', 'TikTok нашёл BC, но не разрешил перейти к выбору активов.', { mode });
        press(proceed);
        trail.push('next-resolved');
        step = await until(() => {
          const error = errorText();
          if (error) return { error };
          const check = verification();
          if (check) return { needsUser: check };
          const root = scope();
          if (root.querySelector('input[type="checkbox"],[role="checkbox"]') || [...root.querySelectorAll('*')].some((el) => el.tagName.toLowerCase().startsWith('ks-checkbox'))) return { assets: true };
          if (/select assets to share|account permissions/i.test(clean(root.textContent))) return { assets: true };
          return null;
        }, 15000, 250);
      }
      if (step?.needsUser) return askUser('enter-id', step.needsUser, 'TikTok запросил проверку личности. Завершите её во вкладке и нажмите «Продолжить».', { mode });
      if (step?.error) return fail('enter-id', step.error, { mode, alreadyPartner: /already/i.test(step.error) });
      if (!step) return fail('enter-id', 'После ввода ID не открылся выбор активов.', { mode });
    }

    /* ---------- Выбор РК и прав ---------- */
    const assetScope = () => {
      const root = scope();
      return root !== document && (root.querySelector('input[type="checkbox"],[role="checkbox"]') || /ad account|advertiser/i.test(clean(root.textContent))) ? root : document;
    };
    let root = assetScope();
    const assetType = findByText(['Ad accounts', 'Ad account', 'Advertiser accounts', 'Advertiser account', 'Advertisers'], root, true)
      || findByText(['ad accounts', 'advertiser accounts'], root, false, 40);
    if (assetType) { press(assetType); trail.push('asset-type'); await pause(700); root = assetScope(); }

    const selected = [], missing = [];
    for (const id of accountIds) {
      let row = rowFor(root, id);
      if (!row) {
        const search = textInputs(root === document ? document : root).find((el) => /search|id|name|поиск/i.test(`${el.placeholder} ${el.getAttribute('aria-label') || ''}`));
        if (search) {
          setValue(search, id);
          pressEnter(search);
          row = await until(() => rowFor(assetScope(), id), 5000, 250);
          root = assetScope();
        }
      }
      if (!row) { missing.push(id); continue; }
      const box = checkboxOf(row);
      if (box && await toggleOn(box)) { selected.push(id); trail.push(`select:${id.slice(-4)}`); }
      else missing.push(id);
    }
    if (!selected.length) {
      return fail('select', 'Выбранные РК не найдены среди активов, которые этот BC может расшарить. Проверьте, что РК принадлежит исходному BC и одобрен.', { mode, missing });
    }

    const PERMISSIONS = {
      Admin: ['Admin', 'Administrator', 'Ad account admin', 'Admin permission'],
      Operator: ['Operator', 'Ad account operator', 'Operator permission'],
      Analyst: ['Analyst', 'Ad account analyst', 'Analyst permission']
    };
    const choosePermission = async () => {
      const scopeRoot = assetScope();
      let option = findByText(PERMISSIONS[permission], scopeRoot, true);
      if (option) { press(option); await pause(220); return clean(option.textContent); }
      const known = Object.values(PERMISSIONS).flat().map(norm);
      const combo = [...scopeRoot.querySelectorAll('[role="combobox"],[class*="select" i],button')]
        .filter(visible).find((el) => known.some((label) => norm(el.textContent) === label));
      if (!combo) return '';
      press(combo);
      await pause(350);
      option = findByText(PERMISSIONS[permission], document, true);
      if (!option) return '';
      press(option);
      await pause(220);
      return clean(option.textContent);
    };
    let permissionApplied = await choosePermission();
    if (permissionApplied) trail.push(`permission:${permission}`);

    /* ---------- Подтверждение ---------- */
    const finals = ['Assign', 'Confirm', 'Share', 'Send invitation', 'Send', 'Done', 'Submit', 'Invite', 'Save', 'OK'];
    let outcome = null;
    for (let round = 0; round < 4 && !outcome; round += 1) {
      const dialog = scope();
      const labels = dialog === document ? finals.filter((label) => !['OK', 'Save'].includes(label)) : [...finals, 'Add'];
      const finalButton = findByText(labels, dialog, true);
      if (finalButton) {
        press(finalButton);
        trail.push(`submit:${clean(finalButton.textContent)}`);
        await pause(600);
        const confirm = scope() !== dialog ? findByText(['Confirm', 'OK', 'Assign', 'Share'], scope(), true) : null;
        if (confirm) { press(confirm); trail.push('confirm-dialog'); }
        outcome = await waitOutcome(dialog === document ? null : dialog, 30000) || { pending: true };
        break;
      }
      const next = findByText(['Next', 'Continue'], dialog, true);
      if (!next) break;
      press(next);
      trail.push('next');
      // В живом UI 28.10.2026 этот Next является финальной отправкой Add partner request.
      // Сначала ждём success/error; только при отсутствии результата считаем его промежуточным.
      const nextOutcome = await waitOutcome(dialog === document ? null : dialog, 12000);
      if (nextOutcome) { outcome = nextOutcome; break; }
      await pause(300);
      if (!permissionApplied) {
        permissionApplied = await choosePermission();
        if (permissionApplied) trail.push(`permission:${permission}`);
      }
    }
    const summary = { mode, businessCenterId: orgId, targetBusinessCenterId: targetId, permission, permissionApplied: permissionApplied || '', selected, missing };
    if (!outcome) return askUser('submit', 'review', 'Проверьте выбранные РК и права, затем нажмите подтверждение в окне TikTok.', summary);
    if (outcome.needsUser) return askUser('submit', outcome.needsUser, 'TikTok запросил проверку личности. Завершите её во вкладке и нажмите «Продолжить».', summary);
    if (outcome.error) return fail('submit', outcome.error, { ...summary, alreadyPartner: /already/i.test(outcome.error) });
    if (outcome.pending) return askUser('submit', 'pending', 'TikTok не подтвердил результат. Проверьте вкладку Partners.', summary);
    trail.push('done');
    return { success: true, shared: true, invited: mode === 'new-partner', acceptanceRequired: mode === 'new-partner' || pendingPartner, ...summary, trail, at: Date.now() };
  } catch (error) {
    return fail('exception', String(error?.message || error).slice(0, 300));
  }
}

// Плашка-подсказка поверх страницы TikTok, когда шаг нужно завершить вручную (ISOLATED world).
export function showHintInPage(message) {
  try {
    const id = 'ttads-hub-hint';
    document.getElementById(id)?.remove();
    const box = document.createElement('div');
    box.id = id;
    box.setAttribute('style', 'position:fixed;z-index:2147483647;top:14px;left:50%;transform:translateX(-50%);max-width:min(560px,92vw);padding:12px 42px 12px 16px;border-radius:12px;background:#0f141c;color:#fff;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 32px rgba(0,0,0,.35);border:1px solid #25f4ee');
    const title = document.createElement('b');
    title.textContent = 'TTAds Hub: ';
    box.append(title, document.createTextNode(String(message || '').slice(0, 400)));
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть');
    close.setAttribute('style', 'position:absolute;top:6px;right:8px;border:0;background:transparent;color:#9aa4b2;font-size:20px;line-height:1;cursor:pointer');
    close.addEventListener('click', () => box.remove());
    box.append(close);
    document.documentElement.append(box);
    return true;
  } catch {
    return false;
  }
}
