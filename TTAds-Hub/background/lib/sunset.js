// Предупреждение о прекращении создания Legacy Manual Flow через официальный API TikTok (Sales, App Promotion, Lead Generation).
// Источник: docs/research-official-api-2026-10-28 и docs/AUDIT-1.6.0-2026-10-28.md. Чистый модуль — покрыт тестами.
export const MANUAL_API_SUNSET = Date.UTC(2027, 0, 1);

export function sunsetNotice(now = Date.now()) {
  const days = Math.ceil((MANUAL_API_SUNSET - now) / 86400000);
  const scope = 'создавать и копировать Legacy Manual-кампании для Sales, App Promotion и Lead Generation (нужен Upgraded Smart+)';
  if (days > 0) {
    return {
      kind: 'info', days,
      text: `С 1 января 2027 (через ${days} дн.) официальный API TikTok перестанет ${scope}. Расширение работает через интерфейс Ads Manager и этим напрямую не затрагивается, но сам редактор TikTok тоже может измениться — следите за обновлениями.`
    };
  }
  return {
    kind: 'warn', days: 0,
    text: `С 1 января 2027 официальный API TikTok больше не позволяет ${scope}. Расширение работает через интерфейс Ads Manager и этим напрямую не затрагивается; если «Включить Manual» перестанет находить переключатель Smart+, скачайте диагностику в настройках.`
  };
}
