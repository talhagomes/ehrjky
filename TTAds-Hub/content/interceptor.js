// MNL-режим (порт MNL Campaign Control): перехват fetch/XHR на ads.tiktok.com и переключение флагов
// автоматизации (1/true → 0/false) в запросах и ответах. Выполняется в MAIN-мире на document_start.
// Если режим выключен, страница остаётся нетронутой: никакие хуки не ставятся.
(() => {
  'use strict';
  const FLAG = '__tth_mnl';
  const LEGACY_FLAG = 'tt_force_manual';
  const FIELDS = '__tth_mnl_fields';
  const BOOT = '__tth_mnl_boot';
  const MARK = '__tthMnl';
  const DEFAULT_FIELDS = [
    'spc_automation_type', 'spc_upgrade_mode', 'spc_multi_ad_mode',
    'soc_automation_type', 'soc_upgrade_mode', 'soc_multi_ad_mode',
    'universal_type', 'auto_creation_product_type', 'web_all_in_one_catalog'
  ];

  // Итеративный обход в глубину: сохраняет порядок замен и не падает на глубоких структурах.
  function transformJson(text, fields) {
    if (!text || typeof text !== 'string') return null;
    const names = fields instanceof Set ? fields : new Set(fields);
    let parsed;
    try { parsed = JSON.parse(text); } catch { return null; }
    if (parsed === null || typeof parsed !== 'object') return null;
    const changes = [];
    const frames = [{ object: parsed, keys: Object.keys(parsed), index: 0 }];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      if (frame.index === frame.keys.length) { frames.pop(); continue; }
      const key = frame.keys[frame.index++];
      const value = frame.object[key];
      if (names.has(key) && (value === 1 || value === true)) {
        const next = typeof value === 'boolean' ? false : 0;
        frame.object[key] = next;
        changes.push({ key, from: value, to: next });
      } else if (value !== null && typeof value === 'object') {
        frames.push({ object: value, keys: Object.keys(value), index: 0 });
      }
    }
    return changes.length ? { text: JSON.stringify(parsed), changes } : null;
  }

  function install(scope, fieldList) {
    if (scope[Symbol.for('tth.mnl.installed')]) return false;
    Object.defineProperty(scope, Symbol.for('tth.mnl.installed'), { value: true });
    const fields = new Set(fieldList);
    const origin = scope.location?.origin || '*';
    const report = (url, direction, changes) => {
      try { scope.postMessage({ [MARK]: true, type: 'EDIT', url: String(url || '').slice(0, 300), direction, changes, time: Date.now() }, origin); } catch { /* ignore */ }
    };
    const addressOf = (resource) => (typeof resource === 'string' ? resource : resource?.url || '');

    const nativeFetch = scope.fetch;
    scope.fetch = async function patchedFetch(...args) {
      const [resource, options] = args;
      if (typeof options?.body === 'string') {
        const edit = transformJson(options.body, fields);
        if (edit) {
          args = [resource, { ...options, body: edit.text }];
          report(addressOf(resource), 'request', edit.changes);
        }
      }
      const original = await Reflect.apply(nativeFetch, this, args);
      // Потоковые и нетекстовые ответы (SSE, файлы) не буферизуем: clone().text() завис бы до конца потока.
      if (!/json/i.test(original.headers?.get?.('content-type') || '')) return original;
      let edit;
      try { edit = transformJson(await original.clone().text(), fields); } catch { return original; }
      if (!edit) return original;
      // Сохраняем служебные поля исходного ответа, в том числе у клонов.
      const decorate = (response) => {
        for (const prop of ['url', 'redirected', 'type']) Object.defineProperty(response, prop, { value: original[prop], configurable: true });
        const clone = response.clone.bind(response);
        response.clone = () => decorate(clone());
        return response;
      };
      try {
        const response = decorate(new scope.Response(edit.text, { status: original.status, statusText: original.statusText, headers: original.headers }));
        report(original.url || addressOf(resource), 'response', edit.changes);
        return response;
      } catch { return original; }
    };

    // Патчим методы прототипа, а не конструктор: константы, instanceof и наследники продолжают работать.
    const proto = scope.XMLHttpRequest?.prototype;
    if (proto) {
      const urls = new WeakMap();
      const nativeOpen = proto.open, nativeSend = proto.send;
      proto.open = function patchedOpen(method, url, ...rest) {
        urls.set(this, url);
        return Reflect.apply(nativeOpen, this, [method, url, ...rest]);
      };
      proto.send = function patchedSend(body) {
        if (typeof body === 'string') {
          const edit = transformJson(body, fields);
          if (edit) { body = edit.text; report(urls.get(this) || '', 'request', edit.changes); }
        }
        return Reflect.apply(nativeSend, this, [body]);
      };
    }
    return true;
  }

  function start(scope) {
    let enabled = false, fields = DEFAULT_FIELDS;
    try {
      enabled = scope.localStorage.getItem(FLAG) === '1' || scope.localStorage.getItem(LEGACY_FLAG) === '1';
      const stored = JSON.parse(scope.localStorage.getItem(FIELDS) || 'null');
      if (Array.isArray(stored) && stored.length) fields = stored.filter((x) => typeof x === 'string');
    } catch { /* localStorage недоступен */ }
    try { if (enabled) scope.sessionStorage.setItem(BOOT, '1'); else scope.sessionStorage.removeItem(BOOT); } catch { /* необязательная метка */ }
    return enabled ? install(scope, fields) : false;
  }

  if (globalThis.__tthTestMode === true) globalThis.__tthInterceptor = { transformJson, install, start, DEFAULT_FIELDS };
  else start(window);
})();
