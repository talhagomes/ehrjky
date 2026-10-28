# Привязка карты к рекламному кабинету

Проверено 25 октября 2026 года на TikTok Ads Manager и TTAds Hub 1.2.2.

## Что означает «привязать карту к РК»

TikTok хранит способ оплаты не как открытые реквизиты внутри рекламного кабинета, а в `Payment Portfolio`. Рекламный кабинет связан с платежным портфелем и использует его способы оплаты. В интерфейсе текущего тестового РК TikTok прямо указывает: изменения способов оплаты применяются ко всем аккаунтам, связанным с этим Payment Portfolio.

Для личного РК расширение выполняет следующую цепочку:

1. Берет ID выбранного кабинета.
2. Открывает `https://ads.tiktok.com/i18n/account/payment?aadvid={aadvid}`.
3. Ждет загрузки блока `Payment methods`.
4. Нажимает `Add a payment method`.
5. TikTok открывает защищенную форму PipoPay в iframe.
6. Пользователь вводит карту и нажимает `Submit`.
7. TikTok проверяет карту и добавляет ее в Payment Portfolio выбранного кабинета.
8. Вкладка «Оплата» расширения повторно читает маску, валюту и срок действия и показывает статус `привязана`.

Поля карты обслуживаются iframe с отдельного origin вида `https://pay-my.pipopay.com/...#uniqueId=new_ccdc_bind`. TTAds Hub не подменяет отправку формы: именно ответ TikTok/PipoPay создает платежный метод и связывает его с портфелем.

## РК внутри Business Center

Если у кабинета есть `bcId`, TikTok требует добавлять способ оплаты на уровне Business Center:

1. TTAds Hub открывает `https://business.tiktok.com/manage/financeRole?org_id={bcid}`.
2. Пользователь переходит в `Finance` → `Payment management`.
3. В Payment Portfolio выбирает `Manage` или `Add a payment method`.
4. После `Submit` карта становится доступна рекламным кабинетам, связанным с выбранным портфелем.

Для изменения платежей нужна роль `Finance Admin` либо Admin/участник с ролью Finance Manager. В тестовом Business Center фактически показан экран `Finance access required`, потому что у текущего пользователя нет финансовой роли.

## Реализация в расширении

- `background/billing/engine.js` выбирает маршрут Ads Manager или Business Center.
- `background/billing/page-scripts.js` читает Payment Portfolio и открывает форму добавления карты.
- `ui/views/billing.js` дает выбор РК, кнопку привязки и проверку результата.
- В журнал записывается только факт открытия платежного потока и ID кабинета; реквизиты карты не записываются.

## Проверенный тестовый кабинет

- `aadvid`: `<id-9f7ab7>`.
- Портфель: `Payment Portfolio Advanced`.
- Billing option: `Automatic payment`.
- На странице есть карта с маской `••••`, срок действия `MM/YY`.
- Кнопка `Add a payment method` открывает iframe PipoPay.
- Автоплатеж приостановлен из-за задолженности `5.00 EUR`; добавление новой карты само по себе не закрывает задолженность, после привязки ее нужно погасить через `Pay now`.

## Официальная логика TikTok

- Для Ads Manager: Billing → Payment → Add payment method → Submit.
- Для кабинета, принадлежащего Business Center: Finance → Payment management; нужны финансовые права.
- При automatic payment новая карта проходит проверку; возможна временная проверочная операция и 3-D Secure.
