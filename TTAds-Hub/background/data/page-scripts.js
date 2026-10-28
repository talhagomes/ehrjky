// Чтение данных Ads Manager в текущей сессии (MAIN world страницы ads.tiktok.com).
// Функции самодостаточны: chrome.scripting сериализует каждую из них целиком, импортов и замыканий быть не может.

// Список доступных кабинетов и Business Center: GET /api/v2/i18n/account/account_switch_list/
export async function listAccountsInPage(expectedAccount = '') {
  try {
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    const current = new URL(location.href).searchParams.get('aadvid') || expectedAccount || '';
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '');
    const headers = { accept: 'application/json, text/plain, */*' };
    if (csrf) { headers['x-csrftoken'] = csrf; headers['x-secsdk-csrf-token'] = csrf; }
    const suffix = current ? `?aadvid=${encodeURIComponent(current)}` : '';
    const response = await fetch(`/api/v2/i18n/account/account_switch_list/${suffix}`, { credentials: 'include', headers, signal: AbortSignal.timeout(15000) });
    let data;
    try { data = await response.json(); } catch { return { error: `TikTok вернул HTTP ${response.status}` }; }
    if (!response.ok || data?.code !== 0) return { error: `Не удалось получить список кабинетов: ${String(data?.msg || data?.message || `HTTP ${response.status}`).slice(0, 200)}` };

    const isId = (v) => /^\d{5,30}$/.test(String(v ?? ''));
    const byId = new Map(), centers = new Map();
    const add = (item, bc) => {
      if (!isId(item?.id)) return;
      byId.set(String(item.id), {
        id: String(item.id), name: String(item.name || item.id).slice(0, 160), country: String(item.country || '').slice(0, 8),
        currency: String(item.currency || '').slice(0, 8), status: Number(item.status),
        bcId: bc ? String(bc.id) : '', businessCenter: bc ? String(bc.name).slice(0, 160) : ''
      });
    };
    for (const item of Array.isArray(data?.data?.data) ? data.data.data : []) {
      const children = Array.isArray(item?.child) ? item.child : [];
      const isCenter = children.length > 0 || String(item?.role) === '99';
      if (isCenter) {
        const bc = isId(item?.id) ? { id: String(item.id), name: String(item.name || item.id) } : null;
        if (bc) centers.set(bc.id, { id: bc.id, name: bc.name.slice(0, 160), accountCount: children.length });
        for (const child of children) add(child, bc);
      } else if (item?.country || item?.currency) {
        add(item, null);
      }
    }
    if (!byId.size && isId(current)) add({ id: current, name: current }, null);
    const accounts = [...byId.values()];
    return { currentAccount: current, accounts: accounts.slice(0, 2000), businessCenters: [...centers.values()].slice(0, 500), total: accounts.length, at: Date.now() };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 240) };
  }
}

// Списки кампаний / адсетов / объявлений со статистикой для одного или нескольких кабинетов
// (POST /api/v4/i18n/statistics/op/{campaign|adgroup|ad}/list/). Возвращает только нужные поля строк.
export async function listObjectsInPage(spec) {
  try {
    if (location.origin !== 'https://ads.tiktok.com') return { error: 'Откройте TikTok Ads Manager.' };
    const { level, st, et, pageSize = 200, maxRows = 1000, concurrency = 3 } = spec;
    const accounts = (Array.isArray(spec.accounts) ? spec.accounts : []).map((a) => String(a?.id ?? a)).filter((id) => /^\d{5,30}$/.test(id));
    const keys = Array.isArray(spec.keys) ? spec.keys : [];
    const conf = {
      campaign: {
        dimension: 'campaign_id', filters: [{ field: 'campaign_platform_status', filter_type: 0, in_field_values: ['999'] }],
        metrics: ['learning_phase', 'learning_phase_detail', 'campaign_budget', 'budget_auto_adjust_is_enabled', 'campaign_live_toggle', 'campaign_is_live_use']
      },
      adgroup: { dimension: 'ad_id', filters: [], metrics: [] },
      ad: { dimension: 'creative_id', filters: [], metrics: ['creative_platform_status', 'creative_aggr_tag_info', 'creative_detail_tag_info', 'appeal_result'] }
    }[level];
    if (!conf) return { error: 'Неизвестный уровень списка.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(et))) return { error: 'Некорректный период.' };
    const csrf = decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] || '');
    const headers = { accept: 'application/json, text/plain, */*', 'content-type': 'application/json;charset=UTF-8', 'app-name': '@tt4b-vmok/campaign-list' };
    if (csrf) { headers['x-csrftoken'] = csrf; headers['x-secsdk-csrf-token'] = csrf; }
    const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    const project = (raw) => {
      const row = { ...(raw || {}), ...(raw?.row_data || {}), ...(raw?.stat_data || {}), ...(raw?.custom_metrics || {}) };
      const out = {};
      for (const key of keys) {
        const value = row[key];
        if (value === undefined || value === null) continue;
        out[key] = typeof value === 'object' ? JSON.stringify(value).slice(0, 400) : value;
      }
      return out;
    };

    async function loadAccount(id) {
      const rows = [];
      let total = 0;
      try {
        for (let page = 1; ; page++) {
          const body = {
            common_req: {
              metrics: ['stat_cost', 'show_cnt', 'click_cnt', 'time_attr_convert_cnt', ...conf.metrics],
              st, et, lifetime: 0, compare_st: '', compare_et: '', sort_stat: 'create_time', sort_order: 1,
              dimensions: [conf.dimension], filters: conf.filters, page, page_size: pageSize
            },
            extra: {
              get_compare_value: '0', get_compare_rate: '0', get_compare_diff: '0', scene: 'campaign_list_v2', list_version: 'v2',
              page_view_scene: 'view_non_first', region_schedule: '1', ab_primary_status: 'v2', enable_status_action: 1,
              request_id: crypto.randomUUID(), request_count: 2, fe_source: 'ttads_hub'
            }
          };
          const response = await fetch(`/api/v4/i18n/statistics/op/${level}/list/?aadvid=${encodeURIComponent(id)}`, {
            method: 'POST', credentials: 'include', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000)
          });
          let data;
          try { data = await response.json(); } catch { throw new Error(`TikTok вернул HTTP ${response.status}`); }
          if (!response.ok || data?.code !== 0) throw new Error(String(data?.msg || data?.message || `HTTP ${response.status}`).slice(0, 200));
          const table = Array.isArray(data?.data?.table) ? data.data.table : [];
          for (const raw of table) rows.push(project(raw));
          total = finite(data?.data?.pagination?.total_count) || rows.length;
          const pages = finite(data?.data?.pagination?.page_count) || Math.ceil(total / pageSize);
          if (!table.length || page >= pages || rows.length >= maxRows) break;
        }
        return { id, rows: rows.slice(0, maxRows), total, truncated: total > Math.min(rows.length, maxRows) };
      } catch (e) {
        return { id, rows: [], total: 0, truncated: false, error: String(e?.message || e).slice(0, 240) };
      }
    }

    const results = new Array(accounts.length);
    let cursor = 0;
    const worker = async () => { while (cursor < accounts.length) { const index = cursor++; results[index] = await loadAccount(accounts[index]); } };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), accounts.length || 1) }, worker));
    return { results, at: Date.now() };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 240) };
  }
}
