# Живой тест TTAds Hub 1.5.0

Дата: 28 октября 2026 года. Аккаунт авторизован во встроенном браузере. Пароли, OTP, cookies и реквизиты карты в файлы не записывались.

## Тестовые объекты

- Company: `Example Corp`, ID `<id-8312ae>`.
- Исходный BC: `TTAds Hub DOM Test`, ID `<id-7cf55d>`.
- BC-получатель: `Example Corp_<id-8312ae>`, ID `<id-c5da97>`.
- РК, принадлежащий исходному BC: `TTAds Hub RK DOM Test`, ID `<id-cbad6c>`, Approved.
- РК с Request Access: `Example Corp0924`, ID `<id-9f7ab7>`, Approved, owner `<user>`.
- Payment Portfolio Advanced: ID `<id-ffa0c9>`.

## Accounts и ownership

На странице `/manage/accounts/adv?org_id=<id-7cf55d>` одновременно видны два РК:

1. `<id-9f7ab7>` — доступ получен через Request Access, owner остался внешним пользователем.
2. `<id-cbad6c>` — owner `TTAds Hub DOM Test`.

На шаге Add partner → Share assets TikTok показал только `<id-cbad6c>`. РК с Request Access не предлагается для передачи партнёру. Вывод: агентский доступ не даёт исходному BC права дальше расшаривать чужой РК как свой актив.

## Актуальный DOM Partners

Живой TikTok перенаправляет старый `/manage/partner` на `/manage/company/partner?org_id={BC_ID}`.

Новая последовательность:

1. `+ Add partner`.
2. Поле `Partner's Business Center or ad account ID`.
3. После ввода ID первый `Next` может только запустить lookup.
4. Появляется карточка: название BC, `Business Center ID`, замаскированная Company.
5. Ещё один `Next` открывает `02 Share assets`.
6. Категории: `Advertiser accounts`, `Pixels`, `Catalogs`, `Shops`, `Market Scope accounts`.
7. Для advertiser account выбирается строка РК и один из переключателей `Admin`, `Operator`, `Analyst`.
8. Финальный `Next` немедленно отправляет запрос. Отдельного шага Review или кнопки Assign/Confirm сейчас нет.
9. Success-модал: `Add partner request sent.` → `Got it`.

Отправлен живой тестовый запрос:

- source BC `<id-7cf55d>`;
- recipient BC `<id-c5da97>`;
- РК `<id-cbad6c>`;
- роль `Admin`.

У получателя появилась строка `TTAds Hub DOM Test — Pending approval` и карточка `Review partner request`: кнопки `Decline` и `Approve`, статус `Pending`, BC отправителя `<id-7cf55d>`, РК `<id-cbad6c>`, Role assigned `Admin`.

После разрешения владельца `Approve` нажат в скрытой вкладке. Результат проверен повторным чтением интерфейса:

- партнёр `TTAds Hub DOM Test / <id-7cf55d>` имеет активное состояние;
- в `Shared with you` виден РК `TTAds Hub RK DOM Test / <id-cbad6c>`;
- назначенная роль — `Admin`;
- после approval TikTok открыл необязательный обратный шаг `Share assets` с РК получателя `onerk55 / <id-6450ba>` и `onerk / <id-f20ff1>`; ничего из них не передавалось, модал закрыт.

## Создание РК

На `/account/create?source=TTBC_HOME` подтверждён живой вариант создания РК в существующем BC:

- Company `Example Corp`;
- выбран BC `TTAds Hub DOM Test / <id-7cf55d>`;
- поле `Ad account name` подготовлено как `TTAds Hub 150 Live 1028`;
- time zone `(UTC+01:00) Madrid Time`;
- Commercial Terms уже отмечены;
- финальная кнопка `Confirm` создаёт РК.

После разрешения владельца `Confirm` нажат в скрытой вкладке. РК создан:

- name: `TTAds Hub 150 Live 1028`;
- advertiser ID: `<id-294f41>`;
- Business Center: `TTAds Hub DOM Test / <id-7cf55d>`;
- payment-setup route содержит `adv_id=<id-294f41>`, `bc_id=<id-7cf55d>` и `org_id=<id-7cf55d>`.

На следующем экране доступны два независимых задания:

1. `Link TikTok accounts` — создать новый TikTok account либо связать существующий; можно `Skip for now`.
2. Payment setup — TikTok автоматически выбрал существующий Advanced Portfolio `Portfolio for Example Corp / <id-ffa0c9>`; доступны `Unlimited` и `Custom` budget, выбран `Unlimited`, а также `View auto-filled payments information`.

После отдельного финального согласия владельца финансовый `Confirm` нажат в скрытой вкладке. Payment setup исчез из списка незавершённых заданий, а optional `Link TikTok accounts` остался. Это подтверждает успешную связь нового РК `<id-294f41>` с Advanced Portfolio `<id-ffa0c9>` и бюджетом `Unlimited`. Скриншот результата: `payment-portfolio-new-rk-linked.png`.

## Payment management

Маршрут `/manage/payment/v2?org_id=<id-7cf55d>` в текущем прогоне завис на бесконечном spinner. Reload и повторный переход через меню не помогли. В консоли были только warnings: `[Garfish warning]: Package "util" is not found` и `no questionnaire match`. Явной JS error не было.

Автоматизации нужен тайм-аут загрузки, сохранение URL/видимых кнопок и результат `needs-user` вместо бесконечного ожидания. Ранее на этом же аккаунте подтверждён Portfolio `<id-ffa0c9>`, один payment method и связанный РК `<id-cbad6c>`.

## Исправления 1.5.0 после живого теста

- `runInPageGuarded` и ожидание вкладки принимают несколько допустимых URL-prefix.
- Partners использует новый маршрут, старый оставлен fallback.
- Add partner ждёт lookup-карточку и при необходимости нажимает второй Next.
- После финального Next движок ждёт success/error и распознаёт `Add partner request sent.`.
- Request Access ждёт асинхронный lookup Account ID, поддерживает финальный `Skip` и распознаёт `automatically approved`.
- Windows mock использует `os.tmpdir()` и находит OpenSSL из Git.

После исправлений: 59/59 JS и 12/12 JSON валидны; smoke всех девяти вкладок — без ошибок; локальные e2e A–D — `ALL PASSED`.

## Следующие проверки

1. Проверить новый РК в Finance после устранения spinner и перечитать portfolio ID серверным ответом.
2. Проверить существующего партнёра: Partner row → Share assets без повторного Add partner.
3. Проверить Operator и Analyst отдельными тестовыми запросами.
4. Проверить обработку отказа и истечения partner request без удаления текущей активной связи.

