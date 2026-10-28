import { h, clear, toast, fmtTime, download, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';

const SOURCES = { manual: 'Manual', mnl: 'MNL', appeals: 'Апелляции', s2s: 'S2S', sys: 'Система', create: 'Создание', share: 'Шаринг', access: 'Доступ', billing: 'Оплата', monitor: 'Мониторинг' };

export function mountJournal(root) {
  let entries = [], filter = 'all', stopped = false;
  const head = h('div', { class: 'row wrap', style: { marginBottom: '8px' } });
  const box = h('div', { class: 'log' });
  root.append(head, box);

  async function load() {
    try { entries = (await bus.journal.get()).slice().reverse(); } catch (e) { toast(e.message, 'error'); }
    if (!stopped) render();
  }

  function render() {
    const shown = filter === 'all' ? entries : entries.filter((e) => (filter === 'problems' ? e.level !== 'info' : filter === 'manual' ? ['manual', 'mnl'].includes(e.src) : filter === 'create' ? ['create', 'share', 'access'].includes(e.src) : e.src === filter));
    fill(head, 
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Фильтр' },
        ...[['all', 'Все'], ['create', 'BC/РК'], ['manual', 'Manual'], ['appeals', 'Апелл.'], ['s2s', 'S2S'], ['problems', 'Проблемы']].map(([id, label]) =>
          h('button', { type: 'button', 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } }, label))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', type: 'button', title: 'Экспорт в JSON', onclick: () => download('ttads-hub-journal.json', JSON.stringify(entries, null, 2), 'application/json') }, icon('download', 13)),
      h('button', { class: 'btn sm', type: 'button', title: 'Очистить журнал', onclick: async () => { await bus.journal.clear(); entries = []; render(); } }, icon('trash', 13)));
    clear(box);
    if (!shown.length) {
      box.append(h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('activity', 24)), h('h3', null, 'Журнал пуст'), h('p', null, 'Здесь появятся действия расширения: переключения Manual, правки MNL, итоги апелляций и тесты S2S.')));
      return;
    }
    for (const e of shown) {
      box.append(h('div', { class: `log-item ${e.level}` }, h('span', { class: 'lv' }), h('time', null, fmtTime(e.t)), h('span', { class: 'pill' }, SOURCES[e.src] ?? e.src), h('span', { class: 'msg' }, e.msg)));
    }
  }

  const onChange = (changes, area) => { if (area === 'local' && changes.journal && !stopped) { entries = (changes.journal.newValue ?? []).slice().reverse(); render(); } };
  chrome.storage.onChanged.addListener(onChange);
  load();
  return () => { stopped = true; chrome.storage.onChanged.removeListener(onChange); };
}
