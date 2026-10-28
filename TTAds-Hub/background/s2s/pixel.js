// Быстрое создание пикселя TikTok с получением Developer token — порт консольного скрипта из канала.
// Выполняется внутри вкладки ads.tiktok.com от имени текущей сессии; функция самодостаточна.
export async function createPixelInPage(options) {
  try {
    const { aadvid: expected, createRule, keywords, ruleEvent } = options;
    const url = new URL(location.href);
    const aadvid = url.searchParams.get('aadvid') || '';
    if (!aadvid || aadvid !== expected) throw new Error('Кабинет изменился или в адресе нет aadvid.');
    // Декодируем только нужный cookie: посторонний «битый» cookie (например x=100%) не должен ломать запуск.
    const raw = Object.fromEntries(document.cookie.split('; ').map((part) => {
      const i = part.indexOf('=');
      return i === -1 ? [part, ''] : [part.slice(0, i), part.slice(i + 1)];
    }));
    const pick = ['csrftoken', 'csrfToken', 'tt_csrf_token'].find((name) => raw[name]);
    let csrf = '';
    if (pick) { try { csrf = decodeURIComponent(raw[pick]); } catch { csrf = raw[pick]; } }
    if (!csrf) throw new Error('Не найден csrftoken. Перезайдите в рекламный кабинет в этой вкладке.');

    const call = async (path, { body, referrer, headers = {} }) => {
      const res = await fetch(`https://ads.tiktok.com${path}`, {
        method: 'POST', mode: 'cors', credentials: 'include', referrer, referrerPolicy: 'strict-origin-when-cross-origin',
        headers: { 'x-csrftoken': csrf, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { __raw: text.slice(0, 300) }; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText || 'ошибка запроса'}`);
      return data;
    };

    const aid = encodeURIComponent(aadvid);
    const name = (options.name || `Pixel_${aadvid}_${Date.now()}`).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
    const created = await call(`/i18n/events_manager/v2/api/pixel/create?aadvid=${aid}`, {
      referrer: `https://ads.tiktok.com/i18n/events_manager/pixel?aadvid=${aid}`,
      body: { PixelName: name, GTMStatus: false, EventSetupMode: 0 }
    });
    const info = created?.data || created;
    const pixelCode = info?.PixelCode || info?.pixel_code || info?.pixelCode;
    if (!pixelCode) throw new Error('TikTok не вернул PixelCode: ' + JSON.stringify(created).slice(0, 300));

    // Пиксель уже создан: дальнейшие сбои не должны терять его код (иначе повтор создаст дубликат).
    const warnings = [];
    const code = encodeURIComponent(pixelCode);

    const addRule = () => call(`/i18n/events_manager/v2/api/pixel/${code}/update_event_trigger_setting?aadvid=${aid}`, {
      referrer: `https://ads.tiktok.com/i18n/events_manager/v2/creationFlow/editEvent/${code}/?aadvid=${aid}`,
      body: {
        EventTriggerSetting: {
          [ruleEvent]: {
            WebEventType: ruleEvent, Currency: '', Value: '', CountingMethod: 4, EventName: '',
            TriggerRules: keywords.map((kw) => ({
              TriggerType: 1, Variable: 9, Operator: 1, PageURL: '', Value: String(kw),
              Parameters: { Contents: [{ ContentFrom: 1 }], ValueIndex: -1 }
            }))
          }
        }
      }
    });

    const fetchToken = async () => {
      const graph = await call(`/i18n/events_manager/api/graphql?aadvid=${aid}`, {
        referrer: `https://ads.tiktok.com/i18n/events_manager/pixel/detail/${code}?aadvid=${aid}&type=S2SSetting`,
        headers: { accept: 'application/json, text/plain, */*', 'content-type': 'application/json;charset=UTF-8' },
        body: {
          operationName: 'getPixelSettingDeveloperToken',
          variables: { where: { pixelCode: String(pixelCode), appID: '' } },
          query: 'query getPixelSettingDeveloperToken($where: SettingTokenInput) {\n  getPixelSettingDeveloperToken(where: $where) {\n    token\n    status\n    errMessage\n    __typename\n  }\n}\n'
        }
      });
      return graph?.data?.getPixelSettingDeveloperToken?.token || '';
    };

    let ruleCreated = false;
    if (createRule && Array.isArray(keywords) && keywords.length) {
      try { await addRule(); ruleCreated = true; } catch (e) { warnings.push('URL-правило не добавлено: ' + String(e?.message || e)); }
    }
    let devToken = '';
    try {
      devToken = await fetchToken();
      if (!devToken) warnings.push('Developer token не получен — возьмите его в Events Manager.');
    } catch (e) { warnings.push('Developer token не получен: ' + String(e?.message || e)); }
    return { ok: true, pixelName: name, pixelCode: String(pixelCode), devToken, ruleCreated, warnings };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
