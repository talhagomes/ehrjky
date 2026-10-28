import { h, toast, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { sunsetNotice } from '../../background/lib/sunset.js';

const GOAL = { app: 'App Promotion', lead: 'Lead Generation', sales: 'Sales' };
const HERO_ICON = { idle: 'target', ready: 'zap', working: 'refresh', done: 'check', error: 'alert' };

const browserTimezone = () => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const minutes = -new Date().getTimezoneOffset(), abs = Math.abs(minutes);
    return `${zone} (UTC${minutes >= 0 ? '+' : '−'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')})`;
  } catch { return ''; }
};

export function mountManual(root, ctx) {
  let status = null, loadError = '', local = { working: false, error: '' };
  let stopped = false, timer = null, fast = 0, inflight = false, lastSig = '', tzAccount = null, pageTz = null;
  const browserTz = browserTimezone();

  const hero = h('section', { class: 'card hero' });
  const steps = h('section', { class: 'card' });
  const mnl = h('section', { class: 'card' });
  const sunset = sunsetNotice();
  root.append(h('div', { class: 'stack' }, hero, steps, mnl,
    h('div', { class: `alert ${sunset.kind}`, role: 'note' }, icon('info', 15), h('div', null, sunset.text)),
    h('p', { class: 'hint', style: { textAlign: 'center' } }, 'Только черновик: публикацию кампании расширение не выполняет.')));

  const stopTab = ctx.onTab(() => { status = null; loadError = ''; local.error = ''; lastSig = ''; poll(); });

  async function poll() {
    if (stopped || inflight) return;
    inflight = true;
    try {
      status = ctx.tabId && ctx.onAds ? await bus.manual.status(ctx.tabId) : { onAds: false };
      loadError = '';
    } catch (e) { loadError = e.message; }
    inflight = false;
    const account = status?.state?.account;
    if (account && account !== tzAccount) {
      tzAccount = account;
      bus.manual.timezone(ctx.tabId).then((r) => { pageTz = r?.page ?? null; render(); }).catch(() => {});
    }
    if (!stopped) render();
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { if (document.visibilityState !== 'hidden') await poll(); schedule(); }, fast > Date.now() ? 700 : 1500);
  }

  function describe() {
    const s = status?.state;
    if (!ctx.tab) return { kind: 'idle', title: 'Вкладка не найдена', text: 'Откройте TikTok Ads Manager в браузере.' };
    if (!ctx.onAds) return { kind: 'idle', title: 'Откройте TikTok Ads Manager', text: 'Расширение работает на странице ads.tiktok.com.', action: { label: 'Открыть Ads Manager', icon: 'external', run: openAds } };
    if (loadError) return { kind: 'error', title: 'Нет связи со страницей', text: loadError };
    if (!status) return { kind: 'working', title: 'Читаю страницу…', text: '' };
    if (!s?.account) return { kind: 'idle', title: 'Кабинет не определён', text: 'В адресе нет aadvid. Откройте нужный рекламный кабинет.' };
    const goal = GOAL[s.objective];
    if (local.working || s.busy || s.armed) {
      return {
        kind: 'working', title: 'Переключаю на Manual…',
        text: s.viewPending ? 'Черновик сохранён. Проверяю выбор Manual в редакторе.' : s.armed ? 'Перехватываю штатное сохранение черновика TikTok.' : 'Это займёт несколько секунд. Страница может перезагрузиться.',
        secondary: s.armed ? { label: 'Отмена', run: onCancel } : null
      };
    }
    if (s.lastError) return { kind: 'error', title: 'Не удалось переключить', text: s.lastError, action: s.canActivate ? { label: 'Повторить', icon: 'refresh', run: onActivate } : null };
    if (local.error) return { kind: 'error', title: 'Не удалось переключить', text: local.error, action: s.canActivate ? { label: 'Повторить', icon: 'refresh', run: onActivate } : null };
    if (s.draft && s.manual?.shown) return {
      kind: 'done', title: 'Manual активен',
      text: `${s.manual.mode === 'unified' ? 'Smart+ выключен · ' : ''}черновик ${s.draft.slice(-8)}${goal ? ' · ' + goal : ''}. Продолжайте настройку кампании.`
    };
    if (s.draft && s.manual?.present) return { kind: 'ready', title: 'Manual уже в черновике', text: 'Нажмите, чтобы открыть ручной вариант в редакторе.', action: { label: 'Показать Manual', icon: 'zap', run: onActivate } };
    if (s.canActivate) {
      return {
        kind: 'ready', title: goal ? `Цель: ${goal}` : 'Готово к переключению',
        text: s.canCreate ? 'Расширение продолжит создание и отключит Smart+ в новом черновике.' : s.manual?.smartPlus ? 'Smart+ будет отключён через сохранение черновика; страница затем проверит custom mode.' : 'Черновик откроется заново в ручном режиме — несохранённые правки лучше сохранить.',
        action: { label: 'Включить Manual', icon: 'zap', run: onActivate }
      };
    }
    return { kind: 'idle', title: 'Выберите цель кампании', text: 'Нажмите «Создать» и выберите App Promotion, Lead Generation или Sales — затем вернитесь сюда.' };
  }

  function render() {
    const d = describe();
    const s = status?.state;
    const agent = status?.agent;
    const flow = [
      ['Откройте TikTok Ads Manager', ctx.onAds],
      ['Нажмите «Создать» и выберите цель кампании', Boolean(s?.objective)],
      ['Нажмите «Включить Manual»', Boolean(s?.manual?.present || s?.manual?.shown)]
    ];
    // Перерисовываем только при изменении видимой модели: иначе опрос каждые ~1,5 с сбивает клики и фокус.
    const sig = JSON.stringify([d.kind, d.title, d.text, d.action?.label ?? null, d.secondary?.label ?? null, flow.map((f) => f[1]),
      Boolean(agent), agent?.interceptor, agent?.loaded, ctx.onAds, ctx.settings?.manual?.autoClick, pageTz]);
    if (sig === lastSig) return;
    lastSig = sig;

    fill(hero,
      h('div', { class: `ring ${d.kind}` }, icon(HERO_ICON[d.kind], 26)),
      h('h2', { class: 'hero-title' }, d.title),
      h('p', { class: 'hero-text' }, d.text),
      d.action || d.secondary ? h('div', { class: 'hero-actions' },
        d.action ? h('button', { class: 'btn primary', type: 'button', onclick: d.action.run }, icon(d.action.icon, 16), d.action.label) : null,
        d.secondary ? h('button', { class: 'btn', type: 'button', onclick: d.secondary.run }, d.secondary.label) : null) : null
    );

    const current = flow.findIndex(([, done]) => !done);
    fill(steps,
      h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('list', 15), 'Порядок работы')),
      h('ol', { class: 'steps' }, flow.map(([label, done], i) =>
        h('li', { class: `step ${done ? 'done' : i === current ? 'current' : ''}` },
          h('span', { class: 'dot' }, done ? icon('check', 11) : String(i + 1)), label))),
      browserTz ? h('p', { class: 'hint', style: { marginTop: '10px' } }, `Часовой пояс: ${pageTz ? `кабинет — ${pageTz}, ` : ''}браузер — ${browserTz}`) : null
    );

    renderMnl();
  }

  function renderMnl() {
    const agent = status?.agent;
    const enabled = Boolean(agent?.interceptor);
    const pending = agent && agent.interceptor !== agent.loaded;
    const settings = ctx.settings;
    fill(mnl,
      h('div', { class: 'card-head' },
        h('div', { class: 'card-title' }, icon('shield', 15), 'Режим MNL'),
        h('span', { class: `pill ${enabled ? 'ok' : ''}` }, enabled ? (pending ? 'применится после F5' : 'включён') : 'выключен')),
      h('div', { class: 'stack' },
        switchRow('Перехват флагов автоматизации', 'Переключает 1 → 0 в запросах и ответах TikTok. Страница перезагрузится.', enabled,
          !agent || !ctx.onAds, async (checked, input) => {
            input.disabled = true;
            try { await bus.manual.interceptor(ctx.tabId, checked); toast(checked ? 'MNL включён, страница обновляется' : 'MNL выключен, страница обновляется', 'ok'); } catch (e) { toast(e.message, 'error'); input.checked = !checked; }
            setTimeout(() => { lastSig = ''; poll(); }, 1200);
          }),
        switchRow('Автоклик по меткам', 'Нажимает ручные настройки на экране создания кампании.', Boolean(settings?.manual?.autoClick), !settings,
          async (checked, input) => {
            try { await ctx.saveSettings({ manual: { autoClick: checked } }); toast(checked ? 'Автоклик включён' : 'Автоклик выключен', 'ok'); } catch (e) { toast(e.message, 'error'); input.checked = !checked; }
          }),
        !agent && ctx.onAds ? h('p', { class: 'hint' }, 'Агент страницы не отвечает — обновите вкладку TikTok (F5).') : null
      )
    );
  }

  function switchRow(title, sub, checked, disabled, onChange) {
    const input = h('input', { type: 'checkbox', checked, disabled });
    input.addEventListener('change', () => onChange(input.checked, input));
    return h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', null, title), h('span', null, sub)), input, h('span', { class: 'track' }));
  }

  async function onActivate() {
    if (local.working) return;
    local = { working: true, error: '' };
    fast = Date.now() + 45000;
    render();
    try {
      const result = await bus.manual.activate(ctx.tabId, status?.state?.account);
      if (result?.shown) toast('Manual показан в редакторе', 'ok');
    } catch (e) { local.error = e.message; toast(e.message, 'error'); } finally { local.working = false; poll(); }
  }

  async function onCancel() {
    try { await bus.manual.cancel(ctx.tabId); toast('Отменено', 'ok'); } catch (e) { toast(e.message, 'error'); }
    poll();
  }

  async function openAds() {
    await chrome.tabs.create({ url: 'https://ads.tiktok.com/' });
    if (ctx.mode === 'popup') window.close();
  }

  render();
  poll().then(schedule);
  return () => { stopped = true; clearTimeout(timer); stopTab(); };
}
