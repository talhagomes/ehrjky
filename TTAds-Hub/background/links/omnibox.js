// Omnibox: «tt <запрос>» в адресной строке открывает быструю ссылку из любой вкладки.
import { allLinks, omniboxSuggestions, parseOmniboxInput, resolveLink, parseContext } from './catalog.js';
import { getSettings, patchSettings } from '../lib/storage.js';
import { getLastContext } from './context.js';
import * as accounts from '../accounts/engine.js';

// Кабинет и BC для подстановки: активная вкладка → последний открытый кабинет → BC из кэша списка кабинетов.
export async function currentContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const fromTab = (tab?.url && parseContext(tab.url)) || { aadvid: '', bcid: '' };
  const last = await getLastContext();
  const aadvid = fromTab.aadvid || last.aadvid;
  // BC берётся от самого кабинета; последний открытый BC — только если кабинет неизвестен (иначе ссылки уйдут в чужой BC).
  const info = aadvid ? (await accounts.cached())?.accounts?.find((a) => a.id === aadvid) : null;
  const bcid = fromTab.bcid || (info ? info.bcId : last.bcid);
  return { aadvid, bcid };
}

export async function suggestFor(text) {
  const settings = await getSettings();
  return omniboxSuggestions(text, allLinks(settings.links), { favorites: settings.links.favorites });
}

async function rememberRecent(id) {
  const settings = await getSettings();
  const recents = [id, ...settings.links.recents.filter((x) => x !== id)].slice(0, 8);
  await patchSettings({ links: { ...settings.links, recents } });
}

// disposition: currentTab | newForegroundTab | newBackgroundTab
export async function enter(text, disposition = 'currentTab') {
  const settings = await getSettings();
  const link = parseOmniboxInput(text, allLinks(settings.links), { favorites: settings.links.favorites });
  if (!link) return { ok: false, reason: 'not-found' };
  const resolved = resolveLink(link, await currentContext(), settings.links.overrides);
  if (!resolved.ok) return { ok: false, reason: 'unresolved', link: link.id };
  if (disposition === 'newForegroundTab') await chrome.tabs.create({ url: resolved.url, active: true });
  else if (disposition === 'newBackgroundTab') await chrome.tabs.create({ url: resolved.url, active: false });
  else await chrome.tabs.update({ url: resolved.url });
  rememberRecent(link.id).catch(() => {});
  return { ok: true, url: resolved.url, link: link.id };
}

export function registerOmnibox() {
  if (!chrome.omnibox) return;
  chrome.omnibox.setDefaultSuggestion({ description: 'Быстрые ссылки TTAds Hub: <match>биллинг</match>, <match>создать bc</match>, <match>пиксель</match>, <match>кампании</match>…' });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => { suggestFor(text).then(suggest, () => suggest([])); });
  chrome.omnibox.onInputEntered.addListener((text, disposition) => { enter(text, disposition).catch(() => {}); });
}
