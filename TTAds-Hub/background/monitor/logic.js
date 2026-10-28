// Логика мониторинга: какие кабинеты считаются проблемными, что изменилось с прошлой проверки, значок и уведомление.
// Чистый модуль без chrome.* — покрыт юнит-тестами.

// Проблемы: кабинет, где ни одна кампания не доставляется при включённых (state «issue»), либо кабинет с ошибкой доступа к данным.
// Частичные проблемы (часть кампаний доставляется) в значок не попадают — они видны в карточке кабинета и в просмотре объектов.
export function problemsOf(accounts) {
  const out = [];
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a.state === 'issue') out.push({ id: a.id, name: a.name, kind: 'issue', count: a.problemCampaigns || 1, reason: a.reasons?.[0]?.text || 'Не доставляется', reasonKind: a.reasons?.[0]?.kind || 'other' });
    else if (a.state === 'error') out.push({ id: a.id, name: a.name, kind: 'error', count: 1, reason: String(a.error || 'Ошибка доступа').slice(0, 120), reasonKind: 'error' });
  }
  return out;
}

// added — новые проблемные кабинеты; worsened — стало хуже (больше кампаний или ошибка доступа); resolved — исправлено.
export function diffProblems(prev = [], next = []) {
  const before = new Map(prev.map((p) => [p.id, p])), after = new Map(next.map((p) => [p.id, p]));
  return {
    added: next.filter((p) => !before.has(p.id)),
    worsened: next.filter((p) => before.has(p.id) && (p.count > before.get(p.id).count || (p.kind === 'error' && before.get(p.id).kind !== 'error'))),
    resolved: prev.filter((p) => !after.has(p.id))
  };
}

export const badgeText = (count) => (count > 0 ? String(Math.min(count, 99)) : '');

export function notificationFor(diff, total = 0) {
  const fresh = [...(diff?.added ?? []), ...(diff?.worsened ?? []).filter((w) => !(diff.added ?? []).some((a) => a.id === w.id))];
  if (!fresh.length) return null;
  const lines = fresh.slice(0, 3).map((p) => `${p.name}: ${p.reason}${p.count > 1 && p.kind === 'issue' ? ` (×${p.count})` : ''}`);
  if (fresh.length > 3) lines.push(`и ещё ${fresh.length - 3}`);
  return { title: `TTAds Hub: проблемы в кабинетах (${total || fresh.length})`, message: lines.join('\n'), accountId: fresh[0].id };
}

export function badgeTitle(count, at, { total = 0, checked = 0 } = {}) {
  const time = at ? new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  const partial = total > checked && checked > 0 ? `, проверено ${checked} из ${total} кабинетов` : '';
  return count > 0 ? `TTAds Hub — проблем: ${count}${time ? ` (проверено в ${time}${partial})` : ''}` : `TTAds Hub${time ? ` — всё в порядке (проверено в ${time}${partial})` : ''}`;
}
