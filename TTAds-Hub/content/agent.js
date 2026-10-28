// Агент страницы (ISOLATED-мир): связывает интерфейс расширения со страницей TikTok Ads Manager.
// 1) управляет флагом MNL-режима; 2) автоматически нажимает ручные настройки по подписям;
// 3) пересылает в журнал краткий отчёт о правках, сделанных перехватчиком.
(() => {
  'use strict';
  if (globalThis.__tthAgentLoaded) return;
  globalThis.__tthAgentLoaded = true;

  const FLAG = '__tth_mnl';
  const LEGACY_FLAG = 'tt_force_manual';
  const FIELDS = '__tth_mnl_fields';
  const BOOT = '__tth_mnl_boot';
  const MARK = '__tthMnl';
  const CLICKABLE = "button, [role='button'], [role='switch'], [role='radio'], span, div, a, label";

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const norm = (value) => String(value ?? '').trim().toLowerCase();
  const isCreationRoute = (path) => /\/campaign\/create|\/create\/campaign|\/perf_campaign\/create/.test(path);

  function matchingControls(doc, labels) {
    const targets = labels.map(norm).filter(Boolean);
    const matched = [...doc.querySelectorAll(CLICKABLE)].filter((el) => {
      const text = norm(el.textContent);
      if (!text || text.length > 80 || !targets.some((t) => text === t || text.includes(t))) return false;
      const active = ['aria-checked', 'aria-pressed', 'aria-selected'].some((a) => el.getAttribute(a) === 'true') ||
        el.classList.contains('active') || el.classList.contains('selected');
      return !active;
    });
    // <button><span>метка</span></button> совпадает дважды, а клик по вложенному всплывает — оставляем самый вложенный.
    return matched.filter((el) => !matched.some((other) => other !== el && typeof el.contains === 'function' && el.contains(other)));
  }

  function isVisible(el, view) {
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const style = view.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  async function selectManualControls(doc, view, labels, timing = {}) {
    const { passes = 4, interval = 600, afterClick = 150 } = timing;
    const done = new WeakSet(); // каждый элемент нажимаем один раз: повторный клик по переключателю вернул бы его назад
    let count = 0;
    for (let pass = 0; pass < passes; pass++) {
      const controls = matchingControls(doc, labels).filter((el) => !done.has(el) && isVisible(el, view));
      if (!controls.length) break;
      for (const el of controls) {
        if (!el.isConnected) continue;
        done.add(el);
        el.scrollIntoView({ block: 'center' });
        el.click();
        count++;
        await pause(afterClick);
      }
      await pause(interval);
    }
    return count;
  }

  function timezoneInText(text = '') {
    const label = text.match(/(time\s*zone|часов[а-я]*\s*пояс)[:\s]*\n?\s*([^\n]{3,40})/i);
    if (label) return label[2].trim();
    return text.match(/(GMT|UTC)\s*[+-]\d{1,2}(:\d{2})?/i)?.[0] ?? null;
  }

  function attach(scope, ext) {
    const readFlag = () => {
      try { return scope.localStorage.getItem(FLAG) === '1' || scope.localStorage.getItem(LEGACY_FLAG) === '1'; } catch { return false; }
    };

    // Отчёты перехватчика → краткая сводка в журнал (не чаще раза в секунду).
    let outbox = [];
    let flushTimer = null;
    let budget = 120; // страница может подделать сообщения — пропускаем не больше 120 отчётов в минуту
    scope.setInterval(() => { budget = 120; }, 60000);
    const flush = () => {
      flushTimer = null;
      const items = outbox.splice(0, 20);
      if (!items.length) return;
      try { ext.runtime.sendMessage({ ns: 'agent', type: 'edits', items }); } catch { /* контекст расширения недоступен */ }
    };
    scope.addEventListener('message', (event) => {
      const record = event.data;
      if (event.source !== scope || !record || record[MARK] !== true || record.type !== 'EDIT' || !Array.isArray(record.changes)) return;
      if (budget <= 0 || outbox.length >= 50) return;
      budget--;
      let path = '';
      try { path = new URL(record.url, scope.location.href).pathname; } catch { /* относительный адрес */ }
      outbox.push({
        path: path.slice(0, 160),
        direction: record.direction === 'response' ? 'response' : 'request',
        keys: [...new Set(record.changes.map((c) => String(c.key).slice(0, 60)))].slice(0, 12),
        time: Number(record.time) || Date.now()
      });
      if (!flushTimer) flushTimer = scope.setTimeout(flush, 1000);
    });

    ext.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== ext.runtime.id) return false;
      switch (message?.type) {
        case 'agent.info': {
          let loaded = false;
          try { loaded = scope.sessionStorage.getItem(BOOT) === '1'; } catch { /* необязательная метка */ }
          reply({ interceptor: readFlag(), loaded });
          return false;
        }
        case 'agent.timezone': {
          reply({ page: timezoneInText(scope.document.body?.innerText || '') });
          return false;
        }
        case 'agent.setInterceptor': {
          try {
            if (message.enabled) {
              scope.localStorage.setItem(FLAG, '1');
              if (Array.isArray(message.fields) && message.fields.length) {
                scope.localStorage.setItem(FIELDS, JSON.stringify(message.fields.filter((x) => typeof x === 'string').slice(0, 100)));
              }
            } else {
              scope.localStorage.removeItem(FLAG);
              scope.localStorage.removeItem(LEGACY_FLAG);
            }
          } catch { reply({ ok: false }); return false; }
          reply({ ok: true });
          scope.setTimeout(() => scope.location.reload(), 150);
          return false;
        }
        default: return false;
      }
    });

    // Автовыбор ручных настроек на маршрутах создания кампании.
    let running = false;
    let currentPath = scope.location.pathname;
    const schedule = () => {
      scope.setTimeout(async () => {
        if (running || !isCreationRoute(scope.location.pathname)) return;
        try {
          const stored = (await ext.storage.local.get('settings')).settings;
          const manual = stored?.manual;
          if (manual?.autoClick !== true || !Array.isArray(manual.labels)) return;
          running = true;
          await selectManualControls(scope.document, scope, manual.labels.filter((x) => typeof x === 'string'));
        } catch { /* закрытый или обновлённый контекст не должен ломать страницу */ } finally { running = false; }
      }, 1500);
    };
    if (isCreationRoute(currentPath)) schedule();
    // TikTok меняет маршруты без перезагрузки документа — следим за ними.
    new scope.MutationObserver(() => {
      const next = scope.location.pathname;
      if (next === currentPath) return;
      currentPath = next;
      if (isCreationRoute(next)) schedule();
    }).observe(scope.document.documentElement, { childList: true, subtree: true });
  }

  if (globalThis.__tthTestMode === true) globalThis.__tthAgent = { matchingControls, isVisible, selectManualControls, timezoneInText, isCreationRoute, attach };
  else attach(window, chrome);
})();
