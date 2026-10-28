import { h, clear, toast, copyText, fmtTime, plural, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { APPEAL_REASONS } from '../../background/lib/constants.js';

const LEVEL = { ad: 'Объявление', adgroup: 'Адсет', campaign: 'Кампания' };
const JOB = {
  submitted: ['Отправлено', 'ok'], accepted: ['Проверяется', 'info'], sending: ['Отправка…', 'info'],
  unknown: ['Не подтверждено', 'warn'], limited: ['Лимит TikTok', 'warn'], retry_allowed: ['Отказ — можно повторить', 'warn'],
  failed: ['Ошибка', 'err'], cancelled: ['Снято', ''], skipped: ['Пропущено', ''], submitted_manual: ['Отправлено', 'ok'], prepared: ['Подготовлено', '']
};
const BATCH_KEY = 'tth:appeals:batch';
const SEEN_KEY = 'tth:appeals:seen';
const markSeen = (id) => chrome.storage.session.set({ [SEEN_KEY]: id }).catch(() => {});
const rowKey = (r) => `${r.level}:${r.id}`;

export function mountAppeals(root, ctx) {
  root.classList.add('flush');
  const S = { loading: false, error: '', warning: '', account: '', pageLevel: 'unknown', rows: [], unresolved: 0, selected: new Set(), filter: '', view: 'queue', history: [], resolving: false };
  let stopped = false, scanSeq = 0, sheet = null;

  const toolbar = h('div', { class: 'toolbar' });
  const filterRow = h('div', { class: 'toolbar', style: { paddingTop: '0' } });
  const list = h('div', { class: 'list' });
  const bar = h('div', { class: 'bar' });
  root.append(toolbar, filterRow, list, bar);

  /* ---------- загрузка ---------- */
  async function scan() {
    if (S.loading) return;
    const seq = ++scanSeq;
    S.loading = true; S.error = ''; S.warning = '';
    renderAll();
    try {
      if (!ctx.tabId || !ctx.onAds) throw Object.assign(new Error('Откройте TikTok Ads Manager (ads.tiktok.com).'), { soft: true });
      const data = await bus.appeals.scan(ctx.tabId);
      if (seq !== scanSeq || stopped) return;
      S.account = data.account; S.pageLevel = data.pageLevel; S.rows = data.rows; S.unresolved = data.unresolved; S.warning = data.warning || '';
      const alive = new Set(data.rows.filter((r) => !r.blocked).map(rowKey));
      S.selected = new Set([...S.selected].filter((k) => alive.has(k)));
      ctx.setBadge('appeals', data.rows.filter((r) => !r.blocked).length);
    } catch (e) {
      if (seq !== scanSeq || stopped) return;
      S.rows = []; S.error = e.message; S.soft = Boolean(e.soft);
      ctx.setBadge('appeals', 0);
    } finally {
      if (seq === scanSeq) { S.loading = false; if (!stopped) renderAll(); }
    }
  }

  async function loadHistory() {
    try { S.history = await bus.appeals.history(); } catch (e) { toast(e.message, 'error'); }
    renderAll();
  }

  /* ---------- отрисовка ---------- */
  function visibleRows() {
    const q = S.filter.trim().toLowerCase();
    return q ? S.rows.filter((r) => `${r.name} ${r.id} ${r.reason}`.toLowerCase().includes(q)) : S.rows;
  }

  function renderAll() { renderToolbar(); renderList(); renderBar(); }

  function renderToolbar() {
    fill(toolbar, 
      h('button', { class: 'btn sm', type: 'button', disabled: S.loading, onclick: () => (S.view === 'queue' ? scan() : loadHistory()) },
        S.loading ? h('span', { class: 'spinner' }) : icon('refresh', 14), 'Обновить'),
      S.view === 'queue' && S.account ? h('span', { class: 'pill cyan' }, S.pageLevel === 'ad' ? 'Объявления' : S.pageLevel === 'adgroup' ? 'Адсеты' : S.pageLevel === 'campaign' ? 'Кампании' : 'Список') : null,
      h('span', { class: 'spacer' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Раздел' },
        h('button', { type: 'button', 'aria-pressed': String(S.view === 'queue'), onclick: () => { S.view = 'queue'; renderAll(); } }, 'Очередь'),
        h('button', { type: 'button', 'aria-pressed': String(S.view === 'history'), onclick: () => { S.view = 'history'; loadHistory(); } }, 'История'))
    );
    const filter = h('div', { class: 'search' }, icon('search', 14),
      h('input', { class: 'input', type: 'search', placeholder: S.view === 'queue' ? 'Фильтр по названию или ID' : 'Поиск в истории', value: S.filter, 'aria-label': 'Фильтр' }));
    filter.querySelector('input').addEventListener('input', (e) => { S.filter = e.target.value; renderList(); renderBar(); });
    fill(filterRow, filter);
    filterRow.hidden = S.view === 'queue' ? S.rows.length === 0 : S.history.length === 0;
  }

  function emptyState(iconName, title, text, action) {
    return h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon(iconName, 24)), h('h3', null, title), h('p', null, text), action);
  }

  function renderList() {
    if (S.view === 'history') return renderHistory();
    clear(list);
    if (S.loading && !S.rows.length) { list.append(emptyState('refresh', 'Ищу объявления…', 'Читаю таблицу на странице TikTok Ads Manager.')); return; }
    if (S.error) {
      list.append(emptyState('alert', S.soft ? 'Нужна страница Ads Manager' : 'Не удалось прочитать страницу', S.error,
        S.soft ? h('button', { class: 'btn primary sm', type: 'button', onclick: () => chrome.tabs.create({ url: 'https://ads.tiktok.com/' }) }, icon('external', 14), 'Открыть Ads Manager') : null));
      return;
    }
    if (S.pageLevel === 'campaign') {
      list.append(emptyState('target', 'Перейдите в адсеты или объявления', 'Апелляции подаются на уровне объявлений. Откройте вкладку Ad group или Ad нужной кампании и нажмите «Обновить».'));
      return;
    }
    if (S.warning) list.append(h('div', { class: 'alert warn' }, icon('alert', 15), h('div', null, S.warning)));
    if (!S.rows.length) {
      list.append(emptyState('check', 'Проблемных объявлений нет', 'Откройте список объявлений или адсетов, отфильтруйте по статусу «Rejected / Review issue» и нажмите «Обновить».'));
      return;
    }
    const rows = visibleRows();
    if (!rows.length) { list.append(emptyState('search', 'Ничего не найдено', 'Измените фильтр.')); return; }
    for (const row of rows) list.append(renderItem(row));
    if (S.unresolved) list.append(h('p', { class: 'hint', style: { padding: '4px 2px' } }, `Ещё ${S.unresolved} ${plural(S.unresolved, 'строка', 'строки', 'строк')} без точного ID недоступны для выбора.`));
  }

  function renderItem(row) {
    const k = rowKey(row);
    const checkbox = h('input', { type: 'checkbox', checked: S.selected.has(k), disabled: row.blocked, 'aria-label': row.name });
    const card = h('label', { class: `item ${S.selected.has(k) ? 'selected' : ''} ${row.blocked ? 'disabled' : ''}` },
      checkbox,
      h('div', { class: 'thumb' }, row.thumbnail ? h('img', { src: row.thumbnail, alt: '', referrerpolicy: 'no-referrer' }) : icon('image', 18)),
      h('div', { class: 'item-main' },
        h('div', { class: 'item-title', title: row.name }, row.name.replace(/^\s*Smart\+\s*(?:campaign)?\s*/i, '').trim() || row.id),
        h('div', { class: 'item-meta' },
          h('span', { class: `pill ${row.status === 'rejected' ? 'err' : 'warn'}` }, row.status === 'rejected' ? 'Rejected' : 'Review issue'),
          h('span', null, LEVEL[row.level]), h('span', { class: 'mono' }, `…${row.id.slice(-8)}`),
          /^\s*Smart\+/i.test(row.name) ? h('span', { class: 'pill info' }, 'Smart+') : null,
          row.jobStatus && JOB[row.jobStatus] ? h('span', { class: `pill ${JOB[row.jobStatus][1]}` }, JOB[row.jobStatus][0]) : null),
        row.note ? h('div', { class: 'item-note' }, row.note) : null));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) S.selected.add(k); else S.selected.delete(k);
      card.classList.toggle('selected', checkbox.checked);
      renderBar();
    });
    return card;
  }

  function renderBar() {
    clear(bar);
    if (S.view === 'history') {
      bar.append(h('span', { class: 'count' }, `Записей: `, h('b', null, S.history.length)), h('span', { class: 'spacer' }), clearButton());
      return;
    }
    const selectable = visibleRows().filter((r) => !r.blocked);
    const all = selectable.length > 0 && selectable.every((r) => S.selected.has(rowKey(r)));
    bar.append(
      h('span', { class: 'count' }, 'Выбрано: ', h('b', null, S.selected.size), ` из ${S.rows.filter((r) => !r.blocked).length}`),
      h('button', { class: 'btn sm ghost', type: 'button', disabled: !selectable.length, onclick: () => {
        for (const r of selectable) { if (all) S.selected.delete(rowKey(r)); else S.selected.add(rowKey(r)); }
        renderList(); renderBar();
      } }, all ? 'Снять выбор' : 'Выбрать все'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', type: 'button', disabled: !S.selected.size || S.resolving, onclick: onSend },
        S.resolving ? h('span', { class: 'spinner' }) : icon('send', 15), 'Апелляция', S.selected.size ? ` (${S.selected.size})` : ''));
  }

  function unblockButton(job) {
    let armed = false, timer = null;
    const btn = h('button', { class: 'btn sm', type: 'button', title: 'Разрешить повторную отправку' }, icon('unlock', 13), 'Снять');
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true; btn.replaceChildren(icon('alert', 13), 'Точно?');
        timer = setTimeout(() => { armed = false; btn.replaceChildren(icon('unlock', 13), 'Снять'); }, 3500);
        return;
      }
      clearTimeout(timer);
      try { await bus.appeals.unblock(job.jobId); toast('Блокировка снята — объявление можно отправить снова', 'ok'); await loadHistory(); scan(); } catch (e) { toast(e.message, 'error'); }
    });
    return btn;
  }

  function clearButton() {
    let armed = false, timer = null;
    const btn = h('button', { class: 'btn sm', type: 'button', disabled: !S.history.length }, icon('trash', 14), 'Очистить');
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true; btn.replaceChildren(icon('alert', 14), 'Точно очистить?');
        timer = setTimeout(() => { armed = false; btn.replaceChildren(icon('trash', 14), 'Очистить'); }, 3500);
        return;
      }
      clearTimeout(timer);
      try { await bus.appeals.clear(); toast('История очищена. Защита от повторов сброшена.', 'ok'); S.history = []; scan(); } catch (e) { toast(e.message, 'error'); }
      renderAll();
    });
    return btn;
  }

  function renderHistory() {
    clear(list);
    const q = S.filter.trim().toLowerCase();
    const items = q ? S.history.filter((j) => `${j.name} ${j.id} ${j.status}`.toLowerCase().includes(q)) : S.history;
    if (!items.length) { list.append(emptyState('list', 'История пуста', 'Здесь появятся отправленные апелляции и их результат.')); return; }
    for (const job of items) {
      const [label, tone] = JOB[job.status] ?? [job.status, ''];
      const canUnblock = ['unknown', 'sending', 'accepted', 'limited'].includes(job.status);
      list.append(h('div', { class: 'card', style: { padding: '9px 11px' } },
        h('div', { class: 'row' },
          h('div', { class: 'item-main', style: { flex: 1, minWidth: 0 } },
            h('div', { class: 'item-title', title: job.name }, job.name || job.id),
            h('div', { class: 'item-meta' }, h('span', { class: `pill ${tone}` }, label), h('span', null, LEVEL[job.level] ?? job.level), h('span', { class: 'mono' }, `…${String(job.id).slice(-8)}`), h('span', null, fmtTime(Date.parse(job.updated || job.created))))),
          canUnblock ? unblockButton(job) : null),
        job.message ? h('p', { class: 'hint', style: { marginTop: '5px' } }, job.message) : null));
    }
  }

  /* ---------- отправка ---------- */
  async function onSend() {
    const chosen = S.rows.filter((r) => S.selected.has(rowKey(r)));
    if (!chosen.length) return;
    let ads = chosen;
    if (chosen.some((r) => r.level !== 'ad')) {
      S.resolving = true; renderBar();
      try { ads = await bus.appeals.resolve(ctx.tabId, S.account, chosen); } catch (e) { toast(e.message, 'error'); S.resolving = false; renderBar(); return; }
      S.resolving = false; renderBar();
    }
    ads = ads.filter((r) => !r.blocked);
    if (!ads.length) { toast('Нет доступных объявлений: проблемные не найдены или апелляции уже отправлены.', 'error'); return; }
    openCompose(ads);
  }

  function closeSheet() { sheet?.remove(); sheet = null; }

  function openSheet(title, body, foot, dismissable = true) {
    closeSheet();
    const host = document.getElementById('sheet-host');
    const backdrop = h('div', { class: 'backdrop' });
    if (dismissable) backdrop.addEventListener('click', closeSheet);
    const panel = h('section', { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', null, title), dismissable ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onclick: closeSheet }, icon('x', 17)) : null),
      h('div', { class: 'sheet-body' }, body), foot ? h('div', { class: 'sheet-foot' }, foot) : null);
    sheet = h('div', null, backdrop, panel);
    host.append(sheet);
    return panel;
  }

  function openCompose(ads) {
    const settings = ctx.settings?.appeals ?? { templates: [], templateId: 'default', reason: 1, concurrency: 3 };
    const templates = settings.templates;
    let reason = settings.reason || 1;
    const textarea = h('textarea', { class: 'textarea', maxlength: '2000', rows: '5', 'aria-label': 'Текст апелляции' });
    const counter = h('span', { class: 'hint' });
    const select = h('select', { class: 'select', 'aria-label': 'Шаблон' },
      templates.map((t) => h('option', { value: t.id, selected: t.id === settings.templateId }, t.name)), h('option', { value: '__custom' }, 'Свой текст'));
    const confirmBox = h('input', { type: 'checkbox' });
    const send = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('send', 15), `Отправить (${ads.length})`);
    const sync = () => { counter.textContent = `${textarea.value.length}/2000`; send.disabled = !(confirmBox.checked && textarea.value.trim()); };
    const fill = () => { const t = templates.find((x) => x.id === select.value); if (t) textarea.value = t.text; sync(); };
    select.addEventListener('change', () => { if (select.value === '__custom') { textarea.focus(); } else fill(); });
    textarea.addEventListener('input', () => { select.value = '__custom'; sync(); });
    confirmBox.addEventListener('change', sync);
    fill();

    const reasons = h('div', { class: 'stack', style: { gap: '6px' } }, APPEAL_REASONS.map((r) =>
      h('label', { class: 'radio-card' }, h('input', { type: 'radio', name: 'reason', value: r.value, checked: r.value === reason, onchange: () => { reason = r.value; } }), r.ru)));
    const body = [
      h('div', { class: 'alert info' }, icon('info', 15), h('div', null, `Выбрано объявлений: `, h('b', null, ads.length), `. Запросы уходят от имени текущей сессии TikTok, по ${settings.concurrency} одновременно; повторные отправки блокируются автоматически. Не закрывайте вкладку TikTok до завершения отправки.`)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Причина апелляции'), reasons),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Текст', counter), select, textarea),
      h('label', { class: 'check' }, confirmBox, h('span', null, 'Я проверил(а) текст и причину и подтверждаю отправку для всех выбранных объявлений.'))
    ];
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        await bus.appeals.start({ tabId: ctx.tabId, account: S.account, rows: ads, text: textarea.value.trim(), reason });
        closeSheet();
        await openProgress();
      } catch (e) { toast(e.message, 'error'); sync(); }
    });
    openSheet('Подать апелляцию', body, [h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Назад'), send]);
  }

  /* ---------- прогресс и итоги ---------- */
  function renderBatch(batch) {
    if (!batch) return;
    const running = batch.state === 'running';
    if (!running) markSeen(batch.id);
    const total = batch.total || 1;
    const pct = Math.round(((batch.completed || 0) / total) * 100);
    const foot = running
      ? [h('button', { class: 'btn danger', type: 'button', disabled: batch.cancelRequested, onclick: async () => { try { await bus.appeals.cancel(); } catch (e) { toast(e.message, 'error'); } } }, icon('stop', 14), batch.cancelRequested ? 'Останавливаю…' : 'Остановить оставшиеся')]
      : [h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); scan(); } }, 'Закрыть'),
        batch.problems?.length ? h('button', { class: 'btn', type: 'button', onclick: async () => {
          const ids = batch.problems.flatMap((g) => g.ids).join('\n');
          if (await copyText(ids)) toast('ID с проблемами скопированы', 'ok');
        } }, icon('copy', 14), 'ID с проблемами') : null];
    let body;
    if (running) {
      body = [
        h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('b', null, batch.phase === 'verifying' ? 'Проверяю статусы в TikTok…' : 'Отправляю апелляции…'), h('span', { class: 'spacer' }), h('span', { class: 'mono' }, `${batch.completed || 0}/${batch.total}`)),
        h('div', { class: 'progress' + (batch.phase === 'verifying' ? ' indeterminate' : '') }, h('i', { style: { width: `${pct}%` } })),
        h('p', { class: 'hint' }, 'Окно можно закрыть: отправка продолжится в фоне, итог появится здесь при следующем открытии.')
      ];
    } else if (batch.state === 'error') {
      body = [h('div', { class: 'alert err' }, icon('alert', 15), h('div', null, batch.error || 'Отправка прервана.'))];
    } else {
      const c = batch.counts || {};
      body = [
        h('div', { class: 'stats' },
          stat('Успешно', c.submitted, 'ok'), stat('Лимит TikTok', c.limited, 'warn'), stat('Отказ TikTok', c.retry_allowed, 'warn'),
          stat('Ошибок', c.failed, 'err'), stat('Не подтверждено', c.unknown, 'warn'), stat('Пропущено', c.skipped, '')),
        batch.state === 'cancelled' ? h('div', { class: 'alert warn' }, icon('stop', 15), h('div', null, 'Отправка остановлена: оставшиеся объявления не отправлялись.')) : null,
        ...(batch.problems ?? []).map((g) => h('details', { class: 'group' },
          h('summary', null, h('span', { class: `pill ${JOB[g.status]?.[1] ?? ''}` }, g.ids.length), g.message),
          h('div', { class: 'ids' }, g.ids.join(', '))))
      ];
    }
    if (!sheet || sheet.dataset.kind !== 'progress') {
      const panel = openSheet(running ? 'Отправка' : 'Итоги отправки', body, foot, !running);
      sheet.dataset.kind = 'progress';
      return panel;
    }
    // обновляем содержимое уже открытой шторки без анимации появления
    sheet.querySelector('.sheet-head h2').textContent = running ? 'Отправка' : 'Итоги отправки';
    fill(sheet.querySelector('.sheet-body'), body);
    const footEl = sheet.querySelector('.sheet-foot');
    fill(footEl, ...foot.filter(Boolean));
  }

  const stat = (label, value, tone) => h('div', { class: `stat ${tone}` }, h('b', null, value ?? 0), h('span', null, label));

  async function openProgress() {
    const batch = await bus.appeals.batch();
    if (batch) renderBatch(batch);
  }

  const onStorage = (changes, area) => {
    if (area !== 'session' || !changes[BATCH_KEY] || stopped) return;
    const batch = changes[BATCH_KEY].newValue;
    if (batch && (sheet?.dataset.kind === 'progress')) renderBatch(batch);
  };
  chrome.storage.onChanged.addListener(onStorage);

  /* ---------- запуск ---------- */
  const stopTab = ctx.onTab(() => { clearTimeout(rescanTimer); rescanTimer = setTimeout(() => { if (S.view === 'queue' && !sheet) scan(); }, 700); });
  let rescanTimer = null;

  renderAll();
  scan();
  Promise.all([bus.appeals.batch(), chrome.storage.session.get(SEEN_KEY)]).then(([batch, seen]) => {
    if (!batch || stopped) return;
    if (batch.state === 'running') renderBatch(batch);
    else if (batch.id !== seen[SEEN_KEY] && Date.now() - (batch.finishedAt || 0) < 600000) renderBatch(batch);
  }).catch(() => {});

  return () => { stopped = true; clearTimeout(rescanTimer); stopTab(); chrome.storage.onChanged.removeListener(onStorage); closeSheet(); root.classList.remove('flush'); };
}
