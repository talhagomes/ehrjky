// Вкладка «Пиксель»: создаёт пиксель в открытом кабинете и сразу отдаёт Pixel Code и Developer token.
import { h, toast, copyText, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { PIXEL_EVENTS } from '../../background/lib/constants.js';
import { TEST_SESSION_KEY } from './s2s.js';

export function mountPixel(root, ctx) {
  let busy = false;

  const field = (label, control) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
  const copyBtn = (getText) => h('button', { class: 'btn sm', type: 'button', title: 'Скопировать', 'aria-label': 'Скопировать', onclick: async () => { const text = getText(); if (text && await copyText(text)) toast('Скопировано', 'ok'); } }, icon('copy', 13));
  const alert = (kind, glyph, ...body) => h('div', { class: `alert ${kind}` }, icon(glyph, 15), h('div', null, ...body));

  const events = h('datalist', { id: 'tth-pixel-events' }, PIXEL_EVENTS.map((e) => h('option', { value: e })));
  const name = h('input', { class: 'input', placeholder: 'Pixel_<кабинет>_<время> (по умолчанию)', autocomplete: 'off', spellcheck: 'false' });
  const useRule = h('input', { type: 'checkbox', checked: true });
  const words = h('input', { class: 'input mono', value: 'thank-you, approved', spellcheck: 'false' });
  const ruleEvent = h('input', { class: 'input', list: 'tth-pixel-events', value: 'Purchase' });
  const status = h('div', { 'aria-live': 'polite' });
  const result = h('div');
  const button = h('button', { class: 'btn primary', type: 'button' }, icon('zap', 14), 'Создать пиксель и получить токен');

  const ready = () => ctx.onAds && Boolean(ctx.account);

  function renderStatus() {
    if (!ctx.onAds) {
      fill(status, alert('warn', 'alert', 'Откройте вкладку Ads Manager (ads.tiktok.com) нужного кабинета: пиксель создаётся в нём от имени вашей сессии.'));
    } else if (!ctx.account) {
      fill(status, alert('warn', 'alert', 'В адресе вкладки нет aadvid. Откройте любую страницу нужного кабинета, например «Кампании».'));
    } else {
      const known = ctx.accounts.peek()?.accounts?.find((a) => a.id === ctx.account);
      fill(status, alert('info', 'target', h('b', null, 'Пиксель будет создан в кабинете'), h('div', { class: 'small mono' }, known?.name ? `${known.name} · ${ctx.account}` : ctx.account)));
    }
    button.disabled = busy || !ready();
  }

  // Подставляет пиксель и токен в «Тест события» (вкладка S2S): оттуда уходит первое событие, активирующее пиксель.
  async function sendToTest(res) {
    try {
      const prev = (await chrome.storage.session.get(TEST_SESSION_KEY))[TEST_SESSION_KEY] ?? {};
      await chrome.storage.session.set({ [TEST_SESSION_KEY]: { ...prev, pixel: res.pixelCode, token: res.devToken || '' } });
    } catch { /* сессионное хранилище недоступно: поля останутся пустыми */ }
    ctx.show('s2s', { focus: 'test' });
    toast('Пиксель и токен подставлены в «Тест события»', 'ok');
  }

  function renderResult(res) {
    fill(result,
      alert('ok', 'check', h('b', null, 'Пиксель создан'), h('div', { class: 'small muted' }, `${res.pixelName}${res.ruleCreated ? ' · URL-правило добавлено' : ''}`)),
      ...(res.warnings ?? []).map((w) => h('div', { style: { marginTop: '8px' } }, alert('warn', 'alert', w))),
      h('dl', { class: 'kv', style: { marginTop: '8px', alignItems: 'center' } },
        h('dt', null, 'Pixel Code'), h('dd', null, res.pixelCode, ' ', copyBtn(() => res.pixelCode)),
        h('dt', null, 'Token'), h('dd', null, res.devToken ? `${res.devToken.slice(0, 6)}…${res.devToken.slice(-4)}` : 'не получен', ' ', res.devToken ? copyBtn(() => res.devToken) : null)),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', type: 'button', onclick: () => sendToTest(res) }, icon('play', 13), 'В «Тест события»'),
        h('span', { class: 'hint' }, 'Чтобы активировать пиксель, отправьте ему событие.')));
  }

  button.addEventListener('click', async () => {
    busy = true;
    renderStatus();
    fill(result, h('div', { class: 'row' }, h('span', { class: 'spinner' }), 'Создаю пиксель в кабинете…'));
    try {
      const keywords = words.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
      renderResult(await bus.s2s.pixel(ctx.tabId, { name: name.value.trim(), createRule: useRule.checked, keywords, ruleEvent: ruleEvent.value.trim() || 'Purchase' }));
    } catch (e) {
      fill(result, alert('err', 'alert', e.message));
    } finally {
      busy = false;
      renderStatus();
    }
  });

  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, icon('target', 15), 'Быстрый пиксель'), h('span', { class: 'pill warn' }, 'из вкладки TikTok')),
    h('div', { class: 'stack' },
      status,
      field('Название (необязательно)', name),
      h('label', { class: 'check' }, useRule, h('span', null, 'Добавить URL-правило события по ключевым словам')),
      h('div', { class: 'grid2' }, field('Слова в URL (до 5)', words), field('Событие правила', ruleEvent)),
      h('div', { class: 'row wrap' }, button),
      result));

  const stopTab = ctx.onTab(renderStatus);
  renderStatus();
  root.append(h('div', { class: 'stack' }, events, card));
  return stopTab;
}
