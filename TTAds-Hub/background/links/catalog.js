// Каталог быстрых ссылок TikTok Ads / Business Center и чистая логика работы с ними:
// подстановка кабинета и BC, поиск (RU/EN), настройки, «сохранить страницу», переключение кабинета.
// Модуль без chrome.* — им пользуются и интерфейс, и сервис-воркер (omnibox); покрыт юнит-тестами.

export const ADS = 'https://ads.tiktok.com';
export const BC = 'https://business.tiktok.com';
const HELP = `${ADS}/help/article`;

export const GROUPS = Object.freeze([
  { id: 'accounts', title: 'Аккаунты и Business Center', icon: 'building' },
  { id: 'billing', title: 'Биллинг и оплата', icon: 'card' },
  { id: 'manage', title: 'Управление рекламой', icon: 'chart' },
  { id: 'resources', title: 'Ресурсы и креативы', icon: 'layers' },
  { id: 'quality', title: 'Модерация и политики', icon: 'shield' },
  { id: 'docs', title: 'Справка и документация', icon: 'book' },
  { id: 'custom', title: 'Мои ссылки', icon: 'star' }
]);

// conf: verified — маршрут наблюдался в живом Ads Manager; official — адрес указан в официальных материалах TikTok;
// pattern — собран по структуре Business Center и не проверялся (в карточке показывается пометка «≈»).
const acc = (path) => `${ADS}${path}?aadvid={aadvid}`;
const BC_ORG = `${BC}/manage/overview?org_id={bcid}`;
const BC_FINANCE = `${BC}/manage/financeRole?org_id={bcid}`;

// Ссылки с полем app в панели открывают вкладку расширения (omnibox их пропускает); url остаётся для копирования ссылки.
export const APP_TABS = Object.freeze({ pixel: 'Пиксель', billing: 'Оплата' });

export const LINKS = Object.freeze([
  /* ---------- Аккаунты и Business Center ---------- */
  {
    id: 'bc-create', group: 'accounts', icon: 'building', title: 'Создать Business Center', conf: 'official',
    desc: 'Новый BC (до 30 на пользователя)', url: `${BC}/`,
    hint: 'Войдите → страница «Select an account» → «Create new» (справа вверху)',
    kw: ['бизнес менеджер', 'бизнес центр', 'бц', 'бм', 'bc', 'business center', 'создать', 'новый', 'регистрация']
  },
  {
    id: 'adaccount-create', group: 'accounts', icon: 'plus', title: 'Создать рекламный кабинет', conf: 'pattern',
    desc: 'Новый ad account внутри Business Center', url: BC_ORG, fallback: `${BC}/`,
    hint: 'Accounts → All accounts → Advertiser accounts → Add advertiser account → Create New → Next (нужны права Admin)',
    kw: ['рекламный кабинет', 'рк', 'кабинет', 'аккаунт', 'ad account', 'advertiser', 'создать', 'новый кабинет', 'добавить']
  },
  {
    id: 'adaccount-signup', group: 'accounts', icon: 'user-plus', title: 'Регистрация TikTok Ads', conf: 'official',
    desc: 'Новый аккаунт TikTok for Business по email или телефону', url: `${ADS}/i18n/signup/`,
    kw: ['регистрация', 'sign up', 'signup', 'новый аккаунт', 'создать аккаунт', 'зарегистрировать']
  },
  {
    id: 'ads-login', group: 'accounts', icon: 'user', title: 'Вход в TikTok Ads', conf: 'official',
    desc: 'Страница входа в Ads Manager', url: `${ADS}/i18n/login`,
    kw: ['вход', 'логин', 'login', 'sign in', 'авторизация', 'войти']
  },
  {
    id: 'bc-home', group: 'accounts', icon: 'home', title: 'Business Center', conf: 'pattern',
    desc: 'Главная выбранного Business Center', url: BC_ORG, fallback: `${BC}/`,
    kw: ['bc', 'бц', 'бм', 'business center', 'бизнес центр', 'главная', 'бизнес менеджер']
  },
  {
    id: 'bc-users', group: 'accounts', icon: 'users', title: 'Пользователи Business Center', conf: 'pattern',
    desc: 'Участники, роли и доступы', url: BC_ORG, fallback: `${BC}/`,
    hint: 'В левом меню «Users» → «Add Members»',
    kw: ['пользователи', 'участники', 'members', 'users', 'роли', 'доступ', 'пригласить', 'команда']
  },
  {
    id: 'account-settings', group: 'accounts', icon: 'sliders', title: 'Настройки кабинета', conf: 'verified',
    desc: 'Имя, часовой пояс, валюта, контакты, верификация', url: acc('/i18n/verification-center/setting'),
    kw: ['настройки', 'settings', 'часовой пояс', 'валюта', 'верификация', 'verification', 'аккаунт', 'контакты']
  },

  /* ---------- Биллинг и оплата ---------- */
  {
    id: 'billing-bind', group: 'billing', icon: 'card', title: 'Привязать карту к РК', conf: 'verified', app: 'billing',
    desc: 'Выбор кабинета и запуск формы добавления карты', url: acc('/i18n/account/payment'),
    kw: ['привязать карту', 'добавить карту', 'карта к рк', 'payment method', 'bind card', 'attach card']
  },
  {
    id: 'billing', group: 'billing', icon: 'card', title: 'Биллинг и оплата', conf: 'verified',
    desc: 'Баланс, способы оплаты, транзакции, счета', url: acc('/i18n/account/payment'),
    kw: ['биллинг', 'оплата', 'баланс', 'платеж', 'платёж', 'пополнить', 'карта', 'счета', 'инвойс', 'долг', 'автоплатеж', 'billing', 'payment', 'balance', 'invoice', 'transactions', 'top up']
  },
  {
    id: 'billing-bc', group: 'billing', icon: 'dollar', title: 'Финансы в Business Center', conf: 'verified',
    desc: 'Payment management, карты и счета на уровне BC', url: BC_FINANCE, fallback: `${BC}/`,
    hint: 'В левом меню «Finance» → Payment management / Invoices',
    kw: ['финансы', 'finance', 'платежи', 'счета', 'invoices', 'payment management', 'bc', 'биллинг bc']
  },
  {
    id: 'help-autopay', group: 'billing', icon: 'book', title: 'Справка: автоплатёж', conf: 'official',
    desc: 'Как работает автоматическая оплата и порог списания', url: `${HELP}/set-up-automatic-payment`,
    kw: ['автоплатеж', 'автоплатёж', 'автоматическая оплата', 'порог', 'automatic payment', 'справка']
  },
  {
    id: 'help-payment-method', group: 'billing', icon: 'book', title: 'Справка: способ оплаты', conf: 'official',
    desc: 'Добавление и обновление карты', url: `${HELP}/add-a-payment-method-for-automatic-payment-in-tiktok-ads-manager?lang=en-GB`,
    kw: ['способ оплаты', 'карта', 'добавить карту', 'payment method', 'справка']
  },
  {
    id: 'help-refund', group: 'billing', icon: 'book', title: 'Справка: возврат средств', conf: 'official',
    desc: 'Как вернуть неизрасходованный баланс', url: `${HELP}/refund-faq`,
    kw: ['возврат', 'refund', 'вернуть деньги', 'баланс', 'справка']
  },

  /* ---------- Управление рекламой ---------- */
  {
    id: 'dashboard', group: 'manage', icon: 'chart', title: 'Дашборд', conf: 'verified',
    desc: 'Сводка по расходу и результатам', url: acc('/i18n/dashboard'),
    kw: ['дашборд', 'dashboard', 'главная', 'сводка', 'статистика']
  },
  {
    id: 'campaign-create', group: 'manage', icon: 'plus', title: 'Создать кампанию', conf: 'verified',
    desc: 'Список кампаний с кнопкой «Создать»', url: acc('/i18n/manage/campaign'),
    hint: 'Нажмите «Создать» → выберите цель → откройте расширение → «Включить Manual»',
    kw: ['создать кампанию', 'новая кампания', 'создать', 'campaign', 'manual', 'запуск']
  },
  {
    id: 'campaigns', group: 'manage', icon: 'list', title: 'Кампании', conf: 'verified',
    desc: 'Список кампаний, статусы и статистика', url: acc('/i18n/manage/campaign'),
    kw: ['кампании', 'campaigns', 'campaign', 'список', 'статистика', 'расход']
  },
  {
    id: 'adgroups', group: 'manage', icon: 'list', title: 'Адсеты', conf: 'verified',
    desc: 'Группы объявлений (Ad group)', url: acc('/i18n/manage/adgroup'),
    kw: ['адсеты', 'адсет', 'группы объявлений', 'ad group', 'adgroup']
  },
  {
    id: 'ads', group: 'manage', icon: 'image', title: 'Объявления', conf: 'verified',
    desc: 'Объявления и креативы (Ad)', url: acc('/i18n/manage/creative'),
    kw: ['объявления', 'креативы', 'ads', 'ad', 'creative', 'крео']
  },
  {
    id: 'appeals-list', group: 'manage', icon: 'send', title: 'Отклонённые объявления', conf: 'verified',
    desc: 'Список объявлений для апелляций', url: acc('/i18n/manage/creative'),
    hint: 'Отфильтруйте Rejected / Review issue → вкладка расширения «Апелляции»',
    kw: ['отклонённые', 'отклоненные', 'реджекты', 'апелляции', 'апиллы', 'аппилы', 'rejected', 'review issue', 'appeal']
  },
  {
    id: 'reports', group: 'manage', icon: 'download', title: 'Отчёты', conf: 'verified',
    desc: 'Кастомные отчёты и экспорт статистики', url: acc('/i18n/reporting/list'),
    kw: ['отчеты', 'отчёты', 'reports', 'reporting', 'экспорт', 'статистика']
  },
  {
    id: 'rules', group: 'manage', icon: 'zap', title: 'Автоправила', conf: 'verified',
    desc: 'Automated rules: остановка по расходу и CPA', url: acc('/i18n/automated-rules-v2/management/manage'),
    kw: ['автоправила', 'правила', 'automated rules', 'rules', 'автоматизация', 'остановка']
  },
  {
    id: 'recommendations', group: 'manage', icon: 'info', title: 'Центр рекомендаций', conf: 'verified',
    desc: 'Рекомендации TikTok по оптимизации', url: acc('/i18n/recommendation-center'),
    kw: ['рекомендации', 'recommendation', 'оптимизация']
  },
  {
    id: 'experiments', group: 'manage', icon: 'activity', title: 'Эксперименты', conf: 'verified',
    desc: 'Experiment manager (сплит-тесты)', url: acc('/i18n/experiment-manager'),
    kw: ['эксперименты', 'сплит', 'тесты', 'experiment', 'split test', 'ab test']
  },
  {
    id: 'attribution', group: 'manage', icon: 'target', title: 'Аналитика атрибуции', conf: 'verified',
    desc: 'Attribution analytics: сравнение каналов', url: acc('/i18n/attribution-manager/insight/comparison'),
    kw: ['атрибуция', 'аналитика', 'attribution', 'analytics']
  },

  /* ---------- Ресурсы и креативы ---------- */
  {
    id: 'events', group: 'resources', icon: 'target', title: 'Events Manager (пиксели)', conf: 'verified',
    desc: 'Пиксели, события и S2S Events API', url: acc('/i18n/events_manager/home'),
    kw: ['пиксель', 'пиксели', 'события', 'events', 'events manager', 'pixel', 'api', 's2s', 'конверсии']
  },
  {
    id: 'pixel-create', group: 'resources', icon: 'plus', title: 'Создать пиксель', conf: 'verified', app: 'pixel',
    desc: 'Пиксель и Developer token за один клик — вкладка «Пиксель»', url: acc('/i18n/events_manager/home'),
    hint: 'Страницу Events Manager открывает ссылка «Events Manager (пиксели)»',
    kw: ['создать пиксель', 'новый пиксель', 'быстрый пиксель', 'быстро создать пиксель', 'быстрое создание пикселя', 'pixel', 'токен', 'token']
  },
  {
    id: 'catalogs', group: 'resources', icon: 'package', title: 'Каталоги', conf: 'verified',
    desc: 'Catalog Manager: товарные каталоги', url: acc('/catalogs/insights'),
    kw: ['каталоги', 'каталог', 'catalog', 'товары', 'products']
  },
  {
    id: 'creative-library', group: 'resources', icon: 'image', title: 'Библиотека креативов', conf: 'verified',
    desc: 'Creative Library: видео и изображения', url: acc('/i18n/creative-library/dashboard'),
    kw: ['креативы', 'библиотека', 'creative library', 'видео', 'изображения', 'материалы']
  },
  {
    id: 'leads', group: 'resources', icon: 'users', title: 'Лиды', conf: 'verified',
    desc: 'Leads Center: заявки с форм', url: acc('/lead_center/leads'),
    kw: ['лиды', 'заявки', 'leads', 'lead center', 'формы', 'instant form']
  },
  {
    id: 'audiences', group: 'resources', icon: 'users', title: 'Аудитории', conf: 'verified',
    desc: 'Audience Manager: сохранённые аудитории', url: acc('/i18n/sas/audience/adver/main'),
    kw: ['аудитории', 'аудитория', 'audience', 'ремаркетинг', 'lookalike']
  },
  {
    id: 'comments', group: 'resources', icon: 'send', title: 'Комментарии', conf: 'verified',
    desc: 'Comments Manager: ответы под объявлениями', url: acc('/i18n/material/comment/list'),
    kw: ['комментарии', 'comments', 'ответы', 'модерация комментариев']
  },
  {
    id: 'creative-center', group: 'resources', icon: 'layers', title: 'Creative Center', conf: 'official',
    desc: 'Топ-объявления, тренды и идеи для креативов', url: `${ADS}/business/creativecenter`,
    kw: ['creative center', 'креативы', 'топ объявления', 'тренды', 'идеи', 'спай', 'top ads']
  },
  {
    id: 'ad-library', group: 'resources', icon: 'search', title: 'TikTok Ad Library', conf: 'official',
    desc: 'Публичная библиотека рекламы (Commercial Content Library)', url: 'https://library.tiktok.com/ads',
    kw: ['библиотека рекламы', 'ad library', 'спай', 'чужие объявления', 'commercial content library']
  },
  {
    id: 'pixel-helper', group: 'resources', icon: 'download', title: 'TikTok Pixel Helper', conf: 'official',
    desc: 'Расширение Chrome для проверки пикселя на сайте',
    url: 'https://chromewebstore.google.com/detail/tiktok-pixel-helper/aelgobmabdmlfmiblddjfnjodalhidnn',
    kw: ['pixel helper', 'пиксель', 'проверка пикселя', 'расширение', 'отладка']
  },

  /* ---------- Модерация и политики ---------- */
  {
    id: 'policies', group: 'quality', icon: 'shield', title: 'Рекламные политики TikTok', conf: 'official',
    desc: 'Условия, правила и руководства для рекламодателей', url: `${ADS}/i18n/official/policy/terms`,
    kw: ['политики', 'правила', 'policy', 'policies', 'terms', 'условия', 'запрещено', 'модерация']
  },
  {
    id: 'help-suspension', group: 'quality', icon: 'alert', title: 'Справка: блокировка аккаунта', conf: 'official',
    desc: 'Предупреждения о риске блокировки и причины', url: `${HELP}/account-suspension-alerts`,
    kw: ['бан', 'блокировка', 'suspension', 'suspended', 'предупреждение', 'справка']
  },
  {
    id: 'help-bc-access', group: 'quality', icon: 'alert', title: 'Справка: нет доступа к BC', conf: 'official',
    desc: 'Что делать, если не открывается Business Center', url: `${HELP}/troubleshoot-tiktok-business-center-account-access`,
    kw: ['нет доступа', 'не открывается', 'access', 'troubleshoot', 'bc', 'справка']
  },
  {
    id: 'help-bc-security', group: 'quality', icon: 'shield', title: 'Справка: защита Business Center', conf: 'official',
    desc: 'Рекомендации по безопасности и 2FA', url: `${HELP}/best-practices-for-securing-your-business-center`,
    kw: ['безопасность', '2fa', 'защита', 'security', 'двухфакторная', 'справка']
  },

  /* ---------- Справка и документация ---------- */
  {
    id: 'help-center', group: 'docs', icon: 'book', title: 'Business Help Center', conf: 'official',
    desc: 'Справочный центр TikTok for Business', url: `${ADS}/resources/help?lang=en`,
    kw: ['справка', 'помощь', 'help', 'help center', 'поддержка', 'faq']
  },
  {
    id: 'help-bc', group: 'docs', icon: 'book', title: 'Справка: о Business Center', conf: 'official',
    desc: 'Возможности, роли и настройка BC', url: `${HELP}/tiktok-business-center`,
    kw: ['business center', 'bc', 'справка', 'что такое']
  },
  {
    id: 'help-bc-create', group: 'docs', icon: 'book', title: 'Справка: создание BC', conf: 'official',
    desc: 'Пошагово: первый и дополнительные Business Center', url: `${HELP}/create-tiktok-business-center`,
    kw: ['создать bc', 'создание bc', 'business center', 'справка', 'инструкция']
  },
  {
    id: 'help-adaccount-create', group: 'docs', icon: 'book', title: 'Справка: создание кабинета в BC', conf: 'official',
    desc: 'Пошагово: новый рекламный аккаунт в Business Center', url: `${HELP}/create-ad-accounts-in-business-center`,
    kw: ['создать кабинет', 'ad account', 'справка', 'инструкция', 'bc']
  },
  {
    id: 'help-bc-roles', group: 'docs', icon: 'book', title: 'Справка: роли и права BC', conf: 'official',
    desc: 'Admin, Standard и доступы к активам', url: `${HELP}/about-business-center-roles-and-permissions`,
    kw: ['роли', 'права', 'permissions', 'roles', 'admin', 'справка']
  },
  {
    id: 'help-pixel-helper', group: 'docs', icon: 'book', title: 'Справка: Pixel Helper', conf: 'official',
    desc: 'Как проверять пиксель расширением', url: `${HELP}/tiktok-pixel-helper-2.0?lang=en`,
    kw: ['pixel helper', 'пиксель', 'справка']
  },
  {
    id: 'api-portal', group: 'docs', icon: 'code', title: 'TikTok API for Business', conf: 'official',
    desc: 'Портал разработчика Marketing API', url: 'https://business-api.tiktok.com/portal',
    kw: ['api', 'marketing api', 'разработчикам', 'портал', 'developer']
  },
  {
    id: 'api-docs', group: 'docs', icon: 'code', title: 'Документация API', conf: 'official',
    desc: 'Справочник эндпоинтов Marketing API', url: 'https://business-api.tiktok.com/portal/docs',
    kw: ['api', 'документация', 'docs', 'эндпоинты', 'endpoints', 'reference']
  }
]);

export const DEFAULT_FAVORITES = Object.freeze(['bc-create', 'adaccount-create', 'billing-bind', 'billing', 'campaigns', 'events', 'account-settings']);
export const LINK_BY_ID = new Map(LINKS.map((l) => [l.id, l]));

/* ---------- URL: проверка, подстановка ---------- */

const ID_RE = /^\d{5,30}$/;
const PLACEHOLDER = /\{(aadvid|bcid)\}/g;

export function isSafeHttpUrl(value, { allowPlaceholders = false } = {}) {
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\s\u0000-\u001f]/.test(value)) return false;
  const probe = allowPlaceholders ? value.replace(PLACEHOLDER, '1234567') : value;
  try {
    const u = new URL(probe);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}

// Подмена адреса встроенной ссылки допускается только на tiktok.com — иначе импорт настроек мог бы увести «Биллинг» на чужой сайт.
export function isTikTokUrl(value, options) {
  if (!isSafeHttpUrl(value, options)) return false;
  try { return /(^|\.)tiktok\.com$/.test(new URL(options?.allowPlaceholders ? value.replace(PLACEHOLDER, '1234567') : value).hostname); } catch { return false; }
}

// Подставляет {aadvid}/{bcid}. Параметры запроса с неизвестным значением удаляются (TikTok откроет последний
// использованный кабинет); если значения нет, а плейсхолдер стоит в пути — используется fallback или отказ.
export function resolveUrl(template, ctx = {}, fallback = '') {
  const values = { aadvid: ID_RE.test(String(ctx.aadvid ?? '')) ? String(ctx.aadvid) : '', bcid: ID_RE.test(String(ctx.bcid ?? '')) ? String(ctx.bcid) : '' };
  const missing = new Set();
  const hashAt = template.indexOf('#');
  const head = hashAt === -1 ? template : template.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : template.slice(hashAt);
  const queryAt = head.indexOf('?');
  let path = queryAt === -1 ? head : head.slice(0, queryAt);
  const query = queryAt === -1 ? '' : head.slice(queryAt + 1);
  let pathMissing = false;
  path = path.replace(PLACEHOLDER, (_, name) => { if (!values[name]) { missing.add(name); pathMissing = true; return ''; } return values[name]; });
  const kept = [];
  for (const part of query.split('&').filter(Boolean)) {
    let drop = false;
    const replaced = part.replace(PLACEHOLDER, (_, name) => { if (!values[name]) { missing.add(name); drop = true; return ''; } return encodeURIComponent(values[name]); });
    if (!drop) kept.push(replaced);
  }
  const fragment = hash.replace(PLACEHOLDER, (_, name) => { if (!values[name]) { missing.add(name); return ''; } return values[name]; });
  const miss = [...missing];
  if (miss.length && fallback) {
    return isSafeHttpUrl(fallback) ? { ok: true, url: fallback, missing: miss, usedFallback: true } : { ok: false, url: '', missing: miss };
  }
  if (pathMissing) return { ok: false, url: '', missing: miss };
  const url = path + (kept.length ? `?${kept.join('&')}` : '') + (fragment === hash ? hash : fragment.endsWith('/') || fragment === '#' ? '' : fragment);
  return isSafeHttpUrl(url) ? { ok: true, url, missing: miss, usedFallback: false } : { ok: false, url: '', missing: miss };
}

// Итоговый адрес ссылки с учётом пользовательской подмены (overrides) и кастомных ссылок.
export function linkTemplate(link, overrides = {}) {
  const override = overrides?.[link.id];
  return override && isTikTokUrl(override, { allowPlaceholders: true }) ? { url: override, fallback: '', overridden: true } : { url: link.url, fallback: link.fallback || '', overridden: false };
}

export function resolveLink(link, ctx = {}, overrides = {}) {
  const { url, fallback, overridden } = linkTemplate(link, overrides);
  return { ...resolveUrl(url, ctx, fallback), overridden };
}

/* ---------- Контекст: кабинет и BC из адреса страницы ---------- */

export function parseContext(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)tiktok\.com$/.test(u.hostname)) return null;
    const aadvid = u.searchParams.get('aadvid') || u.searchParams.get('advertiser_id') || '';
    const bcid = u.searchParams.get('org_id') || u.searchParams.get('bc_id') || '';
    return { aadvid: ID_RE.test(aadvid) ? aadvid : '', bcid: ID_RE.test(bcid) ? bcid : '' };
  } catch { return null; }
}

/* ---------- Поиск ---------- */

export const normalizeText = (s) => String(s ?? '').toLowerCase().replaceAll('ё', 'е').replace(/[«»"'`.,:;!?()[\]{}<>/\\|+*#~^%$@=_-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Грубое отсечение русских окончаний (кабинеты → кабинет, апелляция → апелляци): запрос и текст сравниваются в одной форме.
const stem = (word) => (word.length > 4 ? word.replace(/(ами|ями|ов|ев|ей|ом|ем|ах|ях|ам|ям|ым|им|ой|ый|ий|ая|яя|ое|ее|ую|юю|[аяуюыиеоьй])$/, '') : word);
const stemText = (s) => normalizeText(s).split(' ').map(stem).join(' ');

// Возвращает ссылки, подходящие под ВСЕ слова запроса, лучшие — первыми.
export function searchLinks(query, links, { favorites = [] } = {}) {
  const tokens = stemText(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const fav = new Set(favorites);
  const scored = [];
  for (const link of links) {
    const title = stemText(link.title), desc = stemText(link.desc), kws = (link.kw ?? []).map(stemText), hint = stemText(link.hint);
    let score = 0, ok = true;
    for (const token of tokens) {
      let s = 0;
      if (title.startsWith(token)) s = 6; else if (title.split(' ').some((w) => w.startsWith(token))) s = 5; else if (title.includes(token)) s = 3;
      if (kws.some((k) => k === token)) s = Math.max(s, 5);
      else if (kws.some((k) => k.startsWith(token) || k.split(' ').some((w) => w.startsWith(token)))) s = Math.max(s, 3);
      else if (kws.some((k) => k.includes(token))) s = Math.max(s, 2);
      if (!s && desc.includes(token)) s = 1;
      if (!s && hint.includes(token)) s = 1;
      if (!s) { ok = false; break; }
      score += s;
    }
    // Функции расширения (app) выше обычных страниц TikTok, даже если у страницы есть бонус избранного.
    if (ok) scored.push({ link, score: score + (fav.has(link.id) ? 0.5 : 0) + (link.app ? 0.75 : 0) - title.length / 1000 });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.link);
}

/* ---------- Настройки ---------- */

const CUSTOM_ID = /^[a-z0-9_-]{1,40}$/;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export const DEFAULT_LINKS_SETTINGS = Object.freeze({ openIn: 'new', favorites: [...DEFAULT_FAVORITES], recents: [], custom: [], overrides: {} });

export function normalizeLinksSettings(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ids = (list, max) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && CUSTOM_ID.test(x)))].slice(0, max);
  const custom = [], seen = new Set();
  for (const item of Array.isArray(r.custom) ? r.custom : []) {
    if (!item || typeof item.id !== 'string' || !CUSTOM_ID.test(item.id) || seen.has(item.id) || LINK_BY_ID.has(item.id)) continue;
    if (!isSafeHttpUrl(item.url, { allowPlaceholders: true })) continue;
    seen.add(item.id);
    custom.push({ id: item.id, title: clip(item.title, 60) || 'Ссылка', url: item.url, hint: clip(item.hint, 160) });
    if (custom.length >= 100) break;
  }
  const overrides = {};
  for (const [id, url] of Object.entries(r.overrides && typeof r.overrides === 'object' ? r.overrides : {})) {
    if (LINK_BY_ID.has(id) && isTikTokUrl(url, { allowPlaceholders: true }) && Object.keys(overrides).length < 100) overrides[id] = url;
  }
  return {
    openIn: r.openIn === 'current' ? 'current' : 'new',
    favorites: Array.isArray(r.favorites) ? ids(r.favorites, 30) : [...DEFAULT_FAVORITES],
    recents: ids(r.recents, 8),
    custom,
    overrides
  };
}

export function allLinks(settings) {
  const custom = (settings?.custom ?? []).map((c) => ({ ...c, group: 'custom', icon: 'star', desc: c.hint || hostOf(c.url), kw: [hostOf(c.url)], conf: 'custom', custom: true }));
  return [...LINKS, ...custom];
}

export function hostOf(url) {
  try { return new URL(url.replace(PLACEHOLDER, '1234567')).hostname; } catch { return ''; }
}

export function newCustomId(now = Date.now(), rand = Math.random()) {
  return `c_${now.toString(36)}${Math.floor(rand * 1296).toString(36).padStart(2, '0')}`.slice(0, 40);
}

/* ---------- «Сохранить текущую страницу» ---------- */

const VOLATILE_PARAMS = new Set(['campaign_draft_id', 'st', 'et', 'compare_st', 'compare_et']);
const SENSITIVE_PARAM = /token|secret|signature|(^|_)sign(_|$)|session|csrf|auth|(^|_)code$|ticket|passw|pwd|credential|(^|_)(api_?)?key$/i;

// Шаблон из адреса вкладки. На чужих сайтах параметры и хэш не сохраняются вовсе (в них бывают токены),
// на TikTok убираются служебные (даты, черновик) и похожие на секреты.
export function fromCurrentUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const tiktok = /(^|\.)tiktok\.com$/.test(u.hostname);
  const params = [];
  let hasAccount = false, hasBc = false, trimmed = !tiktok && (u.search !== '' || u.hash !== '');
  if (tiktok) {
    for (const [key, value] of u.searchParams) {
      if (VOLATILE_PARAMS.has(key)) continue;
      if (SENSITIVE_PARAM.test(key)) { trimmed = true; continue; }
      if ((key === 'aadvid' || key === 'advertiser_id') && ID_RE.test(value)) { params.push(`${key}={aadvid}`); hasAccount = true; continue; }
      if ((key === 'org_id' || key === 'bc_id') && ID_RE.test(value)) { params.push(`${key}={bcid}`); hasBc = true; continue; }
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%7B/gi, '{').replace(/%7D/gi, '}')}`);
    }
  }
  const template = `${u.origin}${u.pathname}${params.length ? `?${params.join('&')}` : ''}${tiktok ? u.hash : ''}`;
  return isSafeHttpUrl(template, { allowPlaceholders: true }) ? { template, hasAccount, hasBc, trimmed } : null;
}

/* ---------- Переключение кабинета с сохранением страницы ---------- */

const SWITCH_KEEP = ['/i18n/manage/', '/i18n/account/payment', '/i18n/events_manager', '/i18n/reporting', '/i18n/creative-library',
  '/lead_center', '/catalogs', '/i18n/automated-rules-v2', '/i18n/sas/audience', '/i18n/material/comment', '/i18n/experiment-manager',
  '/i18n/attribution-manager', '/i18n/recommendation-center', '/i18n/verification-center', '/i18n/dashboard'];

export function switchAccountUrl(currentUrl, accountId) {
  if (!ID_RE.test(String(accountId))) return null;
  const fallback = `${ADS}/i18n/manage/campaign?aadvid=${accountId}`;
  try {
    const u = new URL(currentUrl);
    if (u.origin === ADS && SWITCH_KEEP.some((p) => u.pathname.startsWith(p))) {
      return { url: `${ADS}${u.pathname}?aadvid=${accountId}`, kept: true };
    }
  } catch { /* не адрес — вернём список кампаний */ }
  return { url: fallback, kept: false };
}

/* ---------- Omnibox ---------- */

export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const pages = (links) => links.filter((l) => !l.app);

export function omniboxSuggestions(query, source, { favorites = [], limit = 6 } = {}) {
  const links = pages(source);
  const found = query.trim() ? searchLinks(query, links, { favorites }) : links.filter((l) => favorites.includes(l.id));
  return found.slice(0, limit).map((l) => ({ content: `link:${l.id}`, description: `<match>${escapeXml(l.title)}</match> <dim>— ${escapeXml(l.desc || '')}</dim>` }));
}

export function parseOmniboxInput(text, source, { favorites = [] } = {}) {
  const links = pages(source);
  const raw = String(text ?? '').trim();
  const direct = raw.startsWith('link:') ? links.find((l) => l.id === raw.slice(5)) : null;
  return direct ?? searchLinks(raw, links, { favorites })[0] ?? null;
}
