# TikTok Business Center / Ads account research — 2026-10-28

Снимок контрактов, собранный в авторизованном интерфейсе TikTok Business Center и из публичных JS-бандлов страницы. Секреты сессии, cookies, OTP, пароли, номера карт, `msToken`, `X-Bogus` и подписанные query-параметры намеренно исключены.

Файлы:

- `LIVE-TEST-1.5.0.md` — живой прогон 1.5.0: ownership, новый DOM Partners, финальный Next, pending approval, creation и Finance spinner.
- `live-test-1.5.0.json` — те же результаты в машинном формате для следующего агента.
- `ADS-AUTOMATION-HANDOFF-1.5.0.md` — полная карта управления рекламой: CRUD, статистика, импорт/экспорт, перенос, sharing, billing, DOM/API и roadmap.
- `ads-capability-matrix-1.5.0.json` — машиночитаемая матрица возможностей, маршрутов, метрик, рисков и статуса реализации.
- `DEVELOPER-HANDOFF.md` — архитектура автоматизации и практические выводы.
- `business-create-dom.json` — страницы, режимы, поля, Shadow DOM и селекторы.
- `business-create-enums.json` — страны, валюты, timezones, spend buckets и отрасли.
- `business-create-api-catalog.json` — read/mutation endpoints с уровнем подтверждения.
- `billing-payment-portfolio.json` — модель владения оплатой и живой payment-setup.
- `runtime-assets.json` — публичные runtime-бандлы страницы.
- `live-test-result.json` — созданные тестовые сущности и проверенные маршруты.
- `ACCESS-TRANSFER-HANDOFF.md` — Request Access, ownership transfer, approvals, assets и средства.
- `access-transfer-portfolio.json` — машиночитаемые роли, prerequisites и результаты live-теста.
- `payment-portfolio-linked.png` — экран после подтверждения связи.
- `payment-management-linked.png` — Advanced Portfolio, payment method count и связанный РК.
- `payment-portfolio-new-rk-linked.png` — результат Confirm: payment task нового РК исчез, optional TikTok account linkage остался.

Для production-кода источник истины — текущий UI и официальные API TikTok. Внутренние endpoints могут измениться без предупреждения.
