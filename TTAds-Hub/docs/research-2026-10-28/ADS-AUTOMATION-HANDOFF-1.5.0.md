# TTAds Hub 1.5.0 — handoff по автоматизации рекламы

Дата: 28 октября 2026 года. Документ объединяет живое исследование авторизованного TikTok Ads Manager/Business Center, текущий код расширения, публичные JS-контракты интерфейса и официальную документацию TikTok for Business. Секреты сессии и платёжные реквизиты не сохранялись.

## Главный технический вывод

Production-версию лучше строить из трёх адаптеров с общей моделью данных:

1. **Official Marketing API** — стабильный слой для списков, CRUD, статусов, отчётов и автоматических правил. Требует TikTok for Business app, OAuth и разрешения рекламодателя.
2. **Session API** — запросы от имени открытой авторизованной вкладки `ads.tiktok.com`/`business.tiktok.com`. Нужен для быстрого бесплатного режима без отдельного OAuth, но внутренние endpoints и поля могут измениться.
3. **DOM/Hosted UI** — Business Center, payment setup, защищённая форма карты, импорт-файлы и редкие действия без стабильного API. Автоматизировать подготовку и навигацию, а результат всегда перечитывать из UI/API.

DOM не должен быть единственным источником статистики. Для каждого действия нужен `preflight → mutation → reread → audit log`, idempotency key расширения и тайм-аут.

## Что подтверждено в живом аккаунте

Тестовый РК `Example Corp0924 / <id-9f7ab7>`:

- 2 кампании, 3 объявления в выбранной кампании и 2 campaign drafts;
- обе кампании включены, но `Not delivered` из-за `Insufficient account balance. Add funds to resume delivery.`;
- всего за 18–25 октября 2026: spend `8.97 EUR`, impressions `5,653`, clicks `1,115`, CTR `19.72%`, CPC `0.01 EUR`, CPM `1.59 EUR`, conversions `201`, CPA `0.04 EUR`, CVR `3.56%`;
- виден security warning `Verify your phone number for security.`;
- для одной кампании доступны `Bulk edit`, `Turn on/off`, `Duplicate`, `View report`, `Create split test`, `Delete`;
- `Bulk edit` кампании: Name, Budget, PO number, Replace negative keywords;
- для объявления доступны `Bulk edit`, `Turn on/off`, `Duplicate`, `Preview`, `Delete`; bulk fields: Name, Creative, Text, Destination link;
- row actions объявления: View report, Edit, Duplicate и дополнительное меню;
- экспорт/импорт: Export All, Filtered ads, Selected ads, Download latest export results, Import ads, Download template;
- глобально доступны Label, Automated rules, Export data и Keyboard shortcuts.

Живой partner flow полностью завершён: BC `<id-7cf55d>` активен у получателя `<id-c5da97>`, РК `<id-cbad6c>` расшарен с ролью Admin.

Живое создание РК завершено: `TTAds Hub 150 Live 1028 / <id-294f41>`. На payment setup существующий Advanced Portfolio `<id-ffa0c9>` выбран автоматически. После отдельного финального согласия финансовый Confirm отправлен; payment setup исчез из незавершённых заданий, optional TikTok account linkage остался. Связь подтверждена.

## Единая модель данных

Минимальные сущности:

- `BusinessCenter`: id, name, companyId, region, verificationStatus, role, financeRole.
- `Advertiser`: id, name, ownerBcId, accessMode, status, country, currency, timezone, paymentMode, portfolioId, balance, debt, securityWarnings.
- `Campaign`: advertiserId, campaignId, name, objective, budgetMode, budget, statusToggle, primaryStatus, deliveryReason, labels, createdAt, updatedAt.
- `AdGroup`: advertiserId, campaignId, adgroupId (`ad_id` во внутренних контрактах), name, placement, audience, schedule, optimizationGoal, bidStrategy, bid, budget, attribution, pixel/catalog/identity references, status.
- `Ad`: advertiserId, campaignId, adgroupId, adId/creativeId, name, identity, creative source, media, text, CTA, destination URL, tracking, moderation, status.
- `MetricRow`: level, objectId, statTimeDay, dimensions, spend, impressions, clicks, conversions и дополнительные метрики.
- `Asset`: pixel, event, audience, catalog, shop, TikTok identity, lead form, instant page, creative material.
- `PaymentPortfolio`: id, type, paymentMethodsMasked, advertiserIds, budget mode/limit, permissions.
- `AutomationJob`: type, source/target, state, progress, errors, result IDs, startedAt, finishedAt.
- `AuditEntry`: actor, adapter, action, before, request summary, after, confirmation state, error, timestamp.

ID нужно хранить строкой: TikTok ID превышают безопасный диапазон JavaScript Number.

## Управление кампаниями, группами и объявлениями

| Возможность | UI/Session API | Official API | Реализация в расширении |
|---|---|---|---|
| Список и статусы | `/i18n/manage/{campaign|adgroup|creative}`; `/api/v4/i18n/statistics/op/{level}/list/` | Campaign/Ad group/Ad get | P0, уже частично есть |
| Создание | штатный Create/editor | campaign/adgroup/ad create; upgraded Smart+ | P1: wizard + templates |
| Переименование | batch Name | update endpoints | P0 |
| Бюджет | campaign/adgroup batch budget + check | update endpoints | P0, показывать before/after |
| Ставка/расписание | adgroup batch bid/schedule + check | update endpoints | P1 |
| Вкл./пауза | update_status endpoints | status update | P0, может начать/остановить расход |
| Редактирование ad | `/api/v4/i18n/creation/patch/creative/` | ad update | P1 |
| Дублирование | Duplicate в каждом уровне | copy/create from source | P1, результат создаётся draft |
| Удаление | Delete; draft delete endpoints | status DELETE где поддерживается | P1, необратимо |
| Метки | campaign label endpoints | хранить mapping либо API при наличии | P2 |
| Split test | UI Create split test | API при доступе | P2 |
| Автоправила | UI + `/optimizer/rule/*` | automated rules endpoints | P1 |
| Апелляция | `/creation/audit/appeal_creative/` | moderation API при доступе | уже есть |

Session mutation endpoints, обнаруженные в текущих модулях:

- campaign status: `POST /api/v2/i18n/overture/campaign/update_status/`;
- ad group status: `POST /api/v3/i18n/overture/ad/update_status/`;
- ad status: `POST /api/v2/i18n/overture/creative/update_status/`;
- campaign name/budget: `/api/v3/i18n/overture/campaign/batch_update/{name|budget}/` и `/check/`;
- ad group name/budget/bid/schedule: `/api/v3/i18n/overture/ad/batch_update/{field}/` и `/check/`;
- ad name: `/api/v3/i18n/overture/creative/batch_update/name/` и `/check/`;
- editor patches: `/api/v4/i18n/creation/patch/ad/`, `/api/v4/i18n/creation/patch/creative/`;
- drafts delete: `/api/v4/i18n/creation/{campaign_sketch|ad_sketch|creative_sketch}/delete/`.

Во внутренних batch-запросах ID mapping: campaign=`campaign_id`, ad group=`ad_id`, ad=`creative_id`; maps называются `name_map`, `budget_map`, `schedule_map`. Полное тело надо снимать runtime-interceptor’ом для текущей версии TikTok, не фиксировать навсегда.

## Статистика и отчёты

### Размерности

Минимум: advertiser, campaign, ad group, ad, day/hour. Затем country/region, placement, OS, device, gender, age, audience, creative, search keyword и attribution window — только когда конкретное сочетание поддерживает API.

### Метрики

- delivery: status, primary status, learning phase, delivery reason;
- cost: spend, CPC, CPM, cost per result, cost per conversion;
- traffic: impressions, reach, frequency, clicks, destination clicks, CTR;
- conversion: conversions, real-time conversions, CVR, CPA, results/result rate;
- video: 2s/6s views, 25/50/75/100%, average watch time;
- commerce: purchases, value/revenue, complete payment, ROAS;
- lead: leads, form submissions, CPL;
- engagement: likes, comments, shares, follows, profile visits;
- quality: qualified conversions, cost/rate, moderation and diagnosis fields;
- attribution/SKAN/shop metrics включать capability-флагами.

Official reporting:

- sync: `/report/integrated/get/`;
- async: `/report/task/create/`, `/check/`, `/download/`, `/cancel/`.

Session endpoints: list/breakdown для трёх уровней, advertiser trend, monitor cards, diagnosis report и recommendations. Большие периоды загружать асинхронно, кэшировать по `{advertiser, level, dimensions, metrics, range, timezone}`.

## Импорт, экспорт, копирование и «перенос»

### CSV/XLSX bulk import/export

TikTok официально поддерживает CSV/XLSX для создания, редактирования и копирования объектов. Расширение может:

1. скачать template/reference;
2. построить таблицу из шаблона кампании пользователя;
3. валидировать обязательные поля, enum, валюту, timezone, URL и ссылки на assets;
4. открыть Import ads, передать файл, отслеживать результат;
5. сохранить row-level ошибки и предложить исправленный файл.

Для новых объектов ID оставляются пустыми; для edits нельзя менять заголовки и ID. Неверное поле способно отклонить весь файл.

### Копирование внутри РК

Duplicate копирует campaign/ad groups/ads и создаёт draft. Нельзя считать копию запущенной: после создания нужно перечитать новые ID, показать diff и отдельно опубликовать/включить.

### Перенос в другой РК

У кампании нет универсальной операции смены `advertiser_id`. Практический перенос — export/import либо recreate/copy в целевом РК. Pipeline:

1. read source tree + assets;
2. capability check target (objective, country, currency, timezone, payment mode);
3. сопоставить pixel, catalog, audience, TikTok identity, lead form и creative assets;
4. создать draft в target;
5. проверить moderation/budget/URL/tracking;
6. включить только после отдельной проверки;
7. исходник не удалять автоматически.

BC ownership transfer — другая операция: переносится сам РК между Business Centers, активные кампании могут быть остановлены, а assets и средства не обязательно переходят автоматически.

### Импорт из сторонних платформ

Обнаружен Meta-like flow: account get → OAuth → user → campaign list → submit job → query/list/cancel. Endpoints лежат под `/api/v4/i18n/creation/tool/import3p/`. OAuth выполняется в TikTok UI; расширение хранит только job state, не access token источника.

## Business Center, доступ и sharing

- `Create New` создаёт owned advertiser; `Request Access` оставляет owner внешним.
- РК, доступный через Request Access, в живом тесте не появился в списке активов для дальнейшей передачи партнёру.
- Partner flow: `/manage/company/partner?org_id={bcId}` → Add partner → lookup ID → Share assets → выбрать РК → Admin/Operator/Analyst → final Next.
- Получатель подтверждает Approve; после этого актив виден в `Shared with you`.
- Роли assets не равны finance roles. Для оплаты дополнительно нужны Finance Admin/Finance Manager и eligibility Payment Portfolio.
- TikTok accounts используются как identity/Spark Ads asset и назначаются отдельно.

Для one-click sharing нужен мастер: target BC ID, выбранные assets, permission, preflight ownership, отправка, ожидание Pending/Active, журнал. Повторная операция сначала должна найти существующего partner и использовать `Share assets`, а не создавать дубль.

## Billing и повторное использование карты

Рабочая модель — **карта → Payment Portfolio → список РК**, а не «карта автоматически принадлежит всем BC».

Живое наблюдение:

- существует Advanced Portfolio `<id-ffa0c9>` с payment method;
- owned РК `<id-cbad6c>` уже связан с ним;
- после создания нового РК `<id-294f41>` TikTok автоматически предложил и выбрал этот Portfolio;
- окончательная связь потребовала отдельный Payment Confirm; после него payment task исчез;
- если Portfolio уже содержит карту, повторный ввод реквизитов обычно не нужен: новый РК наследует доступ к payment methods через связь с Portfolio;
- автоматического безусловного подключения всех будущих РК не доказано: зависит от Company/BC, ownership, payment type, region, permissions и eligibility;
- Request Access к чужому РК не равен праву подключить его к своему Portfolio.

Рекомендуемый one-click flow:

1. read BC/advertiser ownership and finance role;
2. list eligible portfolios and supported payment modes;
3. if exactly one eligible portfolio — preselect it;
4. choose Unlimited/Custom budget;
5. show advertiser + portfolio + payment mask + limit;
6. confirm link in hosted TikTok payment setup;
7. reread Finance/advertiser and verify `portfolioId`.

Добавление новой карты должно оставаться в защищённом TikTok/PipoPay UI. Расширению достаточно маски, срока, brand, portfolio ID и статуса; CVV/полный PAN не нужны.

Session billing contracts, найденные в бандлах: `/api/v4/i18n/common/billing_config/`, `/billing_validate/`, `/address_config/`, `/pa/api/common/billing_info/*`, `/api/v2/bm/organization/supported_payment/`, `/qualified/billing/`, `/qualified/billing_detail/`. Контракт payment summary и tokenization не зафиксирован и не должен эмулироваться.

## Маршруты для quick actions

- dashboard: `/i18n/dashboard?aadvid={id}`;
- campaigns/ad groups/ads: `/i18n/manage/{campaign|adgroup|creative}?aadvid={id}`;
- billing: `/i18n/account/payment?aadvid={id}`;
- account settings: `/i18n/verification-center/setting?aadvid={id}`;
- reports: `/i18n/reporting/list?aadvid={id}`;
- events, catalog, creative library, leads, audience manager, comments, automated rules, recommendation center;
- experiments, audience/video/comment/attribution insights;
- search keyword planner, negative keywords, creative tools и Ad Preview.

Полный список живых URL находится в `ads-capability-matrix-1.5.0.json`.

## Ошибки и диагностика

Карточка РК должна объединять:

- access/ownership/role errors;
- account review/security warnings;
- debt, zero balance, insufficient balance, suspended auto-pay;
- object off, schedule ended, budget exhausted, learning limited;
- moderation rejection/review issue + appeal state;
- pixel/event/catalog/audience/identity errors;
- API HTTP/code/message, parsing drift и UI timeout.

Приоритет: access/account block → payment → delivery/mode → schedule/budget → moderation → assets/measurement. Не считать toggle=ON доказательством доставки; проверять `primary_status`/delivery reason.

Finance `/manage/payment/v2` в текущем прогоне завис на spinner без console error. Нужен 30–60 s timeout, snapshot URL/visible text/log warnings, retry один раз и итог `needs-user`, а не бесконечный loader.

## Контракты расширения

Предлагаемые команды background:

- `accounts.list`, `accounts.health`, `accounts.billingSummary`;
- `objects.list`, `objects.detail`, `objects.updateStatus`, `objects.bulkEdit`, `objects.duplicate`, `objects.deleteDraft`;
- `reports.query`, `reports.export`, `reports.jobStatus`;
- `imports.prepare`, `imports.submit`, `imports.status`, `imports.downloadErrors`;
- `transfer.plan`, `transfer.executeDraft`, `transfer.verify`;
- `sharing.plan`, `sharing.submit`, `sharing.verify`;
- `billing.eligibility`, `billing.prepareLink`, `billing.verifyLink`;
- `jobs.list/cancel/retry`, `audit.list/export`.

Единый результат:

```json
{
  "ok": true,
  "adapter": "official-api|session-api|dom",
  "operation": "objects.bulkEdit",
  "state": "prepared|submitted|verified|needs-user|failed",
  "entityIds": ["..."],
  "before": {},
  "after": {},
  "warnings": [],
  "errors": [],
  "evidence": { "url": "", "observedAt": "" }
}
```

## Roadmap

### P0

- overview всех РК: delivery, spend, balance/debt, top error;
- campaign/ad group/ad tables with cached statistics;
- pause/enable, rename, budget with preflight and reread;
- error inbox and deep links;
- partner/create flows from 1.5.0 with robust selectors/timeouts;
- export diagnostic bundle without secrets.

### P1

- templates and one-click draft creation;
- CSV/XLSX builder + import result parser;
- duplicate/cross-account transfer planner;
- automatic rules;
- Payment Portfolio eligibility/link verification;
- OAuth official API adapter alongside free session mode.

### P2

- charts/comparisons/alerts;
- asset mapping UI for cross-account copies;
- scheduled reports and multi-account rollups;
- reusable team presets, audit approvals and rollback where possible.

## Ограничения, которые нужно сохранить в коде

- внутренние endpoints version-sensitive; feature flag + fallback to UI;
- destructive delete необратим, поэтому по умолчанию только draft/soft-disable;
- enable/budget/payment могут повлиять на расход;
- mutation считается успешной только после повторного чтения;
- не хранить cookies, OTP, CSRF, signed query, PAN/CVV;
- не смешивать owner, access и partner share;
- не считать auto-selected Portfolio уже привязанным до verification; текущий тест подтверждён исчезновением payment task.

## Официальные источники

- Marketing API: https://business-api.tiktok.com/portal/docs/marketing-api/v2.0
- API reference/reporting: https://business-api.tiktok.com/portal/docs/api-reference/v2.0
- Supported reporting metrics: https://business-api.tiktok.com/portal/docs/supported-metrics-for-a-dimension-in-basic-reports/v1.3
- Bulk import/export: https://ads.tiktok.com/help/article/bulk-import-export?lang=en
- Edit via bulk import/export: https://ads.tiktok.com/resources/help/article/edit-ads-using-bulk-import-export?lang=en-GB
- Copy campaign: https://ads.tiktok.com/resources/help/article/copy-a-campaign?lang=en
- Delete ads: https://ads.tiktok.com/help/article/how-to-delete-ads-in-tiktok-ads-manager?lang=en
- Reports: https://ads.tiktok.com/help/article/create-manage-reports?lang=en
- Manage/transfer ad accounts: https://ads.tiktok.com/resources/help/article/manage-ad-accounts-business-center?lang=en
- Payment Portfolio: https://ads.tiktok.com/resources/help/article/how-to-use-payment-portfolio
- BC roles: https://ads.tiktok.com/resources/help/article/about-business-center-roles-and-permissions
- TikTok accounts in BC: https://ads.tiktok.com/resources/help/article/manage-tiktok-accounts-business-center?redirected=2

