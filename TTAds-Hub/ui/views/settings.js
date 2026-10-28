import { h, clear, toast, download } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import { APPEAL_REASONS, DEFAULT_LABELS, DEFAULT_AUTOMATION_FIELDS, MONITOR_INTERVALS, HEALTH_INTERVALS, VERSION } from '../../background/lib/constants.js';
import { buildDiagnostics } from '../lib/diagnostics.js';
import { openLearnSheet } from './objects.js';
import { DEFAULT_FAVORITES } from '../../background/links/catalog.js';
import { clock } from '../lib/format.js';

export function openSettings(ctx) {
  const draft = structuredClone(ctx.settings ?? { manual: {}, appeals: { templates: [] }, s2s: {}, ui: {}, monitor: {}, links: {} });
  const originalTheme = document.documentElement.dataset.theme;
  let saved = false;
  draft.manual ??= {}; draft.appeals ??= { templates: [] }; draft.ui ??= {}; draft.monitor ??= { enabled: false, intervalMin: 15, notify: false }; draft.links ??= {};
  draft.health ??= { concurrency: 2, includeBc: true, auto: { enabled: false, intervalMin: 60, notify: false } };
  draft.health.auto ??= { enabled: false, intervalMin: 60, notify: false };

  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
  const section = (title) => h('div', { class: 'section-label' }, title);

  const theme = h('select', { class: 'select' }, [['auto', 'Как в системе'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, l]) => h('option', { value: v, selected: draft.ui.theme === v }, l)));
  theme.addEventListener('change', () => { draft.ui.theme = theme.value; document.documentElement.dataset.theme = theme.value === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme.value; });

  /* ---------- мониторинг ---------- */
  const monEnabled = h('input', { type: 'checkbox', checked: draft.monitor.enabled === true });
  const monInterval = h('select', { class: 'select', 'aria-label': 'Интервал проверки' }, MONITOR_INTERVALS.map((m) => h('option', { value: m, selected: m === draft.monitor.intervalMin }, `каждые ${m} мин`)));
  const monNotify = h('input', { type: 'checkbox', checked: draft.monitor.notify === true });
  const monStatus = h('p', { class: 'hint' }, 'Состояние: загружаю…');
  monEnabled.addEventListener('change', () => { draft.monitor.enabled = monEnabled.checked; });
  monInterval.addEventListener('change', () => { draft.monitor.intervalMin = Number(monInterval.value); });
  monNotify.addEventListener('change', async () => {
    if (!monNotify.checked) { draft.monitor.notify = false; return; }
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ['notifications'] }); } catch { granted = false; }
    draft.monitor.notify = granted;
    monNotify.checked = granted;
    await ctx.saveSettings({ monitor: { ...(ctx.settings?.monitor ?? {}), notify: granted } }).catch(() => {}); // popup мог закрыться из-за диалога браузера
    if (!granted) toast('Разрешение на уведомления не выдано — останется только значок на иконке', 'error', 5000);
  });
  const runNow = h('button', { class: 'btn sm', type: 'button' }, icon('refresh', 13), 'Проверить сейчас');
  runNow.addEventListener('click', async () => {
    runNow.disabled = true;
    try {
      const state = await bus.monitor.run(ctx.tabId);
      toast(state?.ok === false ? state.error : `Проверено кабинетов: ${state?.accounts ?? 0}, проблем: ${state?.problems?.length ?? 0}`, state?.ok === false ? 'error' : 'ok', 5000);
      showMonitorStatus();
    } catch (e) { toast(e.message, 'error'); } finally { runNow.disabled = false; }
  });
  function showMonitorStatus() {
    bus.monitor.status().then(({ state, alarm }) => {
      monStatus.textContent = state?.at
        ? `Последняя проверка: ${clock(state.at)} — ${state.ok === false ? state.error : `проблем: ${state.problems?.length ?? 0}`}${alarm ? '' : ' · таймер не запущен'}`
        : 'Проверок ещё не было.';
    }).catch(() => { monStatus.textContent = ''; });
  }
  showMonitorStatus();

  /* ---------- проверка РК: статус, билл, карта ---------- */
  const healthConcurrency = h('select', { class: 'select', 'aria-label': 'Параллельных вкладок' }, [1, 2, 3].map((n) => h('option', { value: n, selected: n === draft.health.concurrency }, `${n} ${n === 1 ? 'вкладка' : 'вкладки'}`)));
  healthConcurrency.addEventListener('change', () => { draft.health.concurrency = Number(healthConcurrency.value); });
  const healthBc = h('input', { type: 'checkbox', checked: draft.health.includeBc !== false });
  healthBc.addEventListener('change', () => { draft.health.includeBc = healthBc.checked; });
  const healthAuto = h('input', { type: 'checkbox', checked: draft.health.auto.enabled === true });
  healthAuto.addEventListener('change', () => { draft.health.auto.enabled = healthAuto.checked; });
  const healthInterval = h('select', { class: 'select', 'aria-label': 'Интервал автопроверки' }, HEALTH_INTERVALS.map((m) => h('option', { value: m, selected: m === draft.health.auto.intervalMin }, m < 60 ? `каждые ${m} мин` : `каждые ${m / 60} ч`)));
  healthInterval.addEventListener('change', () => { draft.health.auto.intervalMin = Number(healthInterval.value); });
  const healthNotify = h('input', { type: 'checkbox', checked: draft.health.auto.notify === true });
  healthNotify.addEventListener('change', async () => {
    if (!healthNotify.checked) { draft.health.auto.notify = false; return; }
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ['notifications'] }); } catch { granted = false; }
    draft.health.auto.notify = granted;
    healthNotify.checked = granted;
    if (!granted) toast('Разрешение на уведомления не выдано — проблемы останутся только в журнале', 'error', 5000);
  });

  /* ---------- Manual / апелляции ---------- */
  const labels = h('textarea', { class: 'textarea mono', rows: '6', spellcheck: 'false' });
  labels.value = (draft.manual.labels ?? DEFAULT_LABELS).join('\n');
  const fields = h('textarea', { class: 'textarea mono', rows: '5', spellcheck: 'false' });
  fields.value = (draft.manual.fields ?? DEFAULT_AUTOMATION_FIELDS).join('\n');
  const concurrency = h('input', { class: 'input', type: 'number', min: '1', max: '6', value: draft.appeals.concurrency ?? 3 });
  const reason = h('select', { class: 'select' }, APPEAL_REASONS.map((r) => h('option', { value: r.value, selected: r.value === (draft.appeals.reason ?? 1) }, r.ru)));

  const templatesBox = h('div', { class: 'stack' });
  function renderTemplates() {
    clear(templatesBox);
    draft.appeals.templates.forEach((tpl, index) => {
      const name = h('input', { class: 'input', value: tpl.name, maxlength: '60', 'aria-label': 'Название шаблона' });
      const text = h('textarea', { class: 'textarea', rows: '3', maxlength: '2000', 'aria-label': 'Текст шаблона' });
      text.value = tpl.text;
      name.addEventListener('input', () => { tpl.name = name.value; });
      text.addEventListener('input', () => { tpl.text = text.value; });
      templatesBox.append(h('div', { class: 'card', style: { padding: '10px' } },
        h('div', { class: 'row', style: { marginBottom: '6px' } }, name,
          tpl.id === 'default' ? h('span', { class: 'pill' }, 'основной') : h('button', { class: 'icon-btn', type: 'button', title: 'Удалить', onclick: () => { draft.appeals.templates.splice(index, 1); renderTemplates(); } }, icon('trash', 15))),
        text));
    });
    templatesBox.append(h('button', { class: 'btn sm', type: 'button', onclick: () => {
      if (draft.appeals.templates.length >= 30) return toast('Не больше 30 шаблонов', 'error');
      draft.appeals.templates.push({ id: `t${Date.now().toString(36)}`, name: 'Новый шаблон', text: '' });
      renderTemplates();
    } }, icon('plus', 14), 'Добавить шаблон'));
  }
  renderTemplates();

  /* ---------- данные ---------- */
  const importInput = h('input', { type: 'file', accept: 'application/json', hidden: true });
  importInput.addEventListener('change', async () => {
    try {
      const imported = JSON.parse(await importInput.files[0].text());
      await bus.settings.save(imported);
      await ctx.saveSettings({});
      ctx.toast('Настройки импортированы', 'ok');
      closeSheet();
    } catch { ctx.toast('Не удалось импортировать файл настроек', 'error'); }
  });

  const body = [
    section('Внешний вид'), field('Тема', theme),
    section('Мониторинг кабинетов'),
    h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, 'Автопроверка'), h('span', null, 'Раз в N минут читает состояние всех кабинетов через открытую вкладку Ads Manager и показывает число проблем на значке расширения.')), monEnabled, h('span', { class: 'track' })),
    field('Интервал', monInterval, 'Каждая проверка отправляет по одному запросу на кабинет — не ставьте слишком часто.'),
    h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, 'Уведомления о новых проблемах'), h('span', null, 'Системное уведомление, когда кабинет перестал доставлять рекламу. Нужно разрешение браузера.')), monNotify, h('span', { class: 'track' })),
    h('div', { class: 'row' }, runNow, monStatus),
    section('Статус, билл и карта'),
    h('p', { class: 'hint' }, 'Кнопка «Проверить все» на вкладке «Обзор» открывает в фоне платёжные страницы РК и таблицы Business Center; ничего не вводит и не нажимает.'),
    h('div', { class: 'grid2' }, field('Параллельно', healthConcurrency, 'Больше — быстрее, но выше нагрузка на TikTok.'),
      h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, 'Таблицы BC'), h('span', null, 'Статус и порог из Business Center.')), healthBc, h('span', { class: 'track' }))),
    h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, 'Автопроверка'), h('span', null, 'Сама перепроверяет все кабинеты и пишет в журнал, если появился бан, долг, проверка или пропала карта.')), healthAuto, h('span', { class: 'track' })),
    field('Интервал автопроверки', healthInterval, 'Нужен вход в TikTok в этом браузере; на время проверки открываются фоновые вкладки.'),
    h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, 'Уведомления о новых проблемах РК'), h('span', null, 'Системное уведомление. Нужно разрешение браузера.')), healthNotify, h('span', { class: 'track' })),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await bus.health.clear(); toast('Кэш проверки очищен', 'ok'); } catch (e) { toast(e.message, 'error'); } } }, 'Сбросить кэш проверки')),
    section('Массовые действия'),
    h('p', { class: 'hint' }, 'Выключить/включить, переименовать и изменить бюджет можно сразу у многих объектов. Для этого расширение один раз запоминает настоящий запрос TikTok.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => openLearnSheet(ctx) }, icon('play', 13), 'Обучить действия'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (!confirm('Забыть все запомненные запросы?')) return; try { await bus.objects.reset(); toast('Запомненные действия сброшены', 'ok'); } catch (e) { toast(e.message, 'error'); } } }, 'Сбросить обученное')),
    section('Ссылки'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => { draft.links.favorites = [...DEFAULT_FAVORITES]; toast('Избранное будет сброшено при сохранении', 'info'); } }, 'Избранное по умолчанию'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { draft.links.overrides = {}; toast('Свои адреса ссылок будут сброшены при сохранении', 'info'); } }, 'Сбросить свои адреса')),
    section('Manual / MNL'),
    field('Метки для автоклика (по одной в строке)', labels, 'Совпадение по части текста, без учёта регистра.'),
    h('button', { class: 'btn sm ghost', type: 'button', style: { justifySelf: 'start' }, onclick: () => { labels.value = DEFAULT_LABELS.join('\n'); } }, 'Метки по умолчанию'),
    field('Поля автоматизации для перехвата (по одному в строке)', fields, 'Значения 1/true у этих ключей заменяются на 0/false. Применяется при следующем включении MNL.'),
    h('button', { class: 'btn sm ghost', type: 'button', style: { justifySelf: 'start' }, onclick: () => { fields.value = DEFAULT_AUTOMATION_FIELDS.join('\n'); } }, 'Поля по умолчанию'),
    section('Апелляции'),
    h('div', { class: 'grid2' }, field('Параллельных запросов', concurrency, '1–6'), field('Причина по умолчанию', reason)),
    section('Шаблоны текста'), templatesBox,
    section('Данные'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => download('ttads-hub-settings.json', JSON.stringify(ctx.settings, null, 2), 'application/json') }, icon('download', 13), 'Экспорт'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => importInput.click() }, icon('plus', 13), 'Импорт'), importInput),
    h('p', { class: 'hint' }, 'В экспорт входят настройки, избранное и свои ссылки, метки и заметки кабинетов.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { download(`ttads-hub-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await buildDiagnostics(ctx), null, 2), 'application/json'); toast('Диагностика сохранена', 'ok'); } catch (e) { toast(e.message, 'error'); }
      } }, icon('download', 13), 'Скачать диагностику')),
    h('p', { class: 'hint' }, 'Диагностика нужна, чтобы подстроиться под изменения TikTok: журнал, формы запросов без ID и текста, состояние задач. Без cookies, токенов, карт и полных ID.'),
    section('О расширении'),
    h('div', { class: 'card', style: { fontSize: '12px' } },
      h('p', null, h('b', null, `TTAds Hub ${VERSION}`), ' — быстрые ссылки, мониторинг кабинетов, Manual-кампании, массовые апелляции, S2S и пиксели в одном расширении.'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Основано на Plusone 3.0.10, MNL Campaign Control, Appeal Desk 0.29 и S2S_TTAds. Расширение работает только на ads.tiktok.com и business-api.tiktok.com, ничего не отправляет третьим лицам, данные хранит локально.'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Omnibox: введите «tt», пробел и запрос (например, «tt биллинг») в адресной строке. Горячая клавиша по умолчанию — Alt+Shift+K (меняется в chrome://extensions/shortcuts).'),
      h('p', { class: 'muted', style: { marginTop: '6px' } }, 'Используйте на свой риск: TikTok может менять внутренние запросы и ограничивать автоматизацию.'))
  ];

  const save = h('button', { class: 'btn primary', type: 'button' }, 'Сохранить');
  save.addEventListener('click', async () => {
    const payload = {
      ...draft,
      manual: { ...draft.manual, labels: labels.value.split('\n'), fields: fields.value.split('\n') },
      appeals: { ...draft.appeals, concurrency: Number(concurrency.value), reason: Number(reason.value) },
      links: { ...(ctx.settings?.links ?? {}), ...draft.links },
      accounts: ctx.settings?.accounts, overview: ctx.settings?.overview
    };
    try {
      // patch, а не полная замена: разделы, которые шторка не редактирует (например, automation), не затираются.
      const { manual, appeals, s2s, links, monitor, ui, health } = payload;
      await ctx.saveSettings({ manual, appeals, s2s, links, monitor, ui, health });
      saved = true;
      ctx.toast('Настройки сохранены', 'ok');
      closeSheet();
    } catch (e) { ctx.toast(e.message, 'error'); }
  });

  openSheet({
    title: 'Настройки', body, foot: [h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Отмена'), save], kind: 'settings',
    onClose: () => { if (!saved) document.documentElement.dataset.theme = originalTheme; }
  });
}
