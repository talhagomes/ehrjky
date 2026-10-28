# TikTok API for Business (Marketing API) v1.3 — verified contracts for the TTAds Hub MV3 extension
Verified 2026-10-28. Evidence tags: **[D]** official docs (English markdown read via the portal's doc gateway, §9) · **[SDK]** github.com/tiktok/tiktok-business-api-sdk (`python_sdk`, `yml_files`) · **[X]** independent consumers (Airbyte `source-tiktok-marketing`, `bububa/tiktok-business` Go SDK v1.5.7, Markifact docs) · **[LIVE]** observed by me with dummy credentials. Untagged or "UNCONFIRMED" = not verified.

- Base URL: `https://business-api.tiktok.com/open_api/v1.3` (sandbox `https://sandbox-ads.tiktok.com/open_api/v1.3` [X Airbyte]).
- Auth header: `Access-Token: <token>` [D,SDK,X].
- Paths must end with `/`; without it the server answers HTTP 308 to the slash URL [LIVE] (docs say 404).
- Doc URL pattern: `https://business-api.tiktok.com/portal/docs?id=<ID>`; IDs are listed under each section.

## 0. Cross-cutting contract
**GET params are JSON-in-query.** Sources: [D] official python/java/php samples on every endpoint page, e.g. https://business-api.tiktok.com/portal/docs?id=1739593083610113 (`urlencode({k: v if isinstance(v, str) else json.dumps(v)})`); [SDK] `ApiClient.parameters_to_tuples` (`json.dumps(list)`, https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/business_api_client/api_client.py); [SDK] yml declares such params as `content: application/json`; [X] Go `util.JSONMarshal` (https://github.com/bububa/tiktok-business/blob/v1.5.7/model/report/integrated_get.go).
- Strings go raw (NOT quoted). Arrays, objects, numbers and booleans are `JSON.stringify`-ed, then URL-encoded.
- Examples: `advertiser_ids=["1","2"]`, `page=1`, `query_lifetime=true`, `filtering={"keyword":"x"}` (object).
- Array of objects: `filtering=[{"field_name":"campaign_ids","filter_type":"IN","filter_value":"[\"1\"]"}]` — `filter_value` is itself a JSON-array **string**.
```js
const qs = o => new URLSearchParams(Object.entries(o).filter(([,v]) => v != null)
  .map(([k,v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
```
- One official curl sample (report) sends a JSON **body on GET**. `fetch` cannot do that; use the query-string form (every SDK/consumer does).

**Envelope** [D,LIVE]: `{code:number, message:string, request_id:string, data:object}`.
- HTTP status is 200 even for errors. Success is `code===0` (`20001` = partially successful). Error bodies may omit `data` or send `data:{}`.
- OK: `{"code":0,"message":"OK","request_id":"…","data":{"list":[],"page_info":{"page":1,"page_size":10,"total_page":0,"total_number":0}}}`
- Error [LIVE]: `{"code":40105,"message":"Access token is incorrect or has been revoked.","request_id":"20261028…"}`

**Pagination**: `page` (≥1, default 1), `page_size` (default 10; max **50** on BC/finance endpoints, max **1000** on reports) → `data.page_info{page,page_size,total_number,total_page}`.

**IDs are strings** in v1.3 (`advertiser_id`, `bc_id`, `asset_id`, `campaign_id`…; v1.2 used numbers) and are ~19 digits (> 2^53; e.g. a BC id `7087208094861623298` in a third-party doc). Never `Number()` them. Source: https://business-api.tiktok.com/portal/docs?id=1792139804568578 and the v1.2-vs-v1.3 tables on every endpoint page; envelope examples https://business-api.tiktok.com/portal/docs?id=1749734684478466.

## 1. OAuth flow
### 1.1 Advertiser authorization URL and redirect
Source: [D] https://business-api.tiktok.com/portal/docs?id=1738373141733378, https://business-api.tiktok.com/portal/docs?id=1781891256601602, FAQ https://business-api.tiktok.com/portal/docs?id=1766037914914818; [X] https://docs.markifact.com/nodes/tiktok_ads/tiktok_ads_custom_app, https://docs.zernio.com/platforms/tiktok-ads
- Official procedure: portal → My Apps → app → Basic Information → copy **Advertiser authorization URL**. Up to 10 "Advertiser redirect URL"s can be configured; a new authorization URL is generated per added redirect URL. The docs do **not** print the URL template.
- Template seen in practice: `https://business-api.tiktok.com/portal/auth?app_id=<APP_ID>&state=<STATE>&redirect_uri=<URL-ENCODED redirect>` [X Markifact full example; Zernio example `…/portal/auth?app_id=…`; StackOverflow 77566440 shows the same shape for the Accounts-API URL].
- Legacy v1.2-era form: `https://ads.tiktok.com/marketing_api/auth?app_id=&redirect_uri=&state=` [X GearPlug].
- User steps [D]: review permissions → agree → Confirm → "Send Code" e-mail verification → redirect. Verification stays valid 48 h for the same app and ad account.
- **Redirect query** [D]: official example `<redirect>?state=your_custom_params&code=3c6d…&auth_code=1234c2…&id=1701890905779201`. FAQ: callback is "appended by the authorization code, in the format `...&auth_code=`". Markifact [X]: only `auth_code` ("not `code`").
  → Parse `auth_code` first, fall back to `code`; verify `state`. The code is single-use.
- Failure modes [D FAQ]: "Redirect Url Not Match" (redirect_uri differs from the configured one); `auth_code` missing when the redirect URL itself redirects; callback must be a public address (FAQ: intranet/localhost fail; authorization page: localhost may be configured — conflicting).

### 1.2 `POST /oauth2/access_token/` (long-term token)
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739965703387137, https://business-api.tiktok.com/portal/docs?id=1738373164380162; [SDK] `python_sdk/docs/Oauth2AccessTokenBody.md`; [X] Go `model/oauth/access_token.go`.
- Header `Content-Type: application/json` (only JSON accepted).
- Body: `{"app_id":"<string>","secret":"<string>","auth_code":"<string>","return_advertiser_ids":true}`. The first three are required; `return_advertiser_ids` is an optional boolean, default `true` (false → `advertiser_ids: []`, advised for thousands of accounts).
- `auth_code` TTL: "valid for one hour, single use" [D parameter table]; FAQ error row says 10 minutes; Markifact "a few minutes" → exchange immediately.
- Response [D example]: `{"message":"OK","code":0,"data":{"access_token":"xxx","scope":[4],"advertiser_ids":["123456789","123456781"]},"request_id":"…"}`
  - `data.access_token` string; `data.advertiser_ids` string[]; `data.scope` number[] (permission IDs, §1.5). No `expires_in`, no `refresh_token`.
- Alternative `POST /oauth/token/` (JSON or form: `client_id`, `client_secret`, `code`, `grant_type="authorization_code"`) returns a **flat** body `{access_token, token_type:"Bearer", advertiser_ids, scope, code, message, request_id}` with no `data` wrapper [D]. Its doc example shows `advertiser_ids` as unquoted numbers and `scope` values > 2^53. Prefer `/oauth2/access_token/`.

### 1.3 `GET /oauth2/advertiser/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1738455508553729; [SDK] `AuthenticationApi.md`; [X] Airbyte `advertiser_ids` stream.
- Query `app_id` (string, required), `secret` (string, required); header `Access-Token` (required). No pagination parameters documented.
- Response: `data.list[]` = `{advertiser_id:string, advertiser_name:string}`.

### 1.4 Token lifetime (long-lived production tokens)
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739965703387137, https://business-api.tiktok.com/portal/docs?id=1738373164380162, https://business-api.tiktok.com/portal/docs?id=1766037914914818, https://business-api.tiktok.com/portal/docs?id=1766041812130817, https://business-api.tiktok.com/portal/docs?id=1737172488964097.
- Yes, they exist: the advertiser access token is **long-term and does not expire**.
- It dies only if the advertiser removes the authorization (https://ads.tiktok.com/ac/page/authorizations) or the developer calls `POST /oauth2/revoke_token/` (`app_id`, `secret`, `access_token` → `data{app_id,advertiser_ids}`) [D ?id=1739965949088770].
- No refresh flow: using a refresh token on it gives code 40107.
- The 1-day access token + 1-year refresh token exist only for TikTok-**account** tokens (`/tt_user/oauth2/token/`, `/tt_user/oauth2/refresh_token/`) [D]. The python-SDK docstring of `oauth2_access_token` wrongly attributes "24 h / 1 year" to this endpoint; official docs win.
- Ad accounts the authorizing user gains later are covered without re-auth [D ?id=1766041812130817].
- Lost token: docs say ask the advertiser to cancel authorization; the same `auth_code` cannot be reused.

### 1.5 Scope IDs (`scope[]`) for the endpoints below
Source: [D] https://business-api.tiktok.com/portal/docs?id=1753986142651394

| Scope ID | Name | Endpoints |
|---|---|---|
| 100 | Read Ad Account Information | `/advertiser/info/`, `/oauth2/advertiser/get/` |
| 44 (parent 4 Reporting) | Consolidated Report | `/report/integrated/get/` |
| 150 | Read Business Center | `/bc/get/`, `/bc/balance/get/`, `/bc/transaction/get/` |
| 152 | Ad Account Balance and Transaction | `/advertiser/balance/get/`, `/advertiser/transaction/get/` |
| 153 | Business Center Asset | `/bc/asset/get/`, `/bc/asset/admin/get/` |
| 157 | BC Billing Group Management | `/bc/billing_group/*` |
| 7078191955347259394 | Invoice Management | `/bc/invoice/get/`, `/bc/invoice/unpaid/get/` |
- A first-level scope (`1` Ad Account Management, `4` Reporting) covers its children. `/bc/account/transaction/get/`, `/bc/account/cost/get/`, `/payment_portfolio/*` are not in the appendix.

## 2. `GET /advertiser/info/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739593083610113, enums https://business-api.tiktok.com/portal/docs?id=1737174886619138; [SDK] `AccountManagementApi.md`; [X] Go `model/advertiser/advertiser.go`, Airbyte `advertisers` schema, Markifact.

| Param | Type | Req | Notes |
|---|---|---|---|
| `advertiser_ids` | string[] | yes | JSON-in-query. Max per call not documented (UNCONFIRMED); Airbyte batches 100. No pagination. |
| `fields` | string[] | no | Supported values below. |
- Supported `fields`: `telephone_number, contacter, currency, cellphone_number, timezone, advertiser_id, role, company, status, description, rejection_reason, address, name, language, industry, license_no, email, license_url, country, balance, create_time, display_timezone, owner_bc_id, company_name_editable, can_use_custom_identity, ads_only_mode`.
- Omitted `fields` → everything except the last three. Requesting any of the last three returns only that field + `advertiser_id`. `advertiser_account_type` is returned by default but is not in the supported list → omit `fields` if you need it.

Response `data.list[]`:
- `advertiser_id` string · `name` string · `status` string (enum below) · `role` string · `rejection_reason` string · `company` string · `industry` string code · `address` · `description`.
- `country` ISO region (`US`) · `currency` ISO 4217 · `timezone` (`Etc/GMT+8` or `Europe/London`) · `display_timezone` (Region/City) · `language`.
- `balance` **float**, total balance in account currency (e.g. `5325.43`; no breakdown) · `create_time` **epoch seconds** (e.g. `1510740064`).
- `advertiser_account_type` `RESERVATION`/`AUCTION` · `owner_bc_id` (only if you are admin of the owner BC and hold Admin/Operator/Analyst on the account through it).
- Booleans: `company_name_editable`, `can_use_custom_identity`, `ads_only_mode`. Masked strings: `contacter, email, cellphone_number, telephone_number`. `license_no`, `license_url` (valid ~1 h).
- Deprecated: `license_province, license_city, promotion_area, promotion_center_province, promotion_center_city, brand`.

**`status` enum (13, all documented)** (identical in Go `enum/advertiser_status.go` and the xmcsl.cn mirror):

| Value | Meaning |
|---|---|
| `STATUS_ENABLE` | approved |
| `STATUS_DISABLE` | ad account closed |
| `STATUS_PENDING_CONFIRM` | application pending review |
| `STATUS_PENDING_VERIFIED` | pending verification |
| `STATUS_CONFIRM_FAIL` | review failed |
| `STATUS_CONFIRM_FAIL_END` | CRM-system review failed |
| `STATUS_PENDING_CONFIRM_MODIFY` | modifications pending review |
| `STATUS_CONFIRM_MODIFY_FAIL` | review of modifications failed |
| `STATUS_LIMIT` | ad account under punishment |
| `STATUS_WAIT_FOR_BPM_AUDIT` | pending CRM-system review |
| `STATUS_WAIT_FOR_PUBLIC_AUTH` | pending corporate bank-account authentication |
| `STATUS_SELF_SERVICE_UNAUDITED` | pending qualification verification (self-service account) |
| `STATUS_CONTRACT_PENDING` | contract not yet in effect |
- `role`: `ROLE_ADVERTISER` (direct), `ROLE_CHILD_ADVERTISER` (agency sub-account), `ROLE_CHILD_AGENT` (secondary agency), `ROLE_AGENT` (primary agency).
- Display status (used as `advertiser_status` in balance/BC filters): `SHOW_ACCOUNT_STATUS_NOT_APPROVED`, `SHOW_ACCOUNT_STATUS_APPROVED`, `SHOW_ACCOUNT_STATUS_IN_REVIEW`, `SHOW_ACCOUNT_STATUS_PUNISHED`.

## 3. Business Center listing
### 3.1 `GET /bc/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1737115687501826; [SDK] `bc_api.py`, `yml_files/bc_get.yml`; [X] Go `model/bc/get.go`.
- Params: `bc_id` string optional (omit → all BCs of the user), `page`, `page_size` (1–50, default 10). SDK-only, undocumented in English docs (UNCONFIRMED): `scene` (schema default `SINGLE_ACCOUNT`), `filtering{keyword,keyword_type,relation_type}`.
- Response `data.list[]`: `bc_info{bc_id, name, company, currency, registered_area, status, timezone, type, verification_status}`, `user_role`, `ext_user_role{finance_role}`; plus `data.page_info`. (`organization_type` and `parent_bc` appear only in the doc example.)
- Enums: `user_role` `ADMIN`/`STANDARD`; `finance_role` `MANAGER`/`ANALYST` (gates payment/invoice endpoints); BC `status` `REVIEWING`/`DENY`/`ENABLE`/`PUNISH`; `type` `NORMAL`/`DIRECT`/`AGENCY`/`SELF_SERVICE`/`SELF_SERVICE_AGENCY`; `verification_status` `NOT_SUBMITTED`/`REVIEWING`/`VERIFIED`/`FAILED`/`EXPIRED`.

### 3.2 `GET /bc/asset/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739432717798401; [SDK] `FilteringBcAssetGet.md`; [X] Go `model/bc/asset_get.go`.
- Params: `bc_id` string **required**; `asset_type` **required** (`ADVERTISER, CATALOG, TIKTOK_SHOP, PIXEL, LEAD, TT_ACCOUNT, MANAGED_BUSINESS_ACCOUNT`); `filtering{user_id | user_email (mutually exclusive), keyword}`; `page`; `page_size` 1–50. SDK-only: `child_bc_id`.
- **Default filter**: with no filter values the server uses the user that granted the `auth_code`, so you get that user's assets, not the whole BC.
- Response `data.list[]`: `asset_type`, `asset_id` (= advertiser id for ADVERTISER), `asset_name`, `advertiser_account_type`, `advertiser_role` (`ADMIN`/`OPERATOR`/`ANALYST`, non-null for ADVERTISER), `owner_bc_name` (name only, no id), plus type-specific `catalog_role, store_role, tt_account_roles[], business_account_roles[], is_business_verified, operating_region_code, tt_asset_handle, tt_asset_profile_image, ad_creation_eligible`.
- **No `advertiser_status` and no relation fields are documented for this endpoint** (Go reuses one struct for both asset endpoints; do not infer).

### 3.3 `GET /bc/asset/admin/get/` — the documented way to list a BC's ad accounts WITH status
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739433007779841; [SDK] `FilteringBcAssetAdminGet.md`; [X] Go `model/bc/asset_admin_get.go`.
- Requires BC **Admin**. Params: `bc_id`, `asset_type` (use `ADVERTISER`), `filtering{advertiser_show_status (SHOW_ACCOUNT_STATUS_*), relation_type, relation_status}` (+ `keyword` in the SDK model only), `page`, `page_size` 1–50.
- Response `data.list[]`: `asset_type`, `asset_id`, `asset_name`, **`advertiser_status`** (the 13 `STATUS_*` values; doc example shows `STATUS_ENABLE` and `STATUS_LIMIT`), `advertiser_account_type`, `advertiser_role`, `relation_type`, `relation_status`, `owner_bc_name`, `pixel_code`; `data.page_info`.
- `relation_type`: `OWNER_BC`, `OWNER_PARTNER`, `OWNER_INDIVIDUAL`. `relation_status`: `BOUND`, `UNBOUND`, `PENDING`, `REJECTED`.
- There is no `/bc/advertiser/get`-style listing in docs or SDK (`/bc/advertiser/attribute/` returns only currency/region lists, ?id=1775752357139457). Alternatives: `/advertiser/balance/get/` (display status + balances, §4.1) or the BC-report filter `account_status` (§5.5).

## 4. Balances, billing, payments
### 4.1 `GET /advertiser/balance/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739939106470913; [SDK] `bc_api.py`; [X] Go `model/bc/advertiser_balance_get.go`.
- Only ad accounts the BC has **admin** rights over. The page note limits payment operations to Finance Manager/Analyst users; the error code when lacking the role is not documented (UNCONFIRMED).
- Params: `bc_id` **required**; `fields` string[]; `filtering{keyword (name or id), advertiser_status: string[] of SHOW_ACCOUNT_STATUS_*, payment_portfolio_id}`; `page`; `page_size` 1–50 (default 10).
- `fields` extras (off by default): `budget_remaining, budget_frequency_restriction, budget_amount_restriction, min_transferable_amount, max_transferable_amount, balance_info`. The doc says to request them with `page_size=1`.

Response `data.advertiser_account_list[]` (+ `data.page_info`):
- Identity: `advertiser_id`, `advertiser_name`, `advertiser_status` (documented as display status; doc example shows `null`), `advertiser_type` (`AUCTION`/`RESERVATION`), `timezone`, `currency`, `account_open_days`, `company`, `contact_name`, `contact_email`, `create_time` (string `YYYY-MM-DD HH:MM:SS`, UTC+0).
- `balance_reminder` boolean (a low-balance flag — not the threshold value).
- **Numbers, two decimals, in the account's `currency`**: `account_balance` (= valid + frozen + tax), `valid_account_balance`, `frozen_balance`, `tax`, `cash_balance`, `valid_cash_balance`, `grant_balance` (voucher), `valid_grant_balance`.
- Budget: `budget_mode` (`UNLIMITED`, `MONTHLY_BUDGET`, `DAILY_BUDGET`, `CUSTOM_BUDGET`), `budget`, `budget_cost`, `budget_remaining`.
- `transferable_amount` (only when `total_number` is 1); `min_transferable_amount{cash_amount,grant_amount,credit_amount}` (only with `page_size`=1); `max_transferable_amount{cash_amount,grant_amount}`.
- `balance_info{account_balance, frozen_balance, valid_account_balance, tax, cash_balance, frozen_cash_balance, cash_tax, valid_cash_balance, grant_balance, valid_grant_balance, frozen_grant_balance, credit_balance, valid_credit_balance, frozen_credit_balance}`.
- Payment Portfolio BCs only: `payment_portfolio_id` (documented as **number**), `payment_portfolio_name`, `payment_portfolio_type` (`SHARED`/`NON_SHARED`). For those BCs the balance/tax/frozen/cash fields describe the **portfolio**, not the account.
- Deprecated: `first_recharge_amount, first_recharge_time, latest_recharge_time, recharge_amount, recharge_count`.

### 4.2 `GET /bc/balance/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1739939128198145; [X] Go `model/bc/balance_get.go`.
- Params: `bc_id` required, `payment_portfolio_id` optional (SDK-only `child_bc_id`).
- Response `data{bc_id, currency, account_balance, valid_account_balance, frozen_balance, tax, cash_balance, valid_cash_balance, grant_balance, valid_grant_balance, payment_portfolio_type}`: numbers, 2 decimals, BC currency; with Payment Portfolio enabled they are the portfolio's. The doc's JSON example is an empty `data:{}`.

### 4.3 Amounts charged / paid
**`GET /bc/account/transaction/get/`** (preferred; [D] https://business-api.tiktok.com/portal/docs?id=1792849810925569; [SDK] `FilteringBcAccountTransactionGet.md`; [X] Go `account_transaction_get.go`)
- Params: `bc_id` required; `transaction_level` (`BC`/`ADVERTISER`/`PAYMENT_PORTFOLIO`, default ADVERTISER); `page`; `page_size` 1–50.
- `filtering{transaction_types[], owner_of_account[], account_ids[] (max 100), account_name, start_time, end_time, billing_types[] (CASH/CREDIT)}`; times are `YYYY-MM-DD HH:MM:SS`, range ≤365 days, default last 90 days.
- Needs BC finance role (read `ext_user_role.finance_role` from `/bc/get/`).
- Response `data.transaction_list[]` (Go SDK tags it `transaction`; docs table and example agree on `transaction_list`): `transaction_id, payment_portfolio_id, payment_portfolio_name, account_id, account_name, bc_id, bc_name, amount (incl. tax), subtotal, tax_amount, currency, amount_type (POSITIVE/NEGATIVE/OTHER), transaction_type, billing_type, timezone ("UTC+07:00"), create_time, invoice_id, serial_number`; `data.page_info`.
- `transaction_type` (13): `BILL_PAYMENT, ADD_BALANCE, CANCELLATION, PROMOTION_ISSUED, PROMOTION_EXPIRED, INCREASE_BALANCE, DECREASE_BALANCE, CARD_VERIFICATION, CARD_VERIFICATION_REFUND, ORDER_CREATION_PAYMENT, ORDER_EDIT_PAYMENT, RETURN_OF_REMAINING_BUDGET, REFUND`.

**`GET /advertiser/transaction/get/`** ([D] https://business-api.tiktok.com/portal/docs?id=1739939116353538)
- `bc_id` (BC `type` must not be `NORMAL`); `filtering{transfer_type (TRANS_TYPE_TRANSFER/TAX/COST/PAYMENT), funds_type[] (FUNDS_TYPE_CASH/GRANT), summary_by_account, keyword, start_date, end_date}`; dates `YYYY-MM-DD` UTC+0, default 90 days, max 1 year.
- Response `data.transaction_list[]{advertiser_id, advertiser_name, amount, currency, date, funds_type, transfer_type, timezone}`. The response-side TAX/COST descriptions are swapped in the doc (typo).

**`GET /bc/transaction/get/`** ([D] https://business-api.tiktok.com/portal/docs?id=1739939140408322)
- `bc_id`, `filtering{funds_type[]}`, top-level `start_date`, `end_date` (`YYYY-MM-DD`, default 90 days → today), `page`, `page_size`.
- Response `data.list[]{date:number, amount, timezone, currency, funds_type, invoice_id, invoice_serial_number}`, `data.transaction_summary{amount_charged, amount_paid, currency}`, `data.page_info`.

**`GET /bc/account/cost/get/`** ([D] https://business-api.tiktok.com/portal/docs?id=1829079287639041)
- `bc_id`, `filtering{keyword, start_date, end_date}` (default 90 days, ≤365). Response `data.cost_list[]{advertiser_id, advertiser_name, amount, cash_amount, grant_amount, tax_amount, currency}` (costs are **negative**, e.g. -1376616), `data.transaction_summary`, `data.page_info`.
- Budget history: `GET /bc/account/budget/changelog/get/` (?id=1830173979548674; `bc_id`, `advertiser_id`).

**Invoices**
- `GET /bc/invoice/unpaid/get/` ([D] https://business-api.tiktok.com/portal/docs?id=1740295904843777): `bc_id` and `invoice_type=RECON`, both required → `data.result{currency_code, amount}`.
- `GET /bc/invoice/get/` ([D] https://business-api.tiktok.com/portal/docs?id=1740295890332674): `bc_id`, `invoice_types[]` (required; `RECON`, `CREDIT`, `AUTO_PAY` — AUTO_PAY only alone), optional `invoice_id, invoice_title, pay_statuses[] (UNPAID, PAID, PARTIAL_PAID, NO_NEED), start_time, end_time` (both or neither), `page`, `page_size`.
- Response `data.list[]{invoice_id, serial_number, send_date, currency_code, status (CREATED/SUBMITTED/APPROVED/DELETED), due_date, invoice_type, billing_group_id, account_name, invoice_title, amount, amount_excluding_tax, total_tax_amount, tax_type1/2, tax_rate1/2, tax_amount1/2, pay_status, overdue_status (INITIALIZED/YES/NO), unpaid_amount, …}`.
- Billing groups `GET /bc/billing_group/get/` ([D] https://business-api.tiktok.com/portal/docs?id=1738944324279297): `list[]{billing_group_id, billing_group_name, status (VALID/INVALID), is_primary, advertisers[], billing_group_emails[], invoice_group_by, billed_to_type, billing_group_type}` — invoice grouping only.

**Payment Portfolios** — `GET /payment_portfolio/get/` ([D] https://business-api.tiktok.com/portal/docs?id=1839151931301954, overview https://business-api.tiktok.com/portal/docs?id=1839151483689986)
- **Allowlist-only** ("multiple Payment Portfolios" feature). Params: `bc_id` required, `filtering{payment_portfolio_ids[] (max 10), payment_portfolio_type, bc_related}`, `page`, `page_size`.
- Entry: `payment_portfolio_id, payment_portfolio_name, payment_portfolio_type, linked_advertiser_account_count, user_count, cash_balance_list[{currency,amount}], credit_line_allocation{allocated_amount, used_amount, available_amount, min_allocation_percentage}`.
- List key: table says `data.payment_portfolio_list`, example says `data.payment_portfolios` → read both. Related: `/payment_portfolio/advertiser/get/` (`advertiser_list[]`), `/payment_portfolio/user/get/` (`users[]`).

### 4.4 Card / payment method / charge threshold — NOT exposed
Source: [D] doc tree + full-text search (`GET https://business-api.tiktok.com/gateway/api/doc/client/search/?identify_key=<v1.3 key>&language=ENGLISH&keyword=…`), https://business-api.tiktok.com/portal/docs?id=1754705321657346, https://business-api.tiktok.com/portal/docs?id=1839151483689986
- No documented endpoint or field returns card presence, payment-method type, or a billing/charge threshold. Checked: the full doc tree (16 top-level sections) and the portal full-text search for "credit card", "payment method", "threshold", "prepaid", "postpaid" (no hits or prose/unrelated hits only).
- Indirect signals only: `CARD_VERIFICATION`/`CARD_VERIFICATION_REFUND` rows in `/bc/account/transaction/get/`; `AUTO_PAY` invoices in `/bc/invoice/get/`; `balance_reminder`; `payment_portfolio_type`; `credit_line_allocation`.
- Balance Sharing exists only for BCs on "Monthly Invoicing" (?id=1754705321657346), but no field names the BC's payment method.

## 5. `GET /report/integrated/get/`
Source: [D] https://business-api.tiktok.com/portal/docs?id=1740302848100353; guides https://business-api.tiktok.com/portal/docs?id=1738864778664961 (how-to), 1751443956638721 (dimensions), 1751443967255553 (metrics), 1751443975608321 (filters), 1738864817670145 (timeouts), 1738864894606337 (latency), 1738864850353154 (FAQ); [SDK] `ReportingApi.md`, `yml_files/report_integrated_get.yml`; [X] Airbyte manifest, Go `model/report/integrated_get.go`.
### 5.1 Request

| Param | Type | Notes |
|---|---|---|
| `report_type` | string, **required** | `BASIC`, `AUDIENCE`, `PLAYABLE_MATERIAL`, `CATALOG`, `BC`, `TT_SHOP` (to be deprecated) |
| `service_type` | string | `AUCTION` (default); `RESERVATION` deprecated. A mismatch with the account type returns an **empty list**. |
| `data_level` | string | Required for BASIC/AUDIENCE/CATALOG: `AUCTION_ADVERTISER`, `AUCTION_CAMPAIGN`, `AUCTION_ADGROUP`, `AUCTION_AD` (`RESERVATION_*` deprecated). Must match `dimensions` (campaign level needs `campaign_id`). AUCTION_ADVERTISER covers all auction + reservation ads. |
| `advertiser_id` / `advertiser_ids` | string / string[] | One is required for BASIC/AUDIENCE. `advertiser_ids`: **max 5**, BASIC/AUDIENCE only, same TikTok for Business user; if both are sent `advertiser_id` is ignored. |
| `bc_id` | string | For `report_type=BC`. |
| `dimensions` | string[], **required** | e.g. `["advertiser_id"]`, `["advertiser_id","stat_time_day"]`. At most one ID dimension (`advertiser_id/campaign_id/adgroup_id/ad_id/ad_id_v2`) and/or one time dimension (`stat_time_day/stat_time_hour`). |
| `metrics` | string[] | Default `["spend","impressions"]`. |
| `start_date`, `end_date` | `YYYY-MM-DD` | Closed interval in the **ad-account time zone**; required unless `query_lifetime=true`. Max 365 days; with `stat_time_day` 30 days; with `stat_time_hour` 1 day; BC reports 365. Advice [D]: ≤7-day windows and ≤100 metrics avoid timeouts. |
| `query_lifetime` | boolean | BASIC/PLAYABLE_MATERIAL, default false. Lifetime metrics with the same names; dates ignored; no time/audience/country breakdown. Airbyte uses AUCTION_ADVERTISER + `["advertiser_id"]` + `true`. |
| `filtering` | object[] | `{field_name, filter_type, filter_value}`; types `IN`, `NOT_IN`, `CONTAIN_ANY_OF` (value = JSON-array string), `MATCH`, `GREATER_EQUAL`, `GREATER_THAN`, `LOWER_EQUAL`, `LOWER_THAN`, `BETWEEN` (array of exactly 2 strings). |
| `order_field`, `order_type` | string | `order_type` `ASC`/`DESC` (default DESC). |
| `enable_total_metrics`, `multi_adv_report_in_utc_time` | boolean | `total_metrics` needs one ID dim and/or `stat_time_day`; UTC flag applies with `advertiser_ids`. |
| `page`, `page_size` | number | `page` default 1; `page_size` 1–**1000**, default 10. `query_mode` `REGULAR`/`CHUNK` (CHUNK being deprecated). |
- With `advertiser_ids`, metrics also carry `advertiser_id`, `timezone`, `currency`; you **must include `advertiser_id` in `dimensions`**, otherwise those come back as `0` and cost metrics as `-`.
- BASIC filter names: `campaign_ids, adgroup_ids, ad_ids, ad_ids_v2` (≤100 IDs; campaign ids ≤30 per the timeout guide), `campaign_status/adgroup_status/ad_status` (default `STATUS_NOT_DELETE`; include deleted with `[{"field_name":"ad_status","filter_type":"IN","filter_value":"[\"STATUS_ALL\"]"}]`), `objective_type, buying_type, create_time`, … Not needed at advertiser level.

### 5.2 Metrics (BASIC; all values are **strings**; `-` = no data/meaningless)
Source: [D] https://business-api.tiktok.com/portal/docs?id=1751443967255553 (metrics), https://business-api.tiktok.com/portal/docs?id=1751443956638721 (dimensions), https://business-api.tiktok.com/portal/docs?id=1751443975608321 (filters); [X] Airbyte `manifest.yaml`.
- `spend` (cost, account currency) · `impressions` · `clicks` (destination) · `ctr` (percentage) · `cpc` · `cpm` · `reach` · `frequency` · `conversion` · `cost_per_conversion` · `conversion_rate` · `result` · `cost_per_result`.
- `cash_spend`, `voucher_spend`: advertiser level only, no lifetime/hourly, 24–48 h lag. `billed_cost`: sync only, up to 11 h lag.
- Attribute metrics: `advertiser_name`, `advertiser_id`, `campaign_name`, …. `currency` as a metric requires an ID dimension (`advertiser_id/campaign_id/adgroup_id/ad_id`).
- Airbyte [X] requests `spend, cpc, cpm, impressions, clicks, ctr, reach, frequency, conversion, cost_per_conversion, conversion_rate, result, cost_per_result` + `cash_spend, voucher_spend` at AUCTION_ADVERTISER.

### 5.3 Response
- `data.list[]{dimensions:{advertiser_id, …, stat_time_day:"2020-01-01 00:00:00"}, metrics:{spend:"123.45", …}}`; `data.page_info{page,page_size,total_number,total_page}`; optional `data.total_metrics`.
- Response header `X-Tt-Ads-Throttle` = 20,000-ad truncation warning (NOT a rate limit): sync reports process only the newest 20,000 ads.
- No data is `list: []` or zeros — both mean "no data" (FAQ). Latency: real-time metrics ~30 min (can reach 2 h+); pull T-1 after 08:00 UTC for accurate data (daily fix script); audience data 10–12 h.

### 5.4 Illustrative request (assembled from the rules above, not a copied sample)
`GET /open_api/v1.3/report/integrated/get/?advertiser_id=123&service_type=AUCTION&report_type=BASIC&data_level=AUCTION_ADVERTISER&dimensions=%5B%22advertiser_id%22%5D&metrics=%5B%22spend%22%2C%22impressions%22%2C%22clicks%22%2C%22ctr%22%2C%22cpc%22%2C%22cpm%22%2C%22conversion%22%2C%22cost_per_conversion%22%2C%22currency%22%5D&start_date=2026-10-01&end_date=2026-10-28&page_size=1000`

### 5.5 BC report (one call for all ad accounts of a BC)
Source: [D] https://business-api.tiktok.com/portal/docs?id=1775747432712194 (overview), https://business-api.tiktok.com/portal/docs?id=1775747465089026 (dimensions), https://business-api.tiktok.com/portal/docs?id=1775747476019266 (metrics), https://business-api.tiktok.com/portal/docs?id=1775747484045313 (filters)
- `report_type=BC` + `bc_id`; no `data_level`/`service_type`; `dimensions` one of `["advertiser_id"]`, `["stat_time_day"]` (or `_week`/`_month`), `["advertiser_id","placement"]`, `["advertiser_id","country_code"]`; ≤365 days; no lifetime; `page_size` ≤1000.
- Metrics: `advertiser_name, timezone, currency, spend, billed_cost, cash_spend, voucher_spend, tax_spend, cpc, cpm, impressions, clicks, ctr, conversion, cost_per_conversion, reach`.
- Filters (AND): `advertiser_name` MATCH, `advertiser_id` IN, `registered_area`, `owner_of_account`, `currency_of_account`, `cost` (USD), `account_status` IN (`APPROVED`, `NOT_APPROVED`, `IN_REVIEW`, `SUSPENDED`, `DISABLED`, `CONTRACT_INACTIVE`) — a filter only, no per-row status.

## 6. Errors, rate limits, backoff
Source: [D] https://business-api.tiktok.com/portal/docs?id=1737172488964097 (codes), https://business-api.tiktok.com/portal/docs?id=1749734684478466 (HTTP), https://business-api.tiktok.com/portal/docs?id=1740029171730433 (limits); [X] Airbyte `requester.error_handler`; [LIVE].
- HTTP 200 + `code≠0` = failure; HTTP 4xx = wrong path/method; HTTP 5xx → docs: wait ~5 min and retry.
- **Rate limit codes**: `40100` (app-level), `40016` (endpoint, app-level), `40133` (advertiser-level QPS; "Advertiser (id)'s QPS (n) reaches QPS limit m for current path").
- App-level tiers (per developer app, per endpoint): Basic (default) **10 QPS / 600 QPM / 864,000 QPD**; Advanced 20/1,200/1,728,000; Premium 30/1,800/2,592,000; Ultimate 50/3,000/4,320,000; raised one level at a time via My Apps.
- Docs backoff: QPM hit → wait **5 minutes**; QPD hit → wait until 00:00:00 UTC. The sync report has no endpoint-specific limit listed (async create has its own, 4,500 tasks/day).
- Airbyte [X]: 40016/40100/40133 = rate limited, constant 60 s backoff, 9 retries; retries 60001, 50000, 51001, 51002, 51004, 51041, 51043; fails 40001; ignores 40002 per resource.
- **Token/auth**: `40104` empty token [LIVE "The access_token is empty."] · `40105` invalid/revoked token [LIVE "Access token is incorrect or has been revoked."] · `40102` expired · `40106` invalid core user (token not valid for that `advertiser_id`) · `40101`/`40110`/`40115` bad, used or expired `auth_code` / mismatched app_id+secret · `40113` app blocked or app_id/secret wrong · `40107` refresh-token misuse · `40118` not on allowlist · `40119` developer and advertiser not in the same company · `40125` developer lacks permission.
- **Permission/object**: `40001` no permission for the operation (FAQ messages: "You don't have permission to operate advertiser xxxx", "Advertiser does not grant you the permission for xxx", "Insufficient advertiser permission: Please ask the BC admin…"; "No access to operation advertiser xxx" = token does not match the advertiser) · `40007` object missing · `40300` advertiser missing/deleted · `40301` advertiser cannot be matched.
- **Parameters**: `40002` parameter error (missing/invalid/unsupported fields; also returned for a bad `app_id`/`secret` on `/oauth2/access_token/` [LIVE "The app_id does not exist or the secret key provided is incorrect…"]) · `40000` invalid parameters · `40011` too many IDs · `40006`/`40051` API version problems.
- **Transient**: `50000`, `50002`, `51xxx`, `60001` (maintenance, retry); `41000` banned-country IP.

## 7. UNCONFIRMED (not provable from docs, SDK, consumers or live probes)
1. Exact `portal/auth` URL template: not in official docs (copy it from My Apps); only community use confirms it.
2. Whether the callback carries both `auth_code` and `code` with identical values (official example shows both, different; Markifact says only `auth_code`).
3. `auth_code` TTL: 1 h (parameter docs) vs 10 min (FAQ error table) vs "a few minutes" (Markifact).
4. Whether `https://<ext-id>.chromiumapp.org/` is accepted as `redirect_uri` (docs conflict on localhost/intranet).
5. Whether re-authorizing / re-exchanging invalidates the previous token (FAQ error text: "when you call access_token or refresh_token api, old token will become invalid").
6. Max `advertiser_ids` for `/advertiser/info/`; whether `/oauth2/advertiser/get/` paginates.
7. `/bc/get/` `scene` and `filtering`, and `child_bc_id` on BC endpoints (SDK schema only).
8. Whether `/bc/asset/get/` (non-admin) ever returns `advertiser_status`.
9. Finance-role requirement and error code for `/advertiser/balance/get/` and `/bc/balance/get/`; required scope for `/bc/account/*` and `/payment_portfolio/*`.
10. `advertiser_status` enum on `/advertiser/balance/get/` (docs: SHOW_ACCOUNT_STATUS_*; Go types it as STATUS_*; example `null`) — accept both.
11. Payment Portfolio list key (`payment_portfolio_list` vs `payment_portfolios`); `payment_portfolio_id` type (number in balance doc, string elsewhere); `transaction_list` vs Go `transaction`.
12. Whether `balance_info` / `max_transferable_amount` / budget extras work with `page_size` > 1.
13. Whether `conversion` / `cost_per_conversion` return real values or `-` at AUCTION_ADVERTISER; exact scale of `ctr` / `conversion_rate` (docs say "percentage").
14. Meaning of code 40067 (Airbyte splits the date window on it; not in the official table); the advertiser-level QPS number behind 40133.
15. Success payloads were NOT observed live (no valid token); all success shapes come from docs/SDK. Only error envelopes were probed live.
16. CORS for browser pages (irrelevant for an MV3 service worker with `host_permissions: ["https://business-api.tiktok.com/*"]` — Chrome behaviour, not TikTok-documented).

## 8. Gotchas
- IDs are strings; some doc examples show numeric IDs (`/oauth/token/`, `payment_portfolio_id`) — parse defensively (reviver/regex) to avoid 2^53 precision loss.
- Query encoding: strings raw, everything else JSON; `filter_value` is a string containing JSON; no GET bodies in `fetch`; keep the trailing `/`.
- The body `code`, not the HTTP status, decides success; errors may lack `data`.
- Amount units: major currency units in the ad account's own `currency`; balance docs say "two decimal places", while the precision appendix (?id=1772544628718594) lists 0 decimals for VND/IDR/JPY/KRW/… and 3 for KWD/JOD/IQD/LYD/TND (whether it applies to balances is UNCONFIRMED; transaction examples show VND as `280000`). Never add amounts across currencies; the BC-report `cost` filter is USD. Cost records are negative. Balance `account_balance = valid + frozen + tax`; Payment Portfolio BCs return portfolio-level balances.
- `advertiser_status` means different enums: `STATUS_*` (info, asset/admin), `SHOW_ACCOUNT_STATUS_*` (balance, BC filters), `APPROVED…CONTRACT_INACTIVE` (BC-report filter).
- `timezone` like `Etc/GMT+8` is POSIX-inverted (= UTC−8). Report dates use the account time zone; balance `create_time` is UTC+0; transaction times carry their own `timezone`.
- `/bc/asset/get/` defaults to the authorizing user's assets; `/bc/asset/admin/get/` (BC Admin) lists the BC.
- Reports: metrics are strings (`-` / `[]` = no data); status filters hide deleted objects by default; advertiser-level data needs `advertiser_id` in `dimensions`; ≤5 advertisers per call; 30-day cap with `stat_time_day`; do not retry timeouts unchanged.
- Token model: long-term, non-expiring, no refresh token. Token exchange and `/oauth2/advertiser/get/` need the app `secret`, which cannot stay secret inside an extension (use a backend exchange or user-supplied app credentials). Rate limits are per **developer app** per endpoint (Basic 10 QPS), shared by every user of that app.
- Suggested client policy (derived, not documented): serialize requests (≤ ~5 QPS), retry `40016/40100/40133/50000/60001` with exponential backoff + jitter (≥60 s after repeated hits, 5 min if a minute-quota is suspected), never retry `4010x/40001/40002`.

## 9. Verification notes
- Official English docs were read via `GET https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=<ID>&language=ENGLISH` (v1.3 key; tree via `/platform/tree/get/`, full-text search via `/search/?keyword=`). The portal itself is client-rendered.
- Local copies: `/tmp/core-scratch/docs/<ID>.md` (raw), `/tmp/core-sdk` (SDK clone), `/tmp/core-scratch/bububa/` (Go models), `/tmp/core-scratch/airbyte_manifest.yaml`.
- Cross-checks: SDK python + yml, Airbyte `manifest.yaml`/`components.py`, bububa Go v1.5.7, Markifact, Zernio (only the `portal/auth` example).
- Live probes (dummy credentials only): `/advertiser/info/` (no and invalid token), `/report/integrated/get/` (invalid token), `/oauth2/access_token/` (dummy creds), no-trailing-slash path.
