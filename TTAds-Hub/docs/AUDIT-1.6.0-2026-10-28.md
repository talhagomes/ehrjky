# TTAds Hub 1.6.0 — аудит и handoff разработки

Дата проверки: 2026-10-28  
Проверяемая папка: `<папка>\TTAds-Hub`  
Эталон старого Manual: `<папка>\TTAds-Hub`

> **Примечание (версия проекта после аудита).** Инструменты проверки перенесены из `TTAds-Hub/tools` в корень проекта (вне папки расширения), см. `README-DEV.md`:
> `npm run check`, `npm run test:dom` (бывший `npm run manual`), `npm run smoke`, `npm run test:e2e` (сценарии на локальном «TikTok»), `npm run verify`.
> Из задач P0 выполнены: классификатор ошибок для массовых действий, отключение и срок жизни обученных контрактов, read-before-retry, подпись Smart+ для другого языка,
> предупреждение о 2027. Подробности и невыполненное — в `1.6.0-ads-automation.md`.

## Короткий результат

Регрессия кнопки «Включить Manual» исправлена. Причина была не в service worker и не в сборке 1.6.0: TikTok заменил старый выбор отдельного варианта Manual новым unified workflow. В нём Manual означает, что переключатель **Power your campaign with Smart+ выключен**. Старый код искал только legacy-карточку `.cs-campaign-option`/`lego-hybrid-section`, поэтому не видел ни выбранную цель, ни активный Manual.

Исправление поддерживает оба редактора:

- legacy: прежняя карточка Manual;
- unified: aria-radio цели и Smart+ switch;
- основной путь остаётся API-first: перехваченный запрос сохранения черновика;
- если TikTok изменил контракт save/replay, расширение выключает Smart+ через DOM в **этом же открытом черновике** и проверяет конечное состояние;
- новая вкладка для переключения Manual не создаётся.

## Что изменено

### `background/manual/probes.js`

- `selectedGoal()` теперь распознаёт выбранную цель в новом редакторе по `[data-testid^="new-objective-selection-"][role="radio"][aria-checked="true"]`.
- Поддержаны `Sales`, `App Promotion`, `Lead Generation` и прежние legacy-селекторы.
- `manualView()` считает unified Manual активным, если Smart+ switch имеет `aria-checked="false"`.
- При `click=true` переключатель Smart+ выключается и затем повторно проверяется; простого факта клика недостаточно для успеха.
- `inspectCreationModal()` поддерживает как старый Shadow DOM/Confirm, так и новый полноэкранный выбор цели/Continue.

### `background/manual/engine.js`

- В статус возвращаются `mode: "legacy" | "unified"` и `smartPlus`.
- Сначала выполняется API replay/save.
- При несовместимом API-контракте выполняется локальный unified DOM fallback в той же вкладке.
- Ошибка API не скрывается: она попадает в журнал как warning, а результат помечается `fallback: "unified-dom"`.
- Сохранены проверки advertiser ID, draft ID, пути `/create/campaign`, цели, непубликованного состояния и повторное чтение результата.

### `ui/views/manual.js`

- Для unified режима показывается понятный статус «Smart+ выключен».
- Текст интерфейса объясняет порядок: API/save → проверка custom mode.

## Live-проверка Manual

Проверка выполнена в авторизованном TikTok Ads Manager на advertiser `<id-9f7ab7>`.

| Проверка | Результат |
|---|---|
| Определение цели Sales | `sales` |
| Smart+ ON | `{ manual:false, shown:false, mode:"unified", smartPlus:true }` |
| Выключение Smart+ | Успешно, в текущем черновике |
| Smart+ OFF | `{ manual:true, shown:true, mode:"unified", smartPlus:false }` |
| Открытие новой вкладки при переключении | Нет |
| Публикация кампании | Не выполнялась |
| Запуск расхода | Не выполнялся |

Во время проверки новый TikTok workflow автоматически создал тестовый **черновик**, когда была выбрана цель Sales:

- draft ID: `<id-907840>`;
- имя: `Sales20261028134752`;
- цель: Sales → Website;
- Smart+ оставлен выключенным;
- черновик не опубликован и ничего не расходует.

Также read-only проверен существующий черновик `<id-c35f37>`: Smart+ уже был выключен, новый probe корректно распознал Manual.

Черновики не удалялись, потому что удаление — отдельное необратимое действие над данными пользователя.

## Полная матрица проверки 1.6.0

Легенда:

- **PASS live** — проверено на настоящей странице TikTok;
- **PASS e2e** — проверено mock-средой с воспроизводимыми страницами и состояниями;
- **PASS smoke/static** — загрузка/контракты/синтаксис проверены, но бизнес-операция в TikTok в этом прогоне не выполнялась;
- **HOSTED** — по конструкции требует штатной страницы TikTok;
- **PARTIAL** — работает, но контракт динамический или не полностью API-only.

| Модуль | Статус | Что подтверждено | Ограничение |
|---|---|---|---|
| Service worker / manifest | PASS smoke/static | worker загружается без startup error | — |
| Все 9 разделов UI | PASS smoke | creation, access, overview, links, billing, manual, appeals, pixel, s2s | визуальная smoke-проверка, не каждая операция live |
| Manual | PASS live | unified цель, Smart+ ON/OFF, распознавание и переключение | TikTok может снова изменить DOM или save endpoint |
| Список РК | PASS e2e/static | `accounts.list`, нормализация и UI RPC | session API требует действующую авторизацию TikTok |
| Обзор/статистика | PASS e2e/static | чтение, фильтры, экспорт, кампании | состав метрик зависит от доступных колонок/прав |
| Создание BC + РК | PASS e2e | сценарий A, несколько элементов, сохранение состояния | реальное создание в этом аудите не запускалось; hosted wizard динамический |
| Создание РК в существующем BC | PASS e2e | сценарий B | hosted wizard динамический |
| Пауза verification/resume | PASS e2e | сценарий C | код/CAPTCHA всегда обрабатывает TikTok |
| Расшаривание + auto-accept | PASS e2e | A/B/D, включая verification resume | зависит от прав администратора в обеих сторонах |
| Transfer ownership | PASS static/e2e-архитектура | валидация, группировка, job state | live transfer не запускался; есть финансовые/ownership pre-checks |
| Payment Portfolio link | PASS e2e | выбор/связка в конвейере | hosted finance UI; зависит от ролей и eligibility |
| Карта/биллинг | HOSTED | status reader, переход в нужный billing context | ввод карты и 3DS остаются в защищённой форме TikTok/PipoPay |
| Массовый status/name/budget | PARTIAL/API-first | preflight → mutation → reread → audit → rollback | один раз нужно обучить актуальный session API request на тестовом объекте |
| Апелляции | PASS static/smoke | session API, verify submission | live appeal не отправлялась |
| Pixel + token | PASS static/smoke | таймауты, частичные warning, S2S handoff | live pixel/token в этом аудите не создавались |
| Мониторинг | PASS static/smoke | cache, alarm, problem flags | полная billing health сейчас использует скрытые вкладки |
| Быстрые ссылки | PASS smoke | подстановка контекста, открытие current/new | это навигация, не API |

## Запущенные тесты

### Static check

- JavaScript файлов: 71;
- JSON файлов: 14;
- RPC handlers: 71;
- UI RPC calls: 71;
- результат: `STATIC CHECK PASSED`.

Проверяется:

- синтаксис всех JS;
- валидность JSON;
- существование относительных imports;
- соответствие UI-вызовов обработчикам service worker.

### Manual DOM contracts

Результат: `MANUAL PROBES PASSED`.

Покрыты:

- legacy Manual;
- unified objective;
- Smart+ ON/OFF;
- click fallback;
- unified Continue;
- Lead Generation.

### Extension smoke

Результат: `SMOKE PASSED`.

Подтверждены:

- загрузка unpacked extension;
- запуск service worker;
- рендер всех девяти разделов UI.

Последние артефакты smoke: `<папка>\TTAds-Hub\tools\out-smoke`.

### Full mock e2e A–D

После исправления Manual повторно выполнен полный harness 1.5.0 против кода 1.6.0. Результат: `ALL PASSED`.

- A: 2 × BC+РК → Portfolio → share → auto-accept → закрытие вкладок;
- B: существующий BC → share существующему партнёру;
- C: verification pause/resume;
- D: share verification pause/resume.

Артефакты: `<папка>\test-output\e2e-after-manual-fix`.

## Что действительно можно делать через API

### 1. Официальный TikTok API for Business

Это предпочтительный долгосрочный слой. Он требует зарегистрированного приложения, scopes и access token — cookie авторизованной вкладки недостаточно.

Официально доступны:

- получить/создать/обновить кампании;
- изменить статус кампании;
- получить/создать/обновить ad groups;
- изменить status и budget ad group;
- получить/создать/обновить ads и status;
- automated rules;
- отчёты и метрики;
- creative assets, audiences, pixels/events и часть Business Center операций в зависимости от одобренных scopes.

Источники:

- [TikTok API for Business — портал и список категорий](https://business-api.tiktok.com/portal)
- [Campaign Management API reference](https://business-api.tiktok.com/gateway/docs/index?doc_id=1708888686234625&identify_key=2b9b4278e47b275f36e7c39a4af4ba067d088e031d5f5fe45d381559ac89ba48)
- [Marketing API v2.0](https://business-api.tiktok.com/portal/docs/marketing-api/v2.0)

Критическое изменение: согласно официальной документации, с **1 января 2027** legacy `/campaign/create/`, `/campaign/copy/task/create/`, `/adgroup/create/`, `/ad/create/`, `/ad/aco/create/` перестают создавать/копировать non-Search Legacy Manual Flow для Sales, App Promotion и Lead Generation. Для долгоживущего one-click создания нужно добавить адаптер Upgraded Smart+ API, а Manual сохранить как совместимый режим редактора/существующих объектов.

### 2. Session API авторизованной страницы

Текущий TTAds Hub использует `fetch(..., credentials:"include")` внутри разрешённой вкладки. Это позволяет работать без отдельной Developer App, но внутренние endpoint/body/header могут измениться без версии и предупреждения.

Хорошо подходит для:

- списка РК и текущего контекста;
- чтения campaign/ad group/ad и статистики;
- отчётов;
- апелляций;
- массового status/name/budget после обучения актуального mutation request;
- чтения некоторых billing/health данных, если endpoint надёжно обнаружен.

Обязательные правила для session API:

1. Не хранить cookies, CSRF/access tokens и полный заголовок запроса в diagnostics.
2. Привязывать контракт к host + method + shape + версии/времени обучения.
3. Перед mutation перечитывать объект.
4. После mutation перечитывать и сравнивать поле.
5. При несовпадении не объявлять успех.
6. Для enable/budget показывать расходный preview/confirm.
7. Хранить данные для rollback, но выполнять откат только через подтверждённый обратный контракт.
8. На 401/403/429/5xx выдавать отдельные классы ошибок, а не общий «не работает».

### 3. DOM/hosted TikTok UI

DOM остаётся необходимым для операций, где TikTok не предоставляет стабильный публичный контракт для данного self-service аккаунта или использует защищённые платёжные/verification компоненты:

- создание Business Center и некоторые мастера создания РК;
- partner access/share/accept;
- ownership transfer и settlement pre-check;
- связка РК с Payment Portfolio;
- добавление/изменение карты, 3DS, CAPTCHA, код подтверждения;
- запасной путь unified Manual, если save contract изменился.

Такие вкладки можно держать неактивными и автоматически закрывать после проверенного успеха. Нельзя честно обещать «вообще без страниц»: защищённый card iframe и transfer approval являются частью TikTok hosted flow.

## Биллинг и наследование карты

Официальная модель TikTok — не «карта навсегда прикреплена к любому новому РК». РК использует средства и payment methods того Payment Portfolio, к которому он привязан. Один Business Center может иметь несколько Portfolio; поэтому новый РК должен быть создан/добавлен в нужную группу Portfolio или связан с ней после создания.

Подтверждённые правила:

- Payment Portfolio объединяет payment methods, cash balance/credit line и бюджетное управление;
- только approved ad accounts могут быть включены;
- нужны Admin/Finance Manager права;
- advanced Portfolio может делить cash balance/credit line между несколькими РК;
- ad credit автоматически не разделяется;
- новая карта добавляется через Finance → Payment management или Billing;
- при automatic payment карта проходит проверку; возможна временная проверочная операция;
- owned-by-BC РК управляет automatic payment через Business Center;
- ввод PAN/CVV и 3DS не должен перехватываться или храниться расширением.

Источники:

- [About Payment Portfolio](https://ads.tiktok.com/help/article/about-payment-portfolio?lang=en)
- [How to use Payment Portfolio](https://ads.tiktok.com/resources/help/article/how-to-use-payment-portfolio)
- [Add or update a payment method](https://ads.tiktok.com/resources/help/article/add-a-payment-method-for-automatic-payment-in-tiktok-ads-manager?lang=en-GB)
- [Set up automatic payment](https://ads.tiktok.com/help/article/set-up-automatic-payment)

Практический one-click сценарий:

1. Выбрать или создать BC.
2. Создать РК в этом BC.
3. Дождаться Approved.
4. Определить Portfolio данного BC.
5. Связать РК с Portfolio.
6. Перечитать finance page/API и подтвердить portfolio ID/status.
7. Если Portfolio уже имеет primary payment method, не просить карту повторно.
8. Если метода нет, открыть штатную Add payment method форму один раз.

## Share, Request Access и transfer — это разные операции

- **Share/partner access**: другой BC получает права, но ownership остаётся у исходного BC. Финансовая модель владельца не становится автоматически моделью партнёра.
- **Request Access**: BC запрашивает Admin/Operator/Analyst доступ к существующему РК; ownership не меняется.
- **Ownership transfer**: РК меняет владельца. Требует approval получателя и финансового pre-check.
- **Payment Portfolio link**: финансовая связь внутри доступной модели Business Center; это не то же самое, что share.

По официальным правилам transfer:

- обе стороны должны быть Approved;
- исходный BC должен владеть РК;
- получателю нужны quota и Payment Portfolio;
- валюта РК должна совпадать;
- active campaigns при transfer приостанавливаются и затем возобновляются вручную;
- unpaid invoices, незавершённые payment changes, shared billing, settlement requests и некоторые country restrictions блокируют transfer;
- owned assets переходят, linked assets не обязательно переходят автоматически;
- нужен отдельный approval администратора BC-получателя.

Источник: [How to transfer ad accounts in TikTok Business Center](https://ads.tiktok.com/resources/help/article/how-to-transfer-ad-accounts-in-tiktok-business-center?lang=en).

## Разбор ошибок и устойчивость

### Уже сделано правильно

- централизованный `HubError` и понятные пользовательские сообщения;
- строгая проверка advertiser/draft/business center ID;
- single active job для pipeline/objects/health;
- timeouts у page scripts и network calls;
- pause/resume для verification;
- persistence состояния pipeline при закрытии popup;
- повторное чтение результата mutation;
- rollback для подтверждённых object mutations;
- диагностика маскирует ID/текст и не экспортирует cookies/tokens/card data;
- вкладки проверяются на допустимый origin/path перед исполнением page script;
- Manual проверяет конечное состояние Smart+.

### Остаточные риски

| Приоритет | Риск | Что сделать |
|---|---|---|
| P0 | Внутренний session API изменился | Ввести versioned contract registry, `learnedAt`, TTL и invalidation после 404/400 schema error |
| P0 | TikTok UI локализован не на English | Добавить selector по стабильному role/testid/aria; text использовать только последним fallback |
| P0 | Ошибка 429 смешивается с обычным network error | Единый classifier: auth, permission, rate-limit, validation, verification, server, DOM drift |
| P0 | Повтор mutation после timeout может продублировать действие | Перед retry перечитать объект; retry только если целевое поле не изменилось |
| P1 | Health открывает много скрытых billing/finance страниц | Перехватить и нормализовать payment summary JSON; DOM оставить fallback |
| P1 | Точные payment endpoints ещё не зафиксированы | Добавить read-only network recorder с allowlist URL и redaction, собрать несколько BC/РК |
| P1 | Mutation contract обучается на одном объекте | Проверять совместимость contract по level/objective/campaign type и required body fields |
| P1 | В diagnostics мало кодов причин | Добавить `error.code`, `httpStatus`, `step`, `retryable`, `origin`, но не request secrets |
| P1 | Старый Manual API станет ограничен в 2027 | Реализовать официальный Upgraded Smart+ adapter и feature flag по objective/flow |
| P2 | S2S/Pixel проверены только smoke | Добавить mock API tests и live read-only status test |
| P2 | UI regression ловится только smoke | Добавить screenshot assertions ключевых вкладок и fixture локализаций |

## Рекомендуемая API-first архитектура

```text
UI action
  -> capability router
      -> Official API adapter (если настроен developer token/scope)
      -> Session API adapter (авторизованная вкладка, versioned learned contract)
      -> Hosted DOM adapter (только если первые два пути недоступны)
  -> reread/verify
  -> audit event + normalized result
```

Каждая capability должна описываться одним объектом:

```json
{
  "id": "campaign.status.update",
  "preferred": ["official-api", "session-api", "hosted-dom"],
  "risk": "spend-affecting",
  "requires": ["advertiser_access", "operator"],
  "preflight": true,
  "verify": "campaign.get",
  "rollback": "previous_status",
  "opensTab": false
}
```

Это позволит UI заранее показать, будет ли операция API-only или откроет hosted flow.

## Следующие задачи для другого агента

### P0 — сделать первым

1. Добавить `background/lib/errors.js` с нормализацией HTTP/TikTok/DOM ошибок.
2. Вынести адаптеры в `background/adapters/{official,session,hosted}` и capability router.
3. Для accounts/statistics/objects добавить отображение `source: official-api | session-api | cache` и возраст данных.
4. Добавить invalidation/TTL для обученных mutation contracts.
5. Добавить idempotency-защиту: read-before-retry после timeout.
6. Расширить Manual fixtures локализациями и тестом отсутствия нужного Smart+ switch.
7. Реализовать feature flag/предупреждение о 2027 migration для Sales/App/Lead creation.

### P1 — следующий релиз

1. Read-only recorder payment summary с allowlist и обязательной redaction.
2. Перевести health на payment JSON; hidden finance tabs оставить только fallback.
3. Добавить capability/status экран «API / session / hosted».
4. Поддержать официальный OAuth/API for Business без отключения session режима.
5. Добавить export/import **конфигурации** кампании: не обещать прямой перенос delivery history и IDs между РК.
6. Добавить очередь с ограничением concurrency и backoff/jitter для 429.

### P2

1. Fixture-набор DOM для нескольких языков.
2. Snapshot/screenshot regression UI.
3. Webhook/subscription для review/lead updates при настроенном официальном приложении.
4. Расширенный audit CSV/JSON: кто, когда, источник, preflight, verification, rollback ID.

## Команды проверки

Быстрый обязательный набор:

```powershell
cd "<папка>\TTAds-Hub\tools"
npm install
$env:CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run check
npm run manual
npm run smoke
```

Полный mock e2e A–D:

```powershell
cd "<папка>\tools"
$env:CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
node .\e2e.mjs "<папка>\TTAds-Hub" "<папка>\test-output\e2e"
```

После любого изменения Manual минимум:

```powershell
cd "<папка>\TTAds-Hub\tools"
npm run check
npm run manual
```

## Установка исправленной версии

1. Открыть `chrome://extensions`.
2. Найти TTAds Hub 1.6.0.
3. Нажать «Обновить/Reload» у распакованного расширения.
4. Перезагрузить открытую вкладку TikTok Ads Manager.
5. На шаге Campaign открыть расширение → Manual → «Включить Manual».
6. Убедиться, что интерфейс показывает «Smart+ выключен».

## Test-only зависимости

`tools/node_modules` нужен только локальным тестам и не должен входить в архив расширения. `npm install` сообщил о 9 high severity у транзитивных test-only зависимостей Puppeteer. Не применять `npm audit fix --force` вслепую: это может сломать harness. Обновление тестовой зависимости следует делать отдельной задачей и повторить smoke/e2e.

## Файлы для продолжения

- `background/manual/probes.js` — DOM-контракты legacy/unified Manual;
- `background/manual/engine.js` — capture/replay/save и fallback;
- `ui/views/manual.js` — состояние Manual в UI;
- `background/objects/engine.js` — безопасные массовые mutations;
- `background/objects/learn.js` — обучение session API contract;
- `background/health/engine.js` — billing/health scanner;
- `background/access/engine.js` — Request Access/Portfolio/transfer;
- `background/pipeline/engine.js` — BC+РК+Portfolio+share pipeline;
- `docs/internal-api-catalog.json` — собранные маршруты/session endpoints;
- `docs/tiktok-ads-capability-map.md` — полная карта функций;
- `tools/README.md` — команды тестирования.
