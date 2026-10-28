// Просмотр кампаний / адсетов / объявлений выбранного кабинета за период (только чтение).
import { HubError, requireAdsTab, runInPage } from '../lib/page.js';
import { listObjectsInPage } from '../data/page-scripts.js';
import { LEVELS, ROW_KEYS, normalizeRows, periodRange } from './model.js';
import { PERIODS } from '../lib/constants.js';

export async function load(tabId, { account, level, period }) {
  if (!/^\d{5,30}$/.test(String(account))) throw new HubError('Некорректный ID кабинета.');
  if (!LEVELS.some((l) => l.id === level)) throw new HubError('Неизвестный уровень списка.');
  if (!PERIODS.some((p) => p.id === period)) throw new HubError('Неизвестный период.');
  const { tab } = await requireAdsTab(tabId);
  const range = periodRange(period);
  const data = await runInPage(tab.id, listObjectsInPage, [{ accounts: [{ id: String(account) }], level, ...range, keys: [...ROW_KEYS], pageSize: 200, maxRows: 1000, concurrency: 1 }]);
  if (!data) throw new HubError('Не удалось прочитать данные TikTok Ads. Обновите страницу и повторите.');
  if (data.error) throw new HubError(data.error);
  const result = data.results?.[0];
  if (!result || result.error) throw new HubError(result?.error || 'TikTok не вернул данные.');
  return { account: String(account), level, period, ...range, total: result.total, truncated: result.truncated, rows: normalizeRows(level, result.rows), at: data.at };
}
