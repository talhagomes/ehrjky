// Мини-хелперы для построения DOM без фреймворков и сборки.
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly', 'indeterminate', 'open']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (PROPS.has(key)) el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const clear = (el) => { el.replaceChildren(); return el; };
// Очищает элемент и добавляет детей; null/false пропускаются (нативный append превращает их в текст).
export function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }

export function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = h('textarea', { style: { position: 'fixed', opacity: '0' }, value: text });
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* недоступно */ }
    area.remove();
    return ok;
  }
}

export function toast(message, kind = 'info', ms = 3600) {
  const host = $('#toasts');
  if (!host) return;
  // Не копим уведомления стопкой: одинаковое заменяется, одновременно видно не больше трёх.
  for (const old of [...host.children]) if (old.textContent === message) old.remove();
  while (host.children.length >= 3) host.firstElementChild.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
}

const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(ts) {
  const d = new Date(ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return new Date().toDateString() === d.toDateString() ? time : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time}`;
}

export function download(filename, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
