# Передача разработчику: one-click BC + РК и биллинг

## Что подтверждено живым тестом

28 октября 2026 года официальный мастер `business.tiktok.com/account/create` успешно создал новый Business Center и первый рекламный кабинет в существующей Company. После `Confirm` TikTok перенаправил на `/account/payment-setup` и передал `company_id`, `bc_id`/`org_id`, `adv_id`, `adv_name` и `account_biz_type` в query string. РК после этого открылся в Ads Manager и имел пустой список кампаний.

На Payment setup TikTok автоматически выбрал существующий Advanced Payment Portfolio. Текст интерфейса прямо указывает: рекламный кабинет использует средства и способы оплаты выбранного портфеля. Связь ещё требует отдельного `Confirm`; поэтому создание сущностей и финансовая связь реализованы двумя явными действиями.

## Реализованный сценарий в TTAds Hub 1.3.1

1. На вкладке «Обзор» пользователь нажимает «BC + РК в один клик».
2. Service worker генерирует безопасные уникальные имена и открывает официальный мастер в фоновой вкладке.
3. DOM-движок выбирает существующую Company, новый BC, заполняет BC/РК, принимает обязательные Terms, выключает необязательный Beta Tester и нажимает `Confirm`.
4. После навигации движок извлекает ID только из URL и читает безопасную сводку Payment setup.
5. Если TikTok показал существующий Payment Portfolio, во вкладке «Создать» появляется отдельная кнопка «Подключить Portfolio + automatic payment». Только её явный клик нажимает финансовый `Confirm`.
6. При CAPTCHA, identity verification, недоступном поле или ошибке TikTok вкладка становится активной, а job переходит в `needs-user`/`error`.

## Почему DOM, а не прямой POST

Публичные бандлы раскрывают endpoint `POST /api/v3/bm/bp/create/` и несколько старых/сценарных create-endpoints, но mutation-клиенты используют risk wrapper (`withRiskInfo`) и в части сценариев `idvScene`. Подписи и токены короткоживущие и привязаны к текущей сессии. Хардкодить их нельзя: это ломко и создаёт риск утечки аккаунта. DOM официального мастера сохраняет серверную валидацию, риск-проверки, Terms и актуальную форму.

## Основные поля

Канонические имена из runtime-бандла: `businessName`, `bcName`, `country`, `timezone`, `currency`, `website`, `advertiserName`, `industry`, `advTimezone`, `contactName`, `contactPhone`, `contactEmail`, `tiktokBusinessTerms`, `betaTesterTerms`, `monthlyAdSpend`, `billingAddress`, `postalCode`, `financeContactEmail`, `paymentMethod`, `billingGroupId`, `invoicePayer`, `taxType`, `companyInfo`, `linkageStatus` и другие. Полный список и назначение — в `business-create-dom.json`.

## Важные DOM-детали

- Страница построена на Keystone web components (`ks-*`).
- Нативные checkbox находятся внутри Shadow DOM. Видимые host IDs: `tiktokBusinessTerms`, `betaTesterTerms`.
- Устойчивые placeholders: `Enter a name for your account`, `Enter ad account name`, `Business website or app download URL`, `Enter your business name`, `Contact name`, `Enter phone number`, `Please enter your email`.
- Для radio/select лучше сначала искать семантический текст внутри секции между заголовками, а не полагаться на сгенерированные классы.
- Кнопка формы — видимый enabled `button` с точным текстом `Confirm`.
- После submit успех определяется навигацией с `/account/create`, а не всплывающим toast.

## Режимы

- `Advertiser`: Company → Business Center → Advertiser Account; подходит для one-click BC+РК.
- `Agency`: Company → Business Center, без полей первого РК в наблюдённой форме.
- Existing Company + new BC — рекомендуемый и минимальный сценарий: страна/валюта/timezone наследуются/предлагаются TikTok.
- New Company требует реальных юридических и контактных данных; случайно генерировать их нельзя, потому что business name используется в счетах/налоговых документах и меняется с ограничениями.

## Биллинг и карта

Карта не «прикрепляется к логину» и не копируется в каждый РК. Способы оплаты принадлежат Payment Portfolio. Все linked accounts используют средства и payment methods этого портфеля; изменения применяются ко всем связанным кабинетам. Новый РК получает доступ к карте без повторного ввода реквизитов только когда его связали с тем же Portfolio и TikTok не требует дополнительной проверки.

В живом тесте новый РК показал `Payment Portfolio Advanced`, automatic payment и сообщение, что способы оплаты управляются в Payment Portfolio. На payment-setup уже был выбран существующий Portfolio, но его `Confirm` намеренно оставлен отдельным действием.

Официальные справки:

- Create Business Center: https://ads.tiktok.com/help/article/create-tiktok-business-center?lang=en&redirected=1
- Payment Portfolio: https://ads.tiktok.com/resources/help/article/how-to-use-payment-portfolio
- About Payment Portfolio: https://ads.tiktok.com/help/article/about-payment-portfolio?lang=en
- Automatic payment: https://ads.tiktok.com/help/article/set-up-automatic-payment
- Add automatic payment method: https://ads.tiktok.com/resources/help/article/add-a-payment-method-for-automatic-payment-in-tiktok-ads-manager?lang=en-GB

## State machine

`opening → filling → complete | needs-user | pending | error`

Для payment association: `detected → explicit-user-click → linked | pending | error`.

Job хранится локально под `creationLastJob`; пароли, OTP, cookie, card data и сетевые подписи туда не попадают.

## Что тестировать после изменения TikTok UI

1. Advertiser/Agency переключатель и заголовки трёх секций.
2. Placeholders BC/РК.
3. Shadow DOM checkbox hosts и обязательный Terms.
4. Выбор существующей Company при нескольких Company.
5. URL-параметры после submit.
6. Payment setup: выбран ли существующий Portfolio, доступен ли `Confirm`, не появился ли новый обязательный шаг.
7. CAPTCHA/identity verification и восстановление через «Проверить».
8. Отдельно проверить countries/currencies/industries через live read endpoints: списки зависят от региона и rollout.

## Ограничения

- One-click выбирает существующую/первую доступную Company, которую предлагает TikTok. Если Company несколько и TikTok не выбрал одну автоматически, сценарий может потребовать ручного выбора.
- Валюта, страна и billing option зависят от Company/региона/eligibility и не должны насильно подменяться.
- Наличие карты в Portfolio не гарантирует отсутствие 3DS, verification charge, tax/IDV или других проверок TikTok.
- Внутренние endpoints — исследовательская карта, не публичный стабильный API.
