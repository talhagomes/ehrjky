// Функции, исполняемые ВНУТРИ страницы TikTok Ads Manager (MAIN-мир): запросы идут от имени текущей
// сессии, куки и токены не покидают вкладку. Функции самодостаточны (используются через chrome.scripting).

// Отправка одной апелляции штатным запросом Ads Manager.
export async function sendAppealInPage(expected, row, text, reason) {
  if (location.origin !== 'https://ads.tiktok.com' || new URL(location.href).searchParams.get('aadvid') !== expected) {
    return { status: 'failed', stop: true, message: 'Кабинет изменился. Обновите список.' };
  }
  if (![1, 2, 3, 4, 5].includes(reason)) return { status: 'failed', message: 'Неизвестная причина апелляции.' };
  const token = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith('csrftoken='));
  if (!token) return { status: 'failed', stop: true, message: 'Сессия TikTok недоступна. Перезайдите в рекламный кабинет.' };
  if (!/^\d{5,30}$/.test(String(row.id)) || !/^\d{5,30}$/.test(String(row.adgroupId))) {
    return { status: 'failed', message: 'Некорректный ID объявления или адсета.' };
  }
  const url = new URL('/api/v4/i18n/creation/audit/appeal_creative/', location.origin);
  url.searchParams.set('aadvid', expected);
  url.searchParams.set('req_src', 'bidding');
  // creative_id — числовой: вставляем цифры как есть, чтобы длинные ID не теряли точность.
  const body = JSON.stringify({
    ad_id: row.adgroupId, aadvid: expected, adv_entry: 'ad review detail', appeal_reason: text,
    attachment_list: [], appeal_reason_type: reason, creative_id: '__tth_creative_id__', advertiser_id: expected
  }).replace('"__tth_creative_id__"', String(row.id));
  // Через window.fetch страницы: штатный обработчик TikTok сам добавит актуальные подписи.
  let res;
  try {
    res = await window.fetch(url.href, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRFToken': decodeURIComponent(token.slice(10)) },
      body, signal: AbortSignal.timeout(30000)
    });
  } catch { return { status: 'unknown', message: 'Связь прервалась. Проверьте статус в TikTok перед повтором.' }; }
  let data;
  try { data = await res.json(); } catch { return { status: 'unknown', message: 'TikTok вернул неожиданный ответ. Проверьте статус в кабинете.' }; }
  if (data?.data?.appeal_success === false) {
    const failure = data.data.ticket_failed_info || {}, ticket = failure.data?.tickets?.[0] || {};
    const code = Number(ticket.error_code || failure.code) || null;
    const reasonText = String(ticket.error_msg || failure.msg || '').slice(0, 400);
    return {
      status: code === 90071 ? 'limited' : 'failed', responseCode: code, responseMessage: reasonText,
      message: code === 90071
        ? 'TikTok не разрешает новую апелляцию: уже подано несколько обращений (90071). Срок ограничения не указан.'
        : 'TikTok отклонил апелляцию: ' + (reasonText || 'причина не указана')
    };
  }
  if (res.ok && data?.code === 0 && data?.data?.appeal_success === true) return { status: 'submitted', responseCode: 0, message: 'TikTok подтвердил отправку апелляции.' };
  if (res.ok && data?.code === 0) return { status: 'accepted', responseCode: 0, responseMessage: String(data.msg || data.message || '').slice(0, 400), message: 'TikTok ответил code=0; проверяется статус апелляции.' };
  if (typeof data?.code === 'number' && data.code !== 0) return { status: 'failed', message: 'TikTok отклонил запрос: ' + String(data.message || data.msg || data.code).slice(0, 400) };
  return { status: 'unknown', message: 'Ответ TikTok не подтверждает отправку. Проверьте апелляцию в кабинете.' };
}

// Загрузка вложенных объявлений кампании/адсета (или статусов апелляций при statusOnly=true).
export async function resolveAdsInPage(expected, parents, statusOnly = false) {
  try {
    return await (async () => {
  const check = () => {
    if (location.origin !== 'https://ads.tiktok.com' || new URL(location.href).searchParams.get('aadvid') !== expected) throw Error('Кабинет изменился. Обновите список.');
  };
  check();
  const cookie = document.cookie.split(';').map((x) => x.trim()).find((x) => x.startsWith('csrftoken='));
  if (!cookie) throw Error('Сессия TikTok недоступна');
  const current = new URL(location.href), today = new Date().toISOString().slice(0, 10), found = new Map();
  if (statusOnly && parents.length) parents = [{ level: 'ad', id: parents[0].id, ids: parents.map((r) => r.id) }];
  for (const parent of parents) {
    if (parent.level === 'ad' && !statusOnly) { found.set(parent.id, parent); continue; }
    if (!['campaign', 'adgroup', 'ad'].includes(parent.level) || !/^\d{5,30}$/.test(parent.id)) throw Error('Неверный объект');
    let page = 1, pages = 1;
    do {
      check();
      const body = {
        common_req: {
          metrics: ['creative_platform_status', 'creative_aggr_tag_info', 'creative_detail_tag_info', 'appeal_result'],
          st: current.searchParams.get('st') || today, et: current.searchParams.get('et') || today, lifetime: 0,
          compare_st: '', compare_et: '', sort_stat: 'create_time', sort_order: 1, dimensions: ['creative_id'],
          filters: [{ field: parent.level === 'campaign' ? 'campaign_ids' : parent.level === 'ad' ? 'creative_ids' : 'ad_ids', filter_type: 0, in_field_values: parent.ids || [parent.id], isAllValueReplaced: false }],
          page, page_size: 20
        },
        workflow_card: { type: '0' },
        extra: { get_compare_value: '0', get_compare_rate: '0', get_compare_diff: '0', scene: 'campaign_list_v2', list_version: 'v2', page_view_scene: 'view_non_first', region_schedule: '1', ab_primary_status: 'v2', enable_status_action: 1, request_id: crypto.randomUUID(), request_count: 2 }
      };
      const url = new URL('/api/v4/i18n/statistics/op/ad/list/', location.origin);
      url.searchParams.set('aadvid', expected);
      url.searchParams.set('req_src', 'bidding');
      const res = await fetch(url.href, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': decodeURIComponent(cookie.slice(10)) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(statusOnly ? 8000 : 30000)
      });
      const data = await res.json();
      check();
      if (!res.ok || data.code !== 0 || !Array.isArray(data.data?.table)) throw Error('TikTok не загрузил объявления: ' + String(data.msg || data.message || res.status).slice(0, 200));
      pages = Number(data.data.pagination?.page_count);
      if (!Number.isInteger(pages) || pages < 0 || pages > 250) throw Error('Не удалось проверить полноту списка объявлений');
      for (const r of data.data.table) {
        if (!(parent.ids || [parent.id]).includes(String(parent.level === 'campaign' ? r.campaign_id : parent.level === 'ad' ? r.creative_id : r.ad_id))) {
          throw Error('TikTok вернул объекты другой кампании или адсета');
        }
        const evidence = [r.creative_status, r.creative_status_list, r.appeal_result, r.row_data?.appeal_result, r.row_data?.creative_aggr_tag_info, r.row_data?.creative_detail_tag_info]
          .filter((x) => x != null).map(String).join(' ');
        if (statusOnly) {
          let appeal;
          try { appeal = JSON.parse(r.row_data?.appeal_result || r.appeal_result || 'null'); } catch { /* не JSON */ }
          found.set(r.creative_id, { id: r.creative_id, evidence, appealStatus: appeal?.status, appealVersion: appeal?.update_time });
          continue;
        }
        if (!/offline_audit|reject|disapprov|review[ _]issues?|отклон[её]н/i.test(evidence)) continue;
        if (typeof r.creative_id !== 'string' || typeof r.ad_id !== 'string') throw Error('TikTok вернул ID в неподдерживаемом формате');
        found.set(r.creative_id, {
          id: r.creative_id, level: 'ad', adgroupId: r.ad_id, campaignId: String(r.campaign_id),
          name: r.creative_name || r.creative_id, status: 'review_issue',
          reason: [r.campaign_name, r.ad_name, evidence].filter(Boolean).join(' · '), thumbnail: ''
        });
      }
      page++;
    } while (page <= pages);
  }
  return { account: expected, rows: [...found.values()] };
    })();
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
