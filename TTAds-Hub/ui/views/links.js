// Вкладка «Ссылки»: быстрый доступ к Business Center, созданию кабинетов, биллингу и всем рабочим разделам TikTok Ads
// с подстановкой выбранного кабинета и BC, избранным, поиском и собственными ссылками.
import { h, fill, copyText, toast } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as bus from '../lib/bus.js';
import { openSheet, closeSheet } from '../lib/sheet.js';
import {
  GROUPS, allLinks, resolveLink, linkTemplate, searchLinks, isSafeHttpUrl, isTikTokUrl, fromCurrentUrl, newCustomId, parseContext, hostOf
} from '../../background/links/catalog.js';

const CONF_NOTE = 'Адрес собран по структуре Business Center и не проверялся на живом кабинете. Если страница не открылась — пройдите путь из подсказки.';

export function mountLinks(root, ctx) {
  const prefs = () => ctx.settings?.links ?? { openIn: 'new', favorites: [], recents: [], custom: [], overrides: {} };
  const S = { query: '', account: 'auto', bc: 'auto', last: { aadvid: '', bcid: '' }, menu: null, collapsed: new Set() };
  let stopped = false;
  try { S.collapsed = new Set(JSON.parse(localStorage.getItem('tth.links.collapsed') || '[]')); } catch { /* по умолчанию всё раскрыто */ }

  const wanted = ctx.takeParams('links');
  if (wanted?.account) S.account = wanted.account;

  /* ---------- контекст: кабинет и Business Center ---------- */
  const accountsCache = () => ctx.accounts.peek();
  const accountInfo = (id) => accountsCache()?.accounts?.find((a) => a.id === id);
  const tabContext = () => parseContext(ctx.tab?.url ?? '') ?? { aadvid: '', bcid: '' };

  function effective() {
    const tab = tabContext();
    const aadvid = S.account === 'auto' ? (tab.aadvid || S.last.aadvid) : S.account;
    // BC берётся от самого кабинета; последний открытый BC — только если кабинет в списке неизвестен.
    const info = accountInfo(aadvid);
    const bcid = S.bc === 'auto' ? ((S.account !== 'auto' && info?.bcId) || tab.bcid || (info ? info.bcId : S.last.bcid)) : S.bc;
    return { aadvid, bcid };
  }

  /* ---------- открытие ссылки ---------- */
  async function open(link, event) {
    if (link.app) {
      const recents = [link.id, ...prefs().recents.filter((x) => x !== link.id)].slice(0, 8);
      ctx.saveSettings({ links: { ...prefs(), recents } }).catch(() => {});
      ctx.show(link.app);
      return;
    }
    const resolved = resolveLink(link, effective(), prefs().overrides);
    if (!resolved.ok) { toast('Не удалось собрать адрес: не хватает данных кабинета или BC', 'error'); return; }
    const invert = Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1));
    const where = (prefs().openIn === 'current') !== invert ? 'current' : 'new';
    const recents = [link.id, ...prefs().recents.filter((x) => x !== link.id)].slice(0, 8);
    ctx.saveSettings({ links: { ...prefs(), recents } }).catch(() => {});
    if (link.hint) toast(link.hint, 'info', 7000);
    else if (resolved.missing.includes('aadvid')) toast('Кабинет не выбран — TikTok откроет последний использованный', 'info');
    await ctx.open(resolved.url, { where });
  }

  async function copy(link) {
    const resolved = resolveLink(link, effective(), prefs().overrides);
    if (resolved.ok && await copyText(resolved.url)) toast('Ссылка скопирована', 'ok');
    else toast('Не удалось скопировать', 'error');
  }

  const save = (patch) => ctx.saveSettings({ links: { ...prefs(), ...patch } });
  const toggleFavorite = async (id) => {
    const fav = prefs().favorites;
    if (!fav.includes(id) && fav.length >= 30) { toast('В избранном не больше 30 ссылок', 'error'); return; }
    await save({ favorites: fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id] });
    render();
  };

  /* ---------- правка и добавление ссылок ---------- */
  function openEditor({ link = null, prefill = null }) {
    const builtin = link && !link.custom;
    const tpl = builtin ? linkTemplate(link, prefs().overrides).url : link?.url ?? prefill?.url ?? '';
    const title = h('input', { class: 'input', value: link?.title ?? prefill?.title ?? '', maxlength: '60', placeholder: 'Например: Keitaro — админка', disabled: builtin, 'aria-label': 'Название' });
    const url = h('input', { class: 'input mono', value: tpl, placeholder: 'https://…', spellcheck: 'false', 'aria-label': 'Адрес' });
    const hint = h('input', { class: 'input', value: link?.hint ?? '', maxlength: '160', placeholder: 'Подсказка при открытии (необязательно)', disabled: builtin, 'aria-label': 'Подсказка' });
    const error = h('p', { class: 'hint', style: { color: 'var(--err)' } });
    const finish = async (patch) => { await save(patch); closeSheet(); render(); };
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Сохранить');
    saveBtn.addEventListener('click', async () => {
      const value = url.value.trim();
      if (!isSafeHttpUrl(value, { allowPlaceholders: true })) { error.textContent = 'Нужен корректный адрес, начинающийся с https:// или http:// (без логина и пароля в адресе)'; return; }
      if (builtin && !isTikTokUrl(value, { allowPlaceholders: true })) { error.textContent = 'Для встроенных ссылок допустимы только адреса tiktok.com. Другие сайты добавляйте как «Свою ссылку».'; return; }
      if (!link && !builtin && prefs().custom.length >= 100) { error.textContent = 'Достигнут лимит: не больше 100 своих ссылок.'; return; }
      try {
        if (builtin) {
          const overrides = { ...prefs().overrides };
          if (value === link.url) delete overrides[link.id]; else overrides[link.id] = value;
          await finish({ overrides });
        } else if (link) {
          await finish({ custom: prefs().custom.map((c) => (c.id === link.id ? { ...c, title: title.value.trim() || 'Ссылка', url: value, hint: hint.value.trim() } : c)) });
        } else {
          const id = newCustomId();
          await finish({ custom: [...prefs().custom, { id, title: title.value.trim() || hostOf(value) || 'Ссылка', url: value, hint: hint.value.trim() }].slice(0, 100), favorites: prefs().favorites });
        }
        toast('Сохранено', 'ok');
      } catch (e) { error.textContent = e.message; }
    });
    const foot = [h('button', { class: 'btn', type: 'button', onclick: closeSheet }, 'Отмена')];
    if (builtin && prefs().overrides[link.id]) foot.push(h('button', { class: 'btn', type: 'button', onclick: () => finish({ overrides: Object.fromEntries(Object.entries(prefs().overrides).filter(([k]) => k !== link.id)) }) }, 'Сбросить адрес'));
    foot.push(saveBtn);
    const field = (label, control) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
    openSheet({
      title: builtin ? `Адрес ссылки «${link.title}»` : link ? 'Изменить ссылку' : 'Новая ссылка',
      body: [
        builtin ? h('div', { class: 'alert info' }, icon('info', 15), h('div', null, 'Здесь можно подставить свой адрес для этой ссылки — например, точную страницу, скопированную из вашего кабинета.')) : null,
        prefill?.note ? h('div', { class: 'alert info' }, icon('info', 15), h('div', null, prefill.note)) : null,
        field('Название', title), field('Адрес', url), builtin ? null : field('Подсказка', hint),
        h('p', { class: 'hint' }, 'Подстановки: ', h('b', { class: 'mono' }, '{aadvid}'), ' — ID кабинета, ', h('b', { class: 'mono' }, '{bcid}'), ' — ID Business Center. Ссылка откроется для выбранного выше кабинета.'),
        error
      ],
      foot, kind: 'link-editor'
    });
  }

  async function saveCurrentPage() {
    await ctx.refreshTab(); // адрес вкладки в интерфейсе обновляется раз в 1,5 с — читаем свежий
    const found = ctx.tab?.url ? fromCurrentUrl(ctx.tab.url) : null;
    if (!found) { toast('Эту страницу нельзя сохранить как ссылку', 'error'); return; }
    const note = [
      found.hasAccount || found.hasBc ? `ID ${[found.hasAccount && 'кабинета', found.hasBc && 'Business Center'].filter(Boolean).join(' и ')} заменён на подстановку — ссылка будет работать для любого выбранного кабинета.` : '',
      found.trimmed ? 'Параметры адреса, похожие на токены, и все параметры сторонних сайтов не сохранены.' : ''
    ].filter(Boolean).join(' ');
    openEditor({ prefill: { title: String(ctx.tab.title ?? '').slice(0, 60), url: found.template, note } });
  }

  /* ---------- отрисовка ---------- */
  const contextCard = h('section', { class: 'card links-ctx' });
  const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Поиск: биллинг, создать BC, пиксель, кампании…', 'aria-label': 'Поиск по ссылкам', autocomplete: 'off', spellcheck: 'false' });
  const results = h('div', { class: 'links-results' });
  const actions = h('div', { class: 'row wrap links-actions' },
    h('button', { class: 'btn sm', type: 'button', onclick: () => openEditor({}) }, icon('plus', 14), 'Своя ссылка'),
    h('button', { class: 'btn sm', type: 'button', onclick: saveCurrentPage }, icon('star', 14), 'Сохранить эту страницу'));
  root.append(h('div', { class: 'stack' }, contextCard, h('div', { class: 'search' }, icon('search', 14), searchInput), results, actions));

  function renderContextCard() {
    const cache = accountsCache();
    const accounts = cache?.accounts ?? [];
    const tab = tabContext();
    const autoAccount = tab.aadvid || S.last.aadvid;
    const accountSelect = h('select', { class: 'select', 'aria-label': 'Кабинет' },
      h('option', { value: 'auto', selected: S.account === 'auto' }, autoAccount ? `Авто: ${accountInfo(autoAccount)?.name ?? `…${autoAccount.slice(-6)}`}` : 'Авто: последний кабинет'),
      ...(() => {
        const byBc = new Map();
        for (const a of accounts) byBc.set(a.businessCenter || 'Без Business Center', [...(byBc.get(a.businessCenter || 'Без Business Center') ?? []), a]);
        return [...byBc].map(([bc, items]) => h('optgroup', { label: bc }, items.map((a) => h('option', { value: a.id, selected: S.account === a.id }, `${a.name} · …${a.id.slice(-6)}`))));
      })());
    accountSelect.addEventListener('change', () => { S.account = accountSelect.value; if (S.account !== 'auto') S.bc = 'auto'; renderContextCard(); render(); });
    const centers = cache?.businessCenters ?? [];
    const bcSelect = h('select', { class: 'select', 'aria-label': 'Business Center', disabled: !centers.length },
      h('option', { value: 'auto', selected: S.bc === 'auto' }, centers.length ? 'Авто: по кабинету' : 'BC не загружены'),
      centers.map((c) => h('option', { value: c.id, selected: S.bc === c.id }, `${c.name} · ${c.accountCount}`)));
    bcSelect.addEventListener('change', () => { S.bc = bcSelect.value; render(); });
    const eff = effective();
    fill(contextCard,
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Кабинет'), accountSelect),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Business Center'), bcSelect)),
      h('div', { class: 'row links-ctx-foot' },
        h('span', { class: 'hint' }, 'Открывать:'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Где открывать ссылки' },
          ['new', 'current'].map((mode) => h('button', { type: 'button', 'aria-pressed': String(prefs().openIn === mode), onclick: async () => { await save({ openIn: mode }); renderContextCard(); } }, mode === 'new' ? 'в новой вкладке' : 'в текущей'))),
        h('span', { class: 'spacer' }),
        !cache?.accounts?.length && ctx.onAds
          ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await ctx.accounts.get({ force: true }); renderContextCard(); render(); } catch (e) { toast(e.message, 'error'); } } }, icon('refresh', 13), 'Загрузить кабинеты')
          : h('span', { class: 'hint mono', title: `Кабинет ${eff.aadvid || '—'} · BC ${eff.bcid || '—'}` }, eff.aadvid ? `…${eff.aadvid.slice(-6)}` : 'без кабинета')));
  }

  function rowFor(link) {
    const tpl = linkTemplate(link, prefs().overrides);
    const needsAccount = tpl.url.includes('{aadvid}'), needsBc = tpl.url.includes('{bcid}');
    const eff = effective();
    const fav = prefs().favorites.includes(link.id);
    const note = (needsAccount && !eff.aadvid) ? 'без кабинета' : (needsBc && !eff.bcid) ? 'BC не определён — откроется главная' : '';
    const main = h('button', { class: 'link-main', type: 'button', 'aria-label': link.title, onclick: (e) => open(link, e) },
      h('span', { class: 'link-ico' }, icon(link.icon || 'link', 17)),
      h('span', { class: 'link-text' },
        h('span', { class: 'link-title' }, link.title,
          link.conf === 'pattern' && !tpl.overridden ? h('span', { class: 'pill warn', title: CONF_NOTE }, '≈') : null,
          tpl.overridden ? h('span', { class: 'pill info', title: 'Подставлен ваш адрес' }, 'свой адрес') : null),
        h('span', { class: 'link-desc' }, link.desc, note ? h('em', null, ` · ${note}`) : null),
        link.hint ? h('span', { class: 'link-hint' }, link.hint) : null));
    main.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); open(link, e); } });
    const star = h('button', { class: `icon-btn star${fav ? ' on' : ''}`, type: 'button', 'aria-label': fav ? 'Убрать из избранного' : 'В избранное', 'aria-pressed': String(fav), title: fav ? 'Убрать из избранного' : 'В избранное', onclick: () => toggleFavorite(link.id) }, icon('star', 15));
    const more = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ещё', 'aria-expanded': String(S.menu === link.id), title: 'Ещё', onclick: () => { S.menu = S.menu === link.id ? null : link.id; render(); } }, icon('more', 15));
    const copyBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Скопировать ссылку', title: 'Скопировать ссылку', onclick: () => copy(link) }, icon('copy', 14));
    const menu = S.menu === link.id ? h('div', { class: 'link-menu', role: 'menu' },
      h('button', { class: 'btn sm', type: 'button', role: 'menuitem', onclick: () => { S.menu = null; render(); openEditor({ link }); } }, icon('edit', 13), link.custom ? 'Изменить' : 'Свой адрес…'),
      tpl.overridden ? h('button', { class: 'btn sm', type: 'button', role: 'menuitem', onclick: async () => { const o = { ...prefs().overrides }; delete o[link.id]; await save({ overrides: o }); S.menu = null; render(); } }, icon('refresh', 13), 'Сбросить адрес') : null,
      link.custom ? h('button', { class: 'btn sm danger', type: 'button', role: 'menuitem', onclick: async () => { await save({ custom: prefs().custom.filter((c) => c.id !== link.id), favorites: prefs().favorites.filter((x) => x !== link.id) }); S.menu = null; render(); } }, icon('trash', 13), 'Удалить') : null) : null;
    return h('div', { class: 'link-row', role: 'listitem', dataset: { id: link.id } }, h('div', { class: 'link-line' }, main, h('div', { class: 'link-actions' }, star, copyBtn, more)), menu);
  }

  function tileFor(link) {
    const tile = h('button', { class: 'link-tile', type: 'button', dataset: { id: link.id }, title: link.hint || link.desc, onclick: (e) => open(link, e) },
      h('span', { class: 'link-ico' }, icon(link.icon || 'link', 18)), h('span', { class: 'tile-title' }, link.title));
    tile.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); open(link, e); } });
    return tile;
  }

  const searchable = () => allLinks(prefs());
  const visibleCustom = () => allLinks(prefs()).filter((l) => l.custom);

  function render() {
    const links = searchable();
    const byId = new Map(links.map((l) => [l.id, l]));
    const query = S.query.trim();
    if (query) {
      const found = searchLinks(query, links, { favorites: prefs().favorites });
      fill(results, found.length
        ? h('section', { class: 'links-section' }, h('div', { class: 'section-label' }, `Найдено: ${found.length}`), h('div', { class: 'links-list', role: 'list' }, found.map(rowFor)))
        : h('div', { class: 'empty' }, h('div', { class: 'ico-big' }, icon('search', 22)), h('h3', null, 'Ничего не найдено'),
          h('p', null, 'Попробуйте другое слово или добавьте свою ссылку.'), h('button', { class: 'btn sm', type: 'button', onclick: () => openEditor({}) }, icon('plus', 14), 'Своя ссылка')));
      return;
    }
    const favs = prefs().favorites.map((id) => byId.get(id)).filter(Boolean);
    const recents = prefs().recents.map((id) => byId.get(id)).filter((l) => l && !prefs().favorites.includes(l.id)).slice(0, 5);
    const groupBlocks = GROUPS.map((g) => {
      const items = links.filter((l) => l.group === g.id);
      if (!items.length && g.id !== 'custom') return null;
      const details = h('details', { class: 'links-group', open: !S.collapsed.has(g.id) },
        h('summary', null, icon(g.icon, 15), h('b', null, g.title), h('span', { class: 'count' }, items.length), icon('chevron', 14)),
        items.length ? h('div', { class: 'links-list', role: 'list' }, items.map(rowFor))
          : h('p', { class: 'hint', style: { padding: '8px 12px' } }, 'Здесь появятся ваши ссылки: трекер, прокси-панель, сервис карт. Нажмите «Своя ссылка» или «Сохранить эту страницу».'));
      details.addEventListener('toggle', () => { if (details.open) S.collapsed.delete(g.id); else S.collapsed.add(g.id); try { localStorage.setItem('tth.links.collapsed', JSON.stringify([...S.collapsed])); } catch { /* необязательно */ } });
      return details;
    });
    fill(results,
      favs.length ? h('section', { class: 'links-section' }, h('div', { class: 'section-label' }, 'Избранное'), h('div', { class: 'link-tiles' }, favs.map(tileFor))) : null,
      recents.length ? h('section', { class: 'links-section' }, h('div', { class: 'section-label' }, 'Недавние'), h('div', { class: 'link-chips' }, recents.map((l) => h('button', { class: 'chip', type: 'button', onclick: (e) => open(l, e) }, l.title)))) : null,
      ...groupBlocks);
  }

  searchInput.addEventListener('input', () => { S.query = searchInput.value; S.menu = null; render(); });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && S.query) { searchInput.value = ''; S.query = ''; render(); event.stopPropagation(); return; }
    if (event.key === 'ArrowDown') { results.querySelector('.link-main')?.focus(); event.preventDefault(); return; }
    if (event.key !== 'Enter' || !S.query.trim()) return;
    const first = searchLinks(S.query, searchable(), { favorites: prefs().favorites })[0];
    if (first) open(first, event);
  });

  const stopTab = ctx.onTab(() => { if (!stopped) { renderContextCard(); render(); } });
  renderContextCard();
  render();
  bus.context.get().then((last) => { if (!stopped && last) { S.last = last; renderContextCard(); render(); } }).catch(() => {});
  ctx.accounts.get().then(() => { if (!stopped) { renderContextCard(); render(); } }).catch(() => {});
  if (!wanted) queueMicrotask(() => searchInput.focus({ preventScroll: true }));

  return () => { stopped = true; stopTab(); closeSheet(); };
}
