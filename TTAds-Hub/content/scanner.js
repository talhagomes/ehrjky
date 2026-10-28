// Сканер таблиц TikTok Ads Manager (порт Appeal Desk): находит строки с отклонёнными объявлениями / «Review issue».
// Работает в изолированном мире страницы и ничего никуда не отправляет.
globalThis.__tthScanAppeals = () => {
  if (location.hostname !== 'ads.tiktok.com') throw Error('Нужна вкладка ads.tiktok.com');
  const url = new URL(location.href);
  const account = url.searchParams.get('aadvid') || url.searchParams.get('advertiser_id');
  const rejected = /\b(rejected|disapproved|not approved|review issue|review issues)\b|отклон[её]н|проблем[аы] проверк/i;
  const rows = [],
    unresolved = [];
  // Verified TikTok ks-virtual-table: light DOM fields are projected into Shadow DOM slots.
  const projected = new Map();
  for (const el of document.querySelectorAll('[slot^="cell-"]')) {
    const match = el.getAttribute('slot').match(/^cell-(\d+)_(.+)$/);
    if (!match) continue;
    const item = projected.get(match[1]) || {};
    item[match[2]] = (el.textContent || '').trim();
    if ((match[2] === 'creative_name' || match[2] === 'name') && el.querySelectorAll) {
      function findImage(root) {
        for (const n of root.querySelectorAll('*')) {
          const src = n.tagName === 'IMG' ? (n.currentSrc || n.src) : n.style?.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1];
          if (src) {
            try {
              const u = new URL(src);
              if (u.protocol === 'https:' && /(^|\.)tiktokcdn\.com$/.test(u.hostname)) return u.href;
            } catch {}
          }
          if (n.shadowRoot) {
            const found = findImage(n.shadowRoot);
            if (found) return found;
          }
        }
        return '';
      }
      item.thumbnail = findImage(el);
    }
    projected.set(match[1], item);
  }
  for (const [rowId, item] of projected) {
    const status = item.creative_status || item.ad_status || item.campaign_status || item.status || '';
    if (!rejected.test(status) && !/review issues?/i.test(status)) continue;
    const creativePage = /\/manage\/creative/.test(url.pathname);
    const groupPage = /\/manage\/adgroup/.test(url.pathname);
    const id = item.creative_id || (creativePage && (item.creative_name || item.name) ? rowId : '') || item.adgroup_id || (groupPage ? (item.ad_id || rowId) : '') || item.campaign_id || ((item.campaign_name || item.name) ? rowId : '');
    if (!/^\d{5,30}$/.test(id || '')) {
      unresolved.push((item.creative_name || item.name || item.ad_name || item.campaign_name || rowId) + ' · ' + status);
      continue;
    }
    const level = (item.creative_id || creativePage) ? 'ad' : (item.adgroup_id || groupPage) ? 'adgroup' : 'campaign';
    rows.push({
      id,
      level,
      adgroupId: (item.creative_id || creativePage) ? item.ad_id : undefined,
      campaignId: item.campaign_id,
      thumbnail: item.thumbnail || '',
      status: /rejected|disapproved|отклон[её]н/i.test(status) ? 'rejected' : 'review_issue',
      name: item.creative_name || item.name || item.ad_name || item.campaign_name || id,
      reason: status
    });
  }

  const selector = 'tr,[role="row"],.byted-table-row,.arco-table-tr,[class*="table-row"],[class*="tableRow"],[class*="TableRow"],[class*="body-row"]';
  const candidates = new Set(document.querySelectorAll(selector));
  // Custom virtual tables may expose no row role/class. Start from exact status labels.
  let labelsFound = 0;
  for (const label of document.querySelectorAll('span,div,p,a')) {
    const labelText = (label.innerText || label.textContent || '').trim();
    if (!/^(review issues?|rejected|disapproved|not approved|отклон[её]н[аоы]?|проблем[аы] проверки)$/i.test(labelText) || !label.getClientRects().length) continue;
    // Keep the innermost label, rather than every wrapping element.
    if ([...label.children].some(c => (c.innerText || c.textContent || '').trim() === labelText)) continue;
    labelsFound++;
    let row = label.closest(selector);
    if (!row) {
      let parent = label.parentElement;
      for (let depth = 0; parent && depth < 9; depth++, parent = parent.parentElement) {
        const txt = (parent.innerText || parent.textContent || '').trim();
        const count = (txt.match(/review issues?|rejected|disapproved|отклон[её]н/gi) || []).length;
        if (count > 1 || txt.length > 4000) break;
        if (parent.querySelector('input[type="checkbox"],[role="checkbox"],td,[role="cell"]')) {
          row = parent;
          break;
        }
        if (txt.length > labelText.length + 12) row = parent;
      }
    }
    candidates.add(row || label.parentElement || label);
  }

  for (const e of candidates) {
    const text = (e.innerText || e.textContent || '').trim();
    if (!e.getClientRects().length || !rejected.test(text)) continue;
    let id, level;
    for (const [l, pattern] of [
        ['adgroup', /(?:Ad\s*group\s*ID|ID группы(?: объявлений)?)\s*[:：]?\s*(\d{5,30})/i],
        ['ad', /(?:Ad\s*ID|ID объявления)\s*[:：]?\s*(\d{5,30})/i],
        ['campaign', /(?:Campaign\s*ID|ID кампании)\s*[:：]?\s*(\d{5,30})/i]
      ]) {
      const m = text.match(pattern);
      if (m) {
        id = m[1];
        level = l;
        break;
      }
    }
    if (!id) {
      const table = e.closest('table,[role="table"],.byted-table,.arco-table');
      const headers = [...(table?.querySelectorAll('thead th,[role="columnheader"]') || [])];
      const cells = [...e.querySelectorAll('td,[role="cell"],.byted-table-cell')];
      headers.forEach((h, i) => {
        const t = h.innerText.trim();
        let l;
        if (/^(campaign id|id кампании)$/i.test(t)) l = 'campaign';
        if (/^(ad group id|adgroup id|id группы объявлений)$/i.test(t)) l = 'adgroup';
        if (/^(ad id|id объявления)$/i.test(t)) l = 'ad';
        const v = cells[i]?.innerText.trim();
        if (l && /^\d{5,30}$/.test(v || '')) {
          id = v;
          level = l;
        }
      });
    }
    if (!id) {
      unresolved.push(text.slice(0, 1000));
      continue;
    }
    rows.push({
      id,
      level,
      status: /review issue|проблем[аы] проверк/i.test(text) && !/rejected|disapproved|отклон[её]н/i.test(text) ? 'review_issue' : 'rejected',
      name: text.split('\n').find(t => t.trim()) || id,
      reason: text.slice(0, 2000)
    });
  }
  return {
    account,
    observations: [...projected].map(([id, item]) => ({
      id,
      status: item.creative_status || item.ad_status || item.campaign_status || item.status || ''
    })),
    pageLevel: /\/manage\/campaign(?:\/|$)/.test(url.pathname) ? 'campaign' : /\/manage\/adgroup(?:\/|$)/.test(url.pathname) ? 'adgroup' : /\/manage\/creative(?:\/|$)/.test(url.pathname) ? 'ad' : 'unknown',
    diagnostics: {
      labelsFound: labelsFound + rows.length,
      candidateRows: candidates.size + projected.size
    },
    rows: [...new Map(rows.map(r => [r.level + ':' + r.id, r])).values()],
    unresolved: [...new Set(unresolved)].slice(0, 30)
  };
};