// Нижняя «шторка» поверх интерфейса: Escape и клик по затемнению закрывают, фокус возвращается на прежний элемент.
import { h, $ } from './dom.js';
import { icon } from './icons.js';

let current = null;

export function closeSheet() { current?.close(); }

export function openSheet({ title, body, foot, dismissable = true, onClose, kind = '' }) {
  closeSheet();
  const host = $('#sheet-host');
  const previous = document.activeElement;
  const panel = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, dataset: { kind } },
    h('div', { class: 'sheet-head' }, h('h2', null, title),
      dismissable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onclick: () => close() }, icon('x', 17)) : null),
    h('div', { class: 'sheet-body' }, body),
    foot ? h('div', { class: 'sheet-foot' }, foot) : null);
  const backdrop = h('div', { class: 'backdrop', onclick: () => { if (dismissable) close(); } });
  const root = h('div', { class: 'sheet-root' }, backdrop, panel);
  const focusable = () => [...panel.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
  const onKey = (event) => {
    if (event.key === 'Escape' && dismissable) { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items.at(-1);
    if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const handle = { panel, root, close };
  function close() {
    if (current !== handle) return;
    current = null;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    try { previous?.focus?.(); } catch { /* элемент мог исчезнуть */ }
    onClose?.();
  }
  current = handle;
  host.append(root);
  document.addEventListener('keydown', onKey, true);
  queueMicrotask(() => (panel.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea') ?? focusable().find((el) => !el.classList.contains('icon-btn')) ?? focusable()[0])?.focus());
  return handle;
}
