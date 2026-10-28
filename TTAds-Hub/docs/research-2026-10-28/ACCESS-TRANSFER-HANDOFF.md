# Доступ, ownership transfer и одна карта для нескольких РК

Дата живого исследования: 28 октября 2026 года.

## Три разных механизма

### 1. Request Access

Маршрут: `Business Center → Accounts → Advertiser accounts → Add advertiser account → Request Access`.

Поля живой формы:

- `Account ID`;
- `Access permission`: `Admin`, `Operator`, `Analyst`;
- `Asset sharing` — необязательный следующий шаг.

TikTok прямо сообщает: исходный бизнес остаётся владельцем РК. Владелец получает уведомление в Ads Manager и должен одобрить запрос.

Права:

- Admin — финансы, настройки, permissions, создание/редактирование кампаний, отчёты;
- Operator — финансы, кампании, отчёты, но не все настройки/permissions;
- Analyst — просмотр рекламы и статистики.

Request Access подходит для агентского управления, но не переносит ownership и не переносит карту/Payment Portfolio.

### 2. Transfer advertiser accounts

Self-service transfer переносит ownership из исходного BC в получающий BC. Возможность показывается через `More → Transfer advertiser accounts` только eligible-клиентам.

Последовательность:

1. Admin исходного BC вводит ID получающего BC.
2. Выбирает до 30 РК и дату передачи.
3. Проверяет funds/payment details.
4. Отправляет transfer request.
5. Admin получающего BC одобряет запрос.

Основные ограничения:

- оба BC должны быть Approved;
- РК: auction, Approved, принадлежит исходному BC, нет другого transfer request;
- у получателя должна быть квота и включён Payment Portfolio;
- currency РК должна совпадать с currency получающего BC;
- unpaid/unbilled Auto Pay invoices, незавершённые billing changes и некоторые shared-billing связи блокируют transfer;
- активные кампании могут автоматически остановиться, затем их нужно возобновлять вручную;
- при cross-Company transfer средства не переходят в новый BC: остаток возвращается в исходный Portfolio/BC стандартным refund-процессом;
- при same-Company transfer средства обычно сохраняются, но GMV Pay выключается;
- owned assets перемещаются; linked pixels, catalogs, audiences, TikTok accounts и Shops автоматически не переходят без отдельных прав.

Если меню `More → Transfer advertiser accounts` отсутствует, расширение не может обойти eligibility: нужно оставить Request Access либо создать новый РК в целевом BC.

### 3. Payment Portfolio

Карта хранится в Payment Portfolio, а не в конкретном РК и не в логине. Связанные с Portfolio РК используют его funds и payment methods. Advanced Portfolio поддерживает совместное использование cash balance/credit line; ad credit остаётся account-level.

Для массовой привязки:

1. У пользователя должны быть Business Center Admin и Finance Manager.
2. Открыть `Finance → Payment management`.
3. Открыть Portfolio → `View details`.
4. Нажать `+Add accounts to link`.
5. Выбрать Approved РК и подтвердить.

Для новых РК TikTok также показывает `Ad accounts not yet linked to Payment Portfolios → Link now`.

## Реализация TTAds Hub 1.4.0

Новая вкладка `Доступ`:

- сканирует возможности выбранного BC;
- отправляет Request Access пакетно для списка РК;
- автоматически использует личные РК из кэша, если ID не введены;
- связывает все доступные РК выбранного BC с Payment Portfolio;
- запускает self-service transfer до 30 РК между доступными BC;
- показывает, когда нужна Finance Manager, owner approval, recipient approval или ручная проверка TikTok.

Service worker хранит последнюю операцию в `accessLastJob`. В job нет cookies, card data, OTP или паролей.

DOM-движок всегда проверяет `org_id`, ID РК и точные тексты текущего шага. Если TikTok изменил форму или не показывает eligibility-кнопку, действие останавливается и открывает вкладку для пользователя.

## Живой результат

РК `<id-cbad6c>` успешно связан с Advanced Payment Portfolio `<id-ffa0c9>`. После подтверждения секция Payment setup исчезла; Ads Manager показывает `Payment Portfolio Advanced`, automatic payment и общий payment workspace.

Identity verification пройдено кодом из замаскированного Outlook. После проверки TikTok открыл `/manage/payment/v2`: текущий Admin получил finance-доступ. Живая страница показывает Advanced Portfolio `<id-ffa0c9>`, один payment method и связанный Approved РК `<id-cbad6c>`.

## Официальные источники

- Manage ad accounts: https://ads.tiktok.com/resources/help/article/manage-ad-accounts-business-center?lang=en
- Request access: https://ads.tiktok.com/resources/help/article/request-access-to-ad-accounts-in-business-center
- Transfer ad accounts: https://ads.tiktok.com/resources/help/article/how-to-transfer-ad-accounts-in-tiktok-business-center?lang=en
- Roles and permissions: https://ads.tiktok.com/resources/help/article/about-business-center-roles-and-permissions?lang=en
- Payment Portfolio: https://ads.tiktok.com/resources/help/article/how-to-use-payment-portfolio
- Multiple portfolios: https://ads.tiktok.com/resources/help/article/how-to-manage-multiple-payment-portfolios
