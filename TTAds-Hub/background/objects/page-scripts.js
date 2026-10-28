// Повтор снятого запроса в странице Ads Manager (MAIN world, сессия пользователя). Самодостаточная функция:
// chrome.scripting сериализует её целиком. Разрешены только пути мутаций вкл/выкл, имени и бюджета.

export async function replayMutationInPage(spec) {
  try {
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    if (!/^\/api\/v\d+\/i18n\/overture\/(campaign|ad|creative)\/(update_status|batch_update\/(name|budget))\/?$/.test(String(spec?.path || ''))) return { error: 'Недопустимый путь запроса.' };
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '');
    const headers = { accept: 'application/json, text/plain, */*', 'content-type': 'application/json;charset=UTF-8', ...(spec.headers || {}) };
    if (csrf) { headers['x-csrftoken'] = csrf; headers['x-secsdk-csrf-token'] = csrf; }
    const body = { ...(spec.body || {}) };
    // Те же поля, что добавляет клиент TikTok к мутациям (internal-api-catalog.json → mutationRiskInfoFields).
    if (spec.riskInfo) {
      body.risk_info = {
        cookie_enabled: navigator.cookieEnabled, screen_width: screen.width, screen_height: screen.height,
        browser_language: navigator.language, browser_online: navigator.onLine, timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
    const query = new URLSearchParams(spec.query || []).toString();
    const response = await fetch(`${spec.path}${query ? `?${query}` : ''}`, {
      method: 'POST', credentials: 'include', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(spec.timeoutMs) || 15000)
    });
    let data;
    try { data = await response.json(); } catch { return { http: response.status, error: `TikTok вернул HTTP ${response.status}` }; }
    return { http: response.status, code: data?.code ?? null, msg: String(data?.msg || data?.message || '').slice(0, 200) };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 240) };
  }
}
