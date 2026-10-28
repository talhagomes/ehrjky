# Быстрые ссылки TTAds Hub

Файл создаётся автоматически из `extension/background/links/catalog.js` (`npm run docs:links`) — не редактируйте вручную.

**Подстановки:** `{aadvid}` — ID рекламного кабинета, `{bcid}` — ID Business Center. Если кабинет неизвестен, параметр убирается из адреса и TikTok открывает последний использованный кабинет; если неизвестен BC, ссылки на Business Center ведут на его главную страницу.

**Уровни достоверности адреса:**

- ✅ наблюдался в живом Ads Manager
- 📘 адрес из официальных материалов TikTok
- ≈ собран по структуре BC, не проверен

**Избранное по умолчанию:** `bc-create`, `adaccount-create`, `billing`, `campaigns`, `events`, `account-settings`.

## Аккаунты и Business Center

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Создать Business Center**<br>Новый BC (до 30 на пользователя) | `https://business.tiktok.com/` | 📘 адрес из официальных материалов TikTok | Войдите → страница «Select an account» → «Create new» (справа вверху) |
| **Создать рекламный кабинет**<br>Новый ad account внутри Business Center | `https://business.tiktok.com/manage/overview?org_id={bcid}`<br>без BC: `https://business.tiktok.com/` | ≈ собран по структуре BC, не проверен | Accounts → All accounts → Advertiser accounts → Add advertiser account → Create New → Next (нужны права Admin) |
| **Регистрация TikTok Ads**<br>Новый аккаунт TikTok for Business по email или телефону | `https://ads.tiktok.com/i18n/signup/` | 📘 адрес из официальных материалов TikTok |  |
| **Вход в TikTok Ads**<br>Страница входа в Ads Manager | `https://ads.tiktok.com/i18n/login` | 📘 адрес из официальных материалов TikTok |  |
| **Business Center**<br>Главная выбранного Business Center | `https://business.tiktok.com/manage/overview?org_id={bcid}`<br>без BC: `https://business.tiktok.com/` | ≈ собран по структуре BC, не проверен |  |
| **Пользователи Business Center**<br>Участники, роли и доступы | `https://business.tiktok.com/manage/overview?org_id={bcid}`<br>без BC: `https://business.tiktok.com/` | ≈ собран по структуре BC, не проверен | В левом меню «Users» → «Add Members» |
| **Настройки кабинета**<br>Имя, часовой пояс, валюта, контакты, верификация | `https://ads.tiktok.com/i18n/verification-center/setting?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |

## Биллинг и оплата

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Привязать карту к РК**<br>Выбор кабинета, проверка карт и запуск формы TikTok | Вкладка расширения `Оплата`; целевая страница `https://ads.tiktok.com/i18n/account/payment?aadvid={aadvid}` | ✅ проверено на живом кабинете | Для РК внутри BC открывается `https://business.tiktok.com/manage/financeRole?org_id={bcid}` |
| **Биллинг и оплата**<br>Баланс, способы оплаты, транзакции, счета | `https://ads.tiktok.com/i18n/account/payment?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Финансы в Business Center**<br>Платежи и счета на уровне BC | `https://business.tiktok.com/manage/financeRole?org_id={bcid}`<br>без BC: `https://business.tiktok.com/` | ✅ маршрут проверен | Без финансовой роли показывает `Finance access required`; с правами открывает Payment management |
| **Справка: автоплатёж**<br>Как работает автоматическая оплата и порог списания | `https://ads.tiktok.com/help/article/set-up-automatic-payment` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: способ оплаты**<br>Добавление и обновление карты | `https://ads.tiktok.com/help/article/add-a-payment-method-for-automatic-payment-in-tiktok-ads-manager?lang=en-GB` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: возврат средств**<br>Как вернуть неизрасходованный баланс | `https://ads.tiktok.com/help/article/refund-faq` | 📘 адрес из официальных материалов TikTok |  |

## Управление рекламой

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Дашборд**<br>Сводка по расходу и результатам | `https://ads.tiktok.com/i18n/dashboard?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Создать кампанию**<br>Список кампаний с кнопкой «Создать» | `https://ads.tiktok.com/i18n/manage/campaign?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager | Нажмите «Создать» → выберите цель → откройте расширение → «Включить Manual» |
| **Кампании**<br>Список кампаний, статусы и статистика | `https://ads.tiktok.com/i18n/manage/campaign?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Адсеты**<br>Группы объявлений (Ad group) | `https://ads.tiktok.com/i18n/manage/adgroup?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Объявления**<br>Объявления и креативы (Ad) | `https://ads.tiktok.com/i18n/manage/creative?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Отклонённые объявления**<br>Список объявлений для апелляций | `https://ads.tiktok.com/i18n/manage/creative?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager | Отфильтруйте Rejected / Review issue → вкладка расширения «Апелляции» |
| **Отчёты**<br>Кастомные отчёты и экспорт статистики | `https://ads.tiktok.com/i18n/reporting/list?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Автоправила**<br>Automated rules: остановка по расходу и CPA | `https://ads.tiktok.com/i18n/automated-rules-v2/management/manage?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Центр рекомендаций**<br>Рекомендации TikTok по оптимизации | `https://ads.tiktok.com/i18n/recommendation-center?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Эксперименты**<br>Experiment manager (сплит-тесты) | `https://ads.tiktok.com/i18n/experiment-manager?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Аналитика атрибуции**<br>Attribution analytics: сравнение каналов | `https://ads.tiktok.com/i18n/attribution-manager/insight/comparison?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |

## Ресурсы и креативы

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Events Manager (пиксели)**<br>Пиксели, события и S2S Events API | `https://ads.tiktok.com/i18n/events_manager/home?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Создать пиксель**<br>Пиксель и Developer token за один клик — вкладка «Пиксель» | `https://ads.tiktok.com/i18n/events_manager/home?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager | открывает вкладку «Пиксель» расширения. Страницу Events Manager открывает ссылка «Events Manager (пиксели)» |
| **Каталоги**<br>Catalog Manager: товарные каталоги | `https://ads.tiktok.com/catalogs/insights?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Библиотека креативов**<br>Creative Library: видео и изображения | `https://ads.tiktok.com/i18n/creative-library/dashboard?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Лиды**<br>Leads Center: заявки с форм | `https://ads.tiktok.com/lead_center/leads?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Аудитории**<br>Audience Manager: сохранённые аудитории | `https://ads.tiktok.com/i18n/sas/audience/adver/main?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Комментарии**<br>Comments Manager: ответы под объявлениями | `https://ads.tiktok.com/i18n/material/comment/list?aadvid={aadvid}` | ✅ наблюдался в живом Ads Manager |  |
| **Creative Center**<br>Топ-объявления, тренды и идеи для креативов | `https://ads.tiktok.com/business/creativecenter` | 📘 адрес из официальных материалов TikTok |  |
| **TikTok Ad Library**<br>Публичная библиотека рекламы (Commercial Content Library) | `https://library.tiktok.com/ads` | 📘 адрес из официальных материалов TikTok |  |
| **TikTok Pixel Helper**<br>Расширение Chrome для проверки пикселя на сайте | `https://chromewebstore.google.com/detail/tiktok-pixel-helper/aelgobmabdmlfmiblddjfnjodalhidnn` | 📘 адрес из официальных материалов TikTok |  |

## Модерация и политики

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Рекламные политики TikTok**<br>Условия, правила и руководства для рекламодателей | `https://ads.tiktok.com/i18n/official/policy/terms` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: блокировка аккаунта**<br>Предупреждения о риске блокировки и причины | `https://ads.tiktok.com/help/article/account-suspension-alerts` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: нет доступа к BC**<br>Что делать, если не открывается Business Center | `https://ads.tiktok.com/help/article/troubleshoot-tiktok-business-center-account-access` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: защита Business Center**<br>Рекомендации по безопасности и 2FA | `https://ads.tiktok.com/help/article/best-practices-for-securing-your-business-center` | 📘 адрес из официальных материалов TikTok |  |

## Справка и документация

| Ссылка | Адрес | Достоверность | Подсказка |
| --- | --- | --- | --- |
| **Business Help Center**<br>Справочный центр TikTok for Business | `https://ads.tiktok.com/resources/help?lang=en` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: о Business Center**<br>Возможности, роли и настройка BC | `https://ads.tiktok.com/help/article/tiktok-business-center` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: создание BC**<br>Пошагово: первый и дополнительные Business Center | `https://ads.tiktok.com/help/article/create-tiktok-business-center` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: создание кабинета в BC**<br>Пошагово: новый рекламный аккаунт в Business Center | `https://ads.tiktok.com/help/article/create-ad-accounts-in-business-center` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: роли и права BC**<br>Admin, Standard и доступы к активам | `https://ads.tiktok.com/help/article/about-business-center-roles-and-permissions` | 📘 адрес из официальных материалов TikTok |  |
| **Справка: Pixel Helper**<br>Как проверять пиксель расширением | `https://ads.tiktok.com/help/article/tiktok-pixel-helper-2.0?lang=en` | 📘 адрес из официальных материалов TikTok |  |
| **TikTok API for Business**<br>Портал разработчика Marketing API | `https://business-api.tiktok.com/portal` | 📘 адрес из официальных материалов TikTok |  |
| **Документация API**<br>Справочник эндпоинтов Marketing API | `https://business-api.tiktok.com/portal/docs` | 📘 адрес из официальных материалов TikTok |  |

## Omnibox и клавиши

- В адресной строке введите `tt`, пробел и запрос: `tt биллинг`, `tt создать bc`, `tt пиксель`. Enter открывает лучший результат, стрелки выбирают другой.
- Горячая клавиша открытия панели по умолчанию — `Alt+Shift+K` (меняется в `chrome://extensions/shortcuts`).
- В панели: клик — открыть (по настройке «в новой / в текущей вкладке»), `Ctrl`/`Shift`/средняя кнопка — открыть наоборот, `Enter` в поиске — открыть первый результат.
