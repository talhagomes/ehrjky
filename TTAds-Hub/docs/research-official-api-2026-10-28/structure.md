# TikTok Marketing API v1.3 — copying campaigns + ad groups between ad accounts: verified contracts

_Researched 2026-10-28 (UTC). Base `https://business-api.tiktok.com/open_api/v1.3/`, header `Access-Token`. **No call was made against a live ad account (no token)** — everything below comes from SDK/doc text; anything I could not verify is marked **UNCONFIRMED** and collected in §H._

Source codes: **S** = tiktok/tiktok-business-api-sdk 0.1.8 generated models (names, types, required flags; no descriptions) · **D** = official docs (portal doc ids in §G) · **A** = Airbyte source-tiktok-marketing manifest (GET side) · **G** = official guide example · **Z** = docs.zernio.com · **M** = channel47/mcps TikTok reference.

## 0. Read first

1. **Manual-flow sunset (D, site banner on several business-api.tiktok.com pages).** "Starting January 1, 2027, /campaign/create/, /campaign/copy/task/create/, /adgroup/create/, /ad/create/, and /ad/aco/create/ will no longer support creating or copying non-Search Legacy Manual Flow campaigns, or creating ad groups or ads under them, for Sales, App Promotion, and Lead Generation objectives. Please migrate affected workflows to the Upgraded Smart+ APIs as soon as possible." The portal's notification feed (`GET https://business-api.tiktok.com/marketing_api/api/common/notification/list/`) independently lists banner key `manual_flow_sunset`, active 2026-09-12 → 2027-03-31. ⇒ copying a `WEB_CONVERSIONS` (Sales) campaign through these endpoints stops working on 2027-01-01. TRAFFIC is not named in the banner, but the Upgraded-Smart+ page (id 1853452461203458) says "After December 31, 2026, you will no longer have the ability to create Manual Campaigns using /campaign/create/" ⇒ TRAFFIC is at risk too (UNCONFIRMED). Legacy Smart+ creation (`/campaign/spc/create/`) was scheduled to end 2026-03-31 (already past).
2. **An official copy API exists but cannot cross accounts (D 1788434394151938).** `POST /campaign/copy/task/create/` (+ `/campaign/copy/task/check/`) duplicates a manual campaign with its ad groups and ads; allowlist-only; params `advertiser_id`, `campaign_id`, `request_id` (required) + optional `operation_status`, `campaign_name`, `budget`, `schedule_*`, `deep_copy_mode` DEFAULT/CUSTOM, `adgroup_list`… There is **no target-advertiser parameter** in its parameter table (89 rows incl. nested); source campaign needs 1–20 undeleted ad groups with 1–50 ads each; 1 QPS / 30 QPM. ⇒ cross-account copy = GET → create (what Zernio also does, "manual graph walk", everything created paused — Z).
3. **GET and create use identical field names in v1.3**: every documented create field except `request_id` is returned by GET under the same name (113 overlapping ad group fields, 29 campaign fields). v1.2 names are gone: `location`→`location_ids`, `placement`→`placements`, `age`→`age_groups`, `operation_system`→`operating_systems`, `pangle_block_app_list_id`→`blocked_pangle_app_ids`, `optimize_goal`→`optimization_goal`, `bid`→`bid_price`, `conversion_bid`→`conversion_bid_price`, `opt_status`→`operation_status`… **`landing_page_url` and `vta_window` are NOT ad group fields** (landing page is ad-level; attribution = `click_/view_/engaged_view_attribution_window`).
4. v2.0 exists, but its API reference currently documents only Reporting (D about-the-guide/2.0); campaign management stays v1.3.

## 1. Conventions (S, D, M)
- Envelope: HTTP 200 with `{code, message, request_id, data}`; `code 0` = success, non-zero = error even on HTTP 200. POST bodies are JSON (`Content-Type: application/json`).
- GET: complex params are **JSON-encoded then URL-encoded** in the query string: `fields=["campaign_id","campaign_name"]`, `filtering={"campaign_ids":["123"],"primary_status":"STATUS_NOT_DELETE"}` (SDK `api_client.parameters_to_tuples` does `json.dumps`; D curl examples; A passes `filtering` as a stringified object; M states it).
- v1.3 IDs are **strings** (advertiser_id, campaign_id, adgroup_id, pixel_id, app_id, location_ids… — v1.2 used numbers). Treat as opaque; never parse into JS `Number`. (The status-update doc example shows numeric ids `[11,22]` while its table says `string[]` — parse defensively.)
- Money = major units of the advertiser currency (M, D). Times: `schedule_*` and `creation_filter_*` are "YYYY-MM-DD HH:MM:SS" **UTC+0** (D); advertiser zone/currency come from `GET /advertiser/info/?advertiser_ids=["id"]&fields=["currency","timezone","status","country"]` (D 1739593083610113).

## A. GET /campaign/get/ and GET /adgroup/get/
Query params (both): `advertiser_id` (req.), `fields` (string[] JSON; default all; names = keys of `data.list[]`), `exclude_field_types_in_response` (string[]; only `NULL_FIELD`, drops null-valued keys — handy before copying), `filtering` (object), `page` (default 1, ≥1), `page_size` (default 10, **1–1000**; ad groups: ≤100 when `buying_types=["RESERVATION_TOP_VIEW"]`). Response: `data.list[]` (sorted by id desc), `data.page_info {page, page_size, total_number, total_page}`.

`filtering` keys:
- **campaign** (D): `campaign_automation_type` (MANUAL/SMART_PLUS/UPGRADED_SMART_PLUS), `campaign_ids` (≤100), `campaign_name` (fuzzy), `campaign_system_origins` (PROMOTE/TT_ADS_PLATFORM; default `["TT_ADS_PLATFORM"]`), `primary_status`, `secondary_status` (CAMPAIGN_STATUS_*), `objective_type`, `sales_destination`, `buying_types` (AUCTION/RESERVATION_RF/RESERVATION_TOP_VIEW; default `["AUCTION","RESERVATION_RF"]`, TOP_VIEW cannot be combined), `is_smart_performance_campaign`, `creative_campaign_type` (SPC/SEARCH_CAMPAIGN/OTHER)[], `split_test_enabled`, `campaign_product_source`, `optimization_goal`, `campaign_type`, `creation_filter_start_time`/`_end_time`, `gmv_max_promotion_types`, `store_ids`. SDK `FilteringCampaignGet` lacks `campaign_automation_type`, `gmv_max_promotion_types`, `store_ids` (SDK older than docs) ⇒ use raw HTTP.
- **ad group** (D): `campaign_automation_type`, `campaign_ids` (≤100), `campaign_system_origins`, `adgroup_ids` (≤100), `adgroup_name`, `primary_status` (**default STATUS_NOT_DELETE**; STATUS_ALL includes deleted), `secondary_status` (ADGROUP_STATUS_*; A uses ADGROUP_STATUS_ALL / CAMPAIGN_STATUS_ALL to include deleted), `objective_type` (WEB_CONVERSIONS also matches CONVERSIONS), `buying_types`, `optimization_goal`, `promotion_type`, `bid_strategy` (BID_STRATEGY_COST_CAP/_BID_CAP/_MAX_CONVERSION/_LOWEST_COST), `creative_material_mode` (CUSTOM/SMART_CREATIVE), `billing_events`[], `creation_filter_*`, `split_test_enabled`. Product/LIVE GMV-Max ad groups are excluded from /adgroup/get/.
- Campaign `primary_status` default is undocumented ⇒ always pass `STATUS_NOT_DELETE` (what the official copy guide does).

```
GET /campaign/get/?advertiser_id=ID&filtering={"primary_status":"STATUS_NOT_DELETE","objective_type":"TRAFFIC"}&page=1&page_size=1000
GET /adgroup/get/?advertiser_id=ID&filtering={"campaign_ids":["C1","C2"],"primary_status":"STATUS_NOT_DELETE"}&fields=["adgroup_id","adgroup_name"]&page=1&page_size=1000   (URL-encode the JSON values; header Access-Token)
```

`data.list[]` fields, **campaign (39)** — type codes s=string b=bool f=float n=number i=integer o=object dt=datetime string "YYYY-MM-DD HH:MM:SS" []=array: advertiser_id:s, campaign_id:s, campaign_system_origin:s, create_time:s, modify_time:s, objective_type:s, app_promotion_type:s, virtual_objective_type:s, sales_destination:s,
is_search_campaign:b, campaign_automation_type:s, is_smart_performance_campaign:b, campaign_type:s, app_id:s, is_advanced_dedicated_campaign:b, disable_skan_campaign:b, bid_align_type:s,
campaign_app_profile_page_state:s, rf_campaign_type:s, campaign_product_source:s, catalog_enabled:b, campaign_name:s, special_industries:s[], budget_optimize_on:b, bid_type:s,
deep_bid_type:s, roas_bid:f, optimization_goal:s, budget_mode:s, budget:f, rta_id:s, rta_bid_enabled:b, rta_product_selection_enabled:b, operation_status:s, secondary_status:s,
postback_window_mode:s, is_new_structure:b, objective:s, po_number:s. Read-only (never send): `campaign_id, campaign_system_origin, create_time, modify_time, campaign_automation_type, is_smart_performance_campaign, bid_align_type, secondary_status, is_new_structure, objective` (APP/LANDING_PAGE). `budget_optimize_on` is returned only for CBO campaigns; unused fields come back `null`/`UNSET`/`0` (see samples in D 1854104036724929).

**ad group (147)**: advertiser_id:s, campaign_id:s, campaign_name:s, campaign_system_origin:s, campaign_automation_type:s, is_smart_performance_campaign:b, adgroup_id:s, adgroup_name:s, create_time:s,
modify_time:s, shopping_ads_type:s, identity_id:s, identity_type:s, identity_authorized_bc_id:s, product_source:s, catalog_id:s, catalog_authorized_bc_id:s, store_id:s,
store_authorized_bc_id:s, promotion_type:s, promotion_target_type:s, messaging_app_type:s, messaging_app_account_id:s, phone_region_code:s, phone_region_calling_code:s, phone_number:s,
promotion_website_type:s, app_id:s, app_type:s, app_download_url:s, pixel_id:s, optimization_event:s, custom_conversion_id:s, app_config:o[], deep_funnel_optimization_status:s,
deep_funnel_event_source:s, deep_funnel_event_source_id:s, deep_funnel_optimization_event:s, placement_type:s, placements:s[], tiktok_subplacements:s[], search_result_enabled:b,
automated_keywords_enabled:b, search_keywords:o[], comment_disabled:b, video_download_disabled:b, share_disabled:b, blocked_pangle_app_ids:s[], audience_type:s, audience_rule:o,
auto_targeting_enabled:b, shopping_ads_retargeting_type:s, shopping_ads_retargeting_actions_days:n, included_custom_actions:o[], excluded_custom_actions:o[],
shopping_ads_retargeting_custom_audience_relation:s, location_ids:s[], zipcode_ids:s[], languages:s[], gender:s, age_groups:s[], spending_power:s, household_income:s[], audience_ids:s[],
smart_audience_enabled:b, excluded_audience_ids:s[], interest_category_ids:s[], interest_keyword_ids:s[], purchase_intention_keyword_ids:s[], actions:o[], smart_interest_behavior_enabled:b,
included_pangle_audience_package_ids:s[], excluded_pangle_audience_package_ids:s[], operating_systems:s[], min_android_version:s, ios14_targeting:s, min_ios_version:s, ios14_quota_type:s,
device_model_ids:s[], network_types:s[], carrier_ids:s[], isp_ids:s[], device_price_ranges:n[], targeting_expansion:o, saved_audience_id:s, contextual_tag_ids:s[], brand_safety_type:s,
brand_safety_partner:s, inventory_filter_enabled:b, category_exclusion_ids:s[], vertical_sensitivity_id:s, budget_mode:s, budget:f, scheduled_budget:f, schedule_type:s,
schedule_start_time:dt, schedule_end_time:dt, predict_impression:n, topview_reach_range:n[], pre_discount_cpm:n, cpm:n, discount_type:s, discount_amount:n, discount_percentage:n,
pre_discount_budget:n, schedule_infos:o[], delivery_mode:s, dayparting:s, optimization_goal:s, secondary_optimization_event:s, message_event_set_id:s, frequency:n, frequency_schedule:n,
bid_type:s, bid_price:f, conversion_bid_price:f, deep_bid_type:s, roas_bid:f, vbo_window:s, bid_display_mode:s, deep_cpa_bid:f, cpv_video_duration:s, next_day_retention:f,
click_attribution_window:s, engaged_view_attribution_window:s, view_attribution_window:s, attribution_event_count:s, billing_event:s, pacing:s, operation_status:s, secondary_status:s,
statistic_type:s, is_hfss:b, is_lhf_compliance:b, creative_material_mode:s, adgroup_app_profile_page_state:s, feed_type:s, rf_purchased_type:s, purchased_impression:n, purchased_reach:n,
rf_estimated_cpr:n, rf_estimated_frequency:n, split_test_group_id:s, split_test_status:s, is_new_structure:b, skip_learning_phase:b, conversion_window:s. Nested: `search_keywords[] {keyword, match_type, keyword_bid_type, keyword_bid, audit_status, reject_info[]}`, `actions[] {action_scene, action_period, video_user_actions[], action_category_ids[]}`, `included_/excluded_custom_actions[] {code, days}`, `targeting_expansion {expansion_enabled, expansion_types[]}`, `app_config[] {app_id}`, `schedule_infos[]` (R&F), `audience_rule` (untyped object). **Read-only / GET-only (34, never send)**: `campaign_name, campaign_system_origin, campaign_automation_type, is_smart_performance_campaign, adgroup_id, create_time, modify_time, app_type, app_download_url, ios14_quota_type, inventory_filter_enabled, scheduled_budget, predict_impression, topview_reach_range, pre_discount_cpm, cpm, discount_type, discount_amount, discount_percentage, pre_discount_budget, schedule_infos, delivery_mode, cpv_video_duration, secondary_status, feed_type, rf_purchased_type, purchased_impression, purchased_reach, rf_estimated_cpr, rf_estimated_frequency, split_test_group_id, split_test_status, is_new_structure, conversion_window`. Semantics that differ from create: under CBO GET returns `budget_mode=BUDGET_MODE_INFINITE`, `budget=0.0`; `placements` is the resolved list when AUTOMATIC; `schedule_end_time` is auto-filled (start+10y) for FROM_NOW; attribution fields may be defaults; a saved-audience ad group returns `saved_audience_id` AND the expanded targeting; `bid_display_mode` may read `CPMV` (G).

## B. POST /campaign/create/ (D 1739318962329602, S CampaignCreateBody)
Required by docs and SDK: `advertiser_id`, `campaign_name`, `objective_type` (+ `budget_mode`/`budget` per table). Official examples: TRAFFIC `{advertiser_id, objective_type, campaign_name, budget_mode:"BUDGET_MODE_TOTAL", budget}`; WEB_CONVERSIONS adds `campaign_type:"REGULAR_CAMPAIGN"` (G). Response `data` = the full campaign object (same keys as GET, incl. `campaign_id`).

| field(s) | type | required? | notes | src |
|---|---|---|---|---|
| `advertiser_id` | string | **yes** | TARGET account id (string). | S D A |
| `campaign_name` | string | **yes** | ≤512 chars, no emoji (CJK char counts 2). Duplicate names need a different `request_id`. | S D A |
| `objective_type` | string | **yes** | TRAFFIC, WEB_CONVERSIONS, LEAD_GENERATION, APP_PROMOTION, VIDEO_VIEWS, REACH, ENGAGEMENT, PRODUCT_SALES, RF_REACH(allowlist). Immutable. Deprecated: APP_INSTALL, CONVERSIONS, CATALOG_SALES, SHOP_PURCHASES, old RF_*. GET-only: BRAND_CONSIDERATION, TOPVIEW_REACH. | S D A |
| `budget_mode` | string | cond. | Required unless RF_REACH (INFINITE only). Non-CBO: BUDGET_MODE_INFINITE / _TOTAL / _DAY. CBO: _TOTAL / _DYNAMIC_DAILY_BUDGET / _DAY. Immutable. DYNAMIC_DAILY_BUDGET: GA for TRAFFIC/WEB_CONVERSIONS/APP/LEAD_GEN/PRODUCT_SALES(video), allowlist for REACH/VIDEO_VIEWS/ENGAGEMENT. | S D A |
| `budget` | float | cond. | Required when budget_mode ≠ INFINITE. Float, account currency, major units; min per currency in §J. | S D A |
| `budget_optimize_on` | boolean | no | CBO switch; only `true` documented. Cannot be enabled on an existing campaign; immutable. Omit when false/null. | S D A |
| `operation_status` | string | no | ENABLE (default) / DISABLE. Accepted on create. R&F: ENABLE only. | S D A |
| `request_id` | string | no | String of a 64-bit int. 10 s idempotency window; also the only way to create duplicate names. | S D |
| `campaign_type` | string | no | REGULAR_CAMPAIGN / IOS14_CAMPAIGN (IOS14 only for PRODUCT_SALES and APP_PROMOTION+APP_INSTALL; needs app_id). | S D A |
| `virtual_objective_type`, `sales_destination` | string | cond. | `virtual_objective_type=SALES` = new "Sales" objective (objective_type WEB_CONVERSIONS or PRODUCT_SALES); then `sales_destination` is REQUIRED and only valid with it: TIKTOK_SHOP / WEBSITE / APP / WEB_AND_APP(allowlist). | S D |
| `special_industries` | string[] | no | HOUSING / EMPLOYMENT / CREDIT. May later be removed, not changed or added. | S D |
| `po_number` | string | no | Purchase-order string for invoices; account-specific. | S D |
| `app_promotion_type`, `app_id`, `campaign_app_profile_page_state`, `disable_skan_campaign`, `postback_window_mode` | mixed | cond. | APP_PROMOTION: app_promotion_type REQUIRED (APP_INSTALL / APP_RETARGETING / APP_PREREGISTRATION[allowlist]). Others iOS14-Dedicated only. GET returns UNSET/INVALID/null/APP_POSTS_PROMOTION → drop. | S D A |
| `is_search_campaign`, `is_advanced_dedicated_campaign`, `catalog_enabled` | boolean | no | All immutable after create. Search = allowlist; advanced dedicated default false; catalog_enabled only for Automotive Ads. | S D A |
| `rf_campaign_type`, `campaign_product_source` | string | cond. | rf_campaign_type STANDARD/PULSE only with RF_REACH (allowlist). campaign_product_source CATALOG/STORE REQUIRED for PRODUCT_SALES. | S D A |
| `rta_id`, `rta_bid_enabled`, `rta_product_selection_enabled` | mixed | no | Realtime API (allowlist, account-bound). rta_* flags default false and need rta_id. | S D |
| `bid_type`, `deep_bid_type`, `roas_bid`, `optimization_goal`, `internal_channel`, `plugin_partner` | mixed | no — drop | SDK-only. Docs mark bid_type/deep_bid_type/roas_bid/optimize_goal DEPRECATED in v1.3 (goal/bid live on the ad group); internal_channel/plugin_partner undocumented. GET still returns the first four (usually null/0). Do not send. | S A |

Never send (read-only GET fields): `campaign_id, campaign_system_origin, create_time, modify_time, campaign_automation_type, is_smart_performance_campaign, bid_align_type, secondary_status, is_new_structure, objective, page_info`.

## C. POST /adgroup/create/ (D 1739499616346114, S AdgroupCreateBody, 114 fields = SDK ∪ docs)
Required (docs flags = SDK flags = M): `advertiser_id, campaign_id, adgroup_name, budget_mode, budget, schedule_type, schedule_start_time, optimization_goal, billing_event, pacing`. ¹**Under a CBO campaign the CBO guide (D 1739381757818881) says do NOT send ad group `budget`/`budget_mode`/`pacing`** (ignored; pacing forced SMOOTH) — the SDK model still raises client-side if they are `None`, so use raw HTTP; under CBO `optimization_goal`, `bid_type`, `optimization_event` must equal the first ad group's and cannot be updated. Response `data` = full ad group object.

**Identity / status**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `advertiser_id` | string | **yes** | TARGET account id. | S D A |
| `campaign_id` | string | **yes** | NEW campaign id (`data.campaign_id` of /campaign/create/). | S D A |
| `adgroup_name` | string | **yes** | ≤512 chars, no emoji. Duplicate names need distinct `request_id`. | S D A |
| `request_id` | string | no | 64-bit-int string; 10 s idempotency. | S D |
| `operation_status` | string | no | ENABLE (default) / DISABLE. Accepted on create; not updatable via /adgroup/update/. | S D A |

**Placement / delivery surface**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `placement_type` | string | no | PLACEMENT_TYPE_NORMAL (default) / PLACEMENT_TYPE_AUTOMATIC. Immutable. | S D A |
| `placements` | string[] | cond. | Required if NORMAL; ignored/overwritten if AUTOMATIC (omit it). PLACEMENT_TIKTOK, PLACEMENT_PANGLE, PLACEMENT_GLOBAL_APP_BUNDLE (TOPBUZZ/HELO deprecated). Immutable. | S D A |
| `tiktok_subplacements` | string[] | no | IN_FEED, SEARCH_FEED, TIKTOK_LITE, LEMON8. Only objective REACH/VIDEO_VIEWS/ENGAGEMENT + NORMAL + [PLACEMENT_TIKTOK]; must contain IN_FEED. Drop for TRAFFIC/WEB_CONVERSIONS. | S D |
| `blocked_pangle_app_ids` | string[] | no | Pangle block-list app ids (v1.2 name `pangle_block_app_list_id`). Only effective with Pangle. | S D A |
| `comment_disabled` | boolean | no | bool. | S D A |
| `video_download_disabled` | boolean | no | bool. NOT updatable after create. | S D A |
| `share_disabled` | boolean | no | Default false; `true` only valid for APP_PROMOTION/WEB_CONVERSIONS/REACH/TRAFFIC/VIDEO_VIEWS/ENGAGEMENT/LEAD_GENERATION and placement AUTOMATIC, or NORMAL with only PLACEMENT_TIKTOK. | S D A |
| `search_result_enabled` | boolean | no | Auto-true for APP/WEB_CONV/TRAFFIC/LEAD_GEN on TikTok placement (omit or true = on; false = opt out). Forced false in Search campaigns. | S D A |
| `automated_keywords_enabled`, `search_keywords` | mixed | cond. | Search-Ads campaigns only (allowlist). search_keywords object[] {keyword, match_type, keyword_bid_type, keyword_bid}: required there, rejected elsewhere. | S D |

**Targeting: geo / demographics**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `location_ids` | string[] | cond. | Need location_ids and/or zipcode_ids; ≤3000 combined; no overlaps (country + its state). Global ids (/tool/region/, /tool/targeting/search/). | S D A |
| `zipcode_ids` | string[] | cond. | US ZIP codes; postal codes for CA (GA), BR/ID/TH/VN (allowlist). | S D A |
| `languages` | string[] | no | Language codes; empty/omitted = no limit. | S D A |
| `gender` | string | no | GENDER_UNLIMITED / GENDER_MALE / GENDER_FEMALE. | S D A |
| `age_groups` | string[] | no | AGE_13_17, AGE_18_24, AGE_25_34, AGE_35_44, AGE_45_54, AGE_55_100. 13-17 is refused in some scenarios in US/LatAm/EEA/UK/CH/CA; an empty list there then defaults to the adult groups. | S D A |
| `spending_power` | string | no | ALL / HIGH. Not PRODUCT_SALES/RF_REACH; needs TikTok placement; forced ALL with auto-targeting. | S D A |
| `household_income` | string[] | no | TOP5, TOP10, TOP10_25, TOP25_50. US + TikTok placement, Auction only. | S D A |

**Targeting: audiences / interests / behaviour**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `audience_ids`, `excluded_audience_ids` | string[] | no | Custom-audience ids from the advertiser's own /dmp/custom_audience/list/ (treat as advertiser-bound; inferred). | S D A |
| `saved_audience_id` | string | no | Must belong to the SAME advertiser; never send together with the targeting fields it contains (error). GET returns both. | S D |
| `smart_audience_enabled`, `smart_interest_behavior_enabled` | boolean | no | Smart Targeting toggles. | S D |
| `interest_category_ids`, `interest_keyword_ids` | string[] | no | Global ids (/targeting/search/). Never combine interest_keyword_ids with purchase_intention_keyword_ids. | S D A |
| `purchase_intention_keyword_ids` | string[] | no | Auction APP_PROMOTION/WEB_CONVERSIONS/LEAD_GENERATION/TRAFFIC/PRODUCT_SALES(catalog); TikTok or Pangle placement. | S D |
| `actions` | object[] | no | {action_scene VIDEO_RELATED/CREATOR_RELATED/HASHTAG_RELATED, action_period 0/7/15, video_user_actions[], action_category_ids[]}; action_category_ids only when TikTok is the only placement. | S D A |
| `audience_type`, `audience_rule` | mixed | cond. | audience_type NEW_CUSTOM_AUDIENCE only for app retargeting. audience_rule (object): TRAFFIC/APP_PROMOTION only; its pixel/app sources are most likely account-specific (inferred). | S D A |
| `included_pangle_audience_package_ids`, `excluded_pangle_audience_package_ids` | string[] | no | Pangle only; mutually exclusive. | S D A |
| `auto_targeting_enabled`, `targeting_expansion` | mixed | no — drop | DO NOT SEND: since 2024-06 automated targeting / targeting expansion can no longer be enabled (docs). In docs create table; absent from SDK create body. targeting_expansion = {expansion_enabled, expansion_types[]}. | D A |

**Targeting: device / network**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `operating_systems` | string[] | cond. | ONE value: ANDROID / IOS. Required for APP_PROMOTION and for TRAFFIC with promotion_type APP_IOS/APP_ANDROID. | S D A |
| `min_android_version`, `min_ios_version` | string | no | Enums "Minimum Android/iOS version". min_ios_version REQUIRED when ios14_targeting is sent. | S D A |
| `ios14_targeting` | string | cond. | UNSET / IOS14_MINUS / IOS14_PLUS / ALL. IOS14_PLUS only inside IOS14_CAMPAIGN. | S D A |
| `device_model_ids` | string[] | no | Global ids, active models only; not together with device_price_ranges. | S D A |
| `network_types`, `carrier_ids`, `isp_ids` | string[] | no | Enum "Connection type"; carriers must match targeted locations and be in_use; isp_ids only with country-level location_ids. | S D A |
| `device_price_ranges` | integer[] | no | Multiples of 50; 10000 = 1000+; real upper bound is +50. | S D A |

**Brand safety / content**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `brand_safety_type` | string | no | NO_BRAND_SAFETY (default) / EXPANDED_INVENTORY / STANDARD_INVENTORY / LIMITED_INVENTORY / THIRD_PARTY. Only placements=[PLACEMENT_TIKTOK]; pre-bid options = allowlist. | S D A |
| `brand_safety_partner`, `category_exclusion_ids`, `vertical_sensitivity_id`, `contextual_tag_ids` | mixed | cond. | partner IAS/OPEN_SLATE iff THIRD_PARTY. category_exclusion_ids needs STANDARD/LIMITED + TikTok-only. vertical_sensitivity_id: REACH/VIDEO_VIEWS/ENGAGEMENT. contextual_tag_ids: allowlist, REACH/VIDEO_VIEWS. | S D A |
| `is_hfss`, `is_lhf_compliance` | boolean | no | Default false. HFSS only with UK/AU/NZ/EU locations; from 2026-01-01 is_lhf_compliance must be true for UK + is_hfss. | S D A |

**Budget / schedule**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `budget_mode` | string | **yes**¹ | Non-CBO: BUDGET_MODE_TOTAL / _DAY / _DYNAMIC_DAILY_BUDGET (INFINITE not listed for ad groups). Under CBO: do not send. Campaign DAY ⇒ ad group DAY; SCHEDULE_FROM_NOW ⇒ DAY or DYNAMIC. Immutable. | S D A |
| `budget` | float | **yes**¹ | Float, account currency. Ignored/not needed under CBO. Min daily §J. Updates must be ≥105 % of spend. | S D A |
| `schedule_type` | string | **yes** | SCHEDULE_START_END / SCHEDULE_FROM_NOW (end auto = start + 10 y). BUDGET_MODE_TOTAL ⇒ START_END. | S D A |
| `schedule_start_time` | string | **yes** | "YYYY-MM-DD HH:MM:SS", UTC+0; may be up to 12 h in the past; ≤ 2028-01-01. | S D A |
| `schedule_end_time` | string | cond. | Required if START_END or budget_mode TOTAL; UTC+0; ≤ 2038-01-01. Omit for FROM_NOW. | S D A |
| `dayparting` | string | no | 336-char 0/1 string (48 half-hours × 7 days, Monday first); omitted/all-0/all-1 = all day. Time zone not stated. | S D A |
| `pacing` | string | **yes**¹ | PACING_MODE_SMOOTH / PACING_MODE_FAST. Forced SMOOTH under CBO (do not send); BID_TYPE_NO_BID ⇒ SMOOTH only. | S D A |
| `frequency`, `frequency_schedule` | number | cond. | REACH only; pair (1≤frequency≤1000, 1≤schedule≤30 days). | S D A |

**Optimization / bidding / attribution**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `promotion_type` | string | cond. | Required unless objective REACH/VIDEO_VIEWS/ENGAGEMENT. WEBSITE, APP_ANDROID, APP_IOS, LEAD_GENERATION, LEAD_GEN_CLICK_TO_TT_DIRECT_MESSAGE / _SOCIAL_MEDIA_APP_MESSAGE / _CALL (ENGAGEMENT: WEBSITE_OR_DISPLAY). Immutable. | S D A |
| `promotion_website_type` | string | cond. | UNSET (omit) / TIKTOK_NATIVE_PAGE (Instant Page ⇒ no pixel_id, optimization_event=BUTTON). | S D A |
| `promotion_target_type` | string | no | LEAD_GENERATION only: INSTANT_PAGE / EXTERNAL_WEBSITE. | S D |
| `optimization_goal` | string | **yes** | TRAFFIC: CLICK, TRAFFIC_LANDING_PAGE_VIEW, DESTINATION_VISIT(allowlist). WEB_CONVERSIONS: CLICK (not under CBO), CONVERT, VALUE, AUTOMATIC_VALUE_OPTIMIZATION (allowlist). Immutable. | S D A |
| `billing_event` | string | **yes** | From goal: CLICK, PAGE_VISIT→CPC; CONVERT, INSTALL, IN_APP_EVENT, TRAFFIC_LANDING_PAGE_VIEW, LEAD_GENERATION, CONVERSATION, FOLLOWERS, VALUE, AUTOMATIC_VALUE_OPTIMIZATION, PRODUCT_CLICK_IN_LIVE, MT_LIVE_ROOM, DESTINATION_VISIT→OCPM; SHOW, REACH→CPM; ENGAGED_VIEW*→CPV. Immutable. | S D A |
| `pixel_id` | string | cond. | Required when goal CONVERT/VALUE; create doc says "not supported" for other goals, WebConv guide calls it optional for Website. Account-bound. | S D A |
| `optimization_event` | string | cond. | Required when pixel_id is sent (or goal IN_APP_EVENT/VALUE without pixel); must exist on that pixel. Immutable. | S D A |
| `custom_conversion_id` | string | no | Needs pixel/app, goal CONVERT/IN_APP_EVENT and matching event. Account-bound. | S D |
| `secondary_optimization_event` | string | no | INSTALL/VALUE goals; deep_bid_type must then be sent too. | S D A |
| `bid_type` | string | cond. | BID_TYPE_CUSTOM (cost cap) / BID_TYPE_NO_BID (max delivery). Required under CBO (same for all ad groups of the CBO campaign). | S D A |
| `bid_price`, `conversion_bid_price` | float | cond. | CUSTOM only: bid_price when billing CPC/CPM/CPV; conversion_bid_price when OCPM. Must be lower than the budgets. | S D A |
| `deep_bid_type`, `roas_bid`, `deep_cpa_bid`, `vbo_window` | mixed | cond. | Value goal: deep_bid_type VO_MIN_ROAS / VO_HIGHEST_VALUE (allowlist) with bid_type NO_BID; roas_bid REQUIRED for VO_MIN_ROAS; vbo_window SEVEN_DAYS (default) / ZERO_DAY. deep_cpa_bid: SDK + update docs, missing from create-doc table. | S D A |
| `bid_display_mode`, `next_day_retention`, `statistic_type` | mixed | cond. | bid_display_mode=CPV REQUIRED for VIDEO_VIEWS only (GET shows CPMV elsewhere → drop). next_day_retention: Pangle + NEXT_DAY_OPEN. statistic_type EVERYTIME/NONE (app events). | S D A |
| `click_attribution_window`, `view_attribution_window`, `engaged_view_attribution_window`, `attribution_event_count` | string | no | click: OFF/ONE_DAY/SEVEN_DAYS/FOURTEEN_DAYS/TWENTY_EIGHT_DAYS; view: OFF/ONE_DAY/SEVEN_DAYS; engaged_view: ONE_DAY/SEVEN_DAYS; count: UNSET/EVERY/ONCE. Send click+view together (engaged only with both). All immutable. Not configurable for TRAFFIC. | S D |
| `skip_learning_phase` | boolean | no | In SDK create body and GET, absent from create-doc table (UNCONFIRMED). | S A |
| `creative_material_mode` | string | no | CUSTOM (default). DYNAMIC deprecated. GET filter also lists SMART_CREATIVE (create acceptance UNCONFIRMED). | S D A |
| `adgroup_app_profile_page_state` | string | no | ON / OFF. | S D A |

**App / lead-gen / shopping / messaging (skip for TRAFFIC & WEB_CONVERSIONS; account-bound)**

| field(s) | type | req. | notes | src |
|---|---|---|---|---|
| `app_id`, `app_config` | string / object[] | cond. | app_id: APP_PROMOTION (retargeting always; install/pre-reg if not IOS14). app_config object[] {app_id} ≤2 when sales_destination=WEB_AND_APP. | S D A |
| `deep_funnel_optimization_status`, `deep_funnel_event_source`, `deep_funnel_event_source_id`, `deep_funnel_optimization_event` | string | cond. | LEAD_GENERATION only: status ON/OFF; when ON the other three are REQUIRED (source PIXEL/OFFLINE/CRM). | S D |
| `messaging_app_type`, `messaging_app_account_id`, `phone_region_code`, `phone_region_calling_code`, `phone_number`, `message_event_set_id` | string | cond. | Instant-messaging lead gen only (MESSENGER/WHATSAPP/ZALO/LINE/IM_URL). | S D |
| `shopping_ads_type`, `product_source`, `catalog_id`, `catalog_authorized_bc_id`, `store_id`, `store_authorized_bc_id` | string | cond. | PRODUCT_SALES only (VIDEO/LIVE/PRODUCT_SHOPPING_ADS; CATALOG/STORE/SHOWCASE). | S D A |
| `identity_id`, `identity_type`, `identity_authorized_bc_id` | string | cond. | Shopping VIDEO+SHOWCASE / LIVE only (AUTH_CODE/TT_USER/BC_AUTH_TT). | S D |
| `shopping_ads_retargeting_type`, `shopping_ads_retargeting_actions_days`, `included_custom_actions`, `excluded_custom_actions`, `shopping_ads_retargeting_custom_audience_relation` | mixed | cond. | Video Shopping + catalog retargeting (LAB1/LAB2/LAB3). | S D A |

**Requirements by scenario** (D + G, WebConv guide id 1775548501843970):

| scenario | send | never send / notes |
|---|---|---|
| TRAFFIC · `promotion_type=WEBSITE` · goal `CLICK` | placement_type(+placements), location_ids, budget_mode+budget, schedule_*, `optimization_goal=CLICK`, `billing_event=CPC`, `bid_type` (NO_BID, or CUSTOM+`bid_price`), pacing (SMOOTH if NO_BID) — this is the official example (D) | pixel_id/optimization_event, attribution_*, deep_bid_type, roas_bid. CBO allows CLICK / TRAFFIC_LANDING_PAGE_VIEW for TRAFFIC |
| TRAFFIC · goal `TRAFFIC_LANDING_PAGE_VIEW` | as above with `billing_event=OCPM`, CUSTOM ⇒ `conversion_bid_price` | needs a TikTok Instant Page id at ad level, no deeplink, not Global App Bundle |
| TRAFFIC · `promotion_type=APP_ANDROID/APP_IOS` | + `operating_systems` (one value); whether `app_id` is required is UNCONFIRMED | |
| WEB_CONVERSIONS · WEBSITE · `CLICK` | as TRAFFIC CLICK | not allowed under CBO |
| WEB_CONVERSIONS · WEBSITE · `CONVERT` | `pixel_id`, `optimization_event`, `billing_event=OCPM`, CUSTOM ⇒ `conversion_bid_price`; attribution: click ONE_DAY/SEVEN_DAYS/FOURTEEN_DAYS/TWENTY_EIGHT_DAYS, view OFF/ONE_DAY/SEVEN_DAYS, count ONCE/EVERY (D 1777694366654465) | `deep_bid_type`, `roas_bid`; auto-targeting, targeting expansion, contextual tags must be absent; brand_safety_type ≠ THIRD_PARTY |
| WEB_CONVERSIONS · `VALUE` | `pixel_id`, `optimization_event=SHOPPING`, `deep_bid_type` VO_MIN_ROAS/VO_HIGHEST_VALUE (allowlist) + `bid_type=NO_BID`, `roas_bid` iff MIN_ROAS, OCPM, count EVERY | `bid_price`, `conversion_bid_price` |
| WEB_CONVERSIONS · TikTok Instant Page | `promotion_website_type=TIKTOK_NATIVE_PAGE`, `optimization_event=BUTTON`, goal CONVERT, placements ⊇ TikTok or Pangle | `pixel_id` |
| LEAD_GENERATION | `promotion_type` LEAD_GENERATION (+`promotion_target_type` INSTANT_PAGE/EXTERNAL_WEBSITE) or LEAD_GEN_CLICK_TO_TT_DIRECT_MESSAGE / _SOCIAL_MEDIA_APP_MESSAGE / _CALL (goal defaults to CLICK for these three); CBO goal = LEAD_GENERATION | EXTERNAL_WEBSITE + CLICK ⇒ no `pixel_id`/`optimization_event`; messaging fields only for IM |
| APP_PROMOTION | campaign `app_promotion_type`; ad group `app_id` (retargeting always; install/pre-reg unless IOS14), `operating_systems` (required), goals INSTALL/IN_APP_EVENT/VALUE; `audience_type` for retargeting | install-with-in-app-event no longer creatable on TikTok/automatic placement since 2024-11-30 |
| PRODUCT_SALES | campaign `campaign_product_source`; ad group `shopping_ads_type`, `product_source`, catalog/store ids, identity for LIVE/SHOWCASE | all out of scope for the allowlist |

**Fields only valid for some objectives (drop them when the objective differs):** `tiktok_subplacements`, `vertical_sensitivity_id` (REACH/VIDEO_VIEWS/ENGAGEMENT) · `frequency`, `frequency_schedule` (REACH) · `bid_display_mode` (VIDEO_VIEWS) · `contextual_tag_ids` (REACH/VIDEO_VIEWS) · `audience_rule` (TRAFFIC/APP_PROMOTION) · `promotion_target_type`, `deep_funnel_*` (LEAD_GENERATION) · `search_keywords`, `automated_keywords_enabled` (Search campaigns) · `operating_systems` required for APP_PROMOTION · `pixel_id/optimization_event` only with conversion goals · `purchase_intention_keyword_ids`, `category_exclusion_ids` (listed objectives only).

## D. Update / status endpoints (D, S)
- **POST /campaign/update/** (D 1739320422086657): `advertiser_id*, campaign_id*` + `campaign_name, special_industries, budget, po_number` only. Not updatable: `budget_mode, budget_optimize_on, objective_type, operation_status`. New budget must be ≥105 % of current spend. Returns the full campaign object.
- **POST /adgroup/update/** (D 1739586761631745): `adgroup_id*, advertiser_id*` + 71 optional fields (S = D). Updatable: `adgroup_name, budget, schedule_type/start/end` (start cannot change once already started), `dayparting, pacing, bid_type` (not under CBO), `bid_price, conversion_bid_price, deep_bid_type, roas_bid, deep_cpa_bid, secondary_optimization_event, frequency(+_schedule), comment_disabled, share_disabled, brand_safety_type, is_hfss, is_lhf_compliance`, all geo/audience/interest/device/network targeting fields, `exclude_age_under_eighteen`. **Not updatable** (get them right at create): `budget_mode, optimization_goal, optimization_event, billing_event, pixel_id, promotion_type, promotion_website_type, placement_type, placements, tiktok_subplacements, *_attribution_window, attribution_event_count, bid_display_mode, video_download_disabled, creative_material_mode, campaign_id, operation_status, app_id, app_config, identity_*, catalog_id, store_*, product_source, shopping_ads_type`. Rename = `{advertiser_id, adgroup_id, adgroup_name}`. A separate `/adgroup/budget/update/` is mentioned (D 1854112742370306) — contract UNCONFIRMED.
- **POST /campaign/status/update/** (D 1739320994354178): `{advertiser_id, campaign_ids: string[1..20], operation_status: ENABLE|DISABLE|DELETE, postback_window_mode?}` → `data {campaign_ids[], status, campaign_list[{campaign_id, status, postback_window_mode}]}`. Deleted campaigns cannot be modified; `DELETE` is permanent (M).
- **POST /adgroup/status/update/** (D 1739591716326402): `{advertiser_id, adgroup_ids: string[1..20], operation_status, allow_partial_success?=false}` → `data {adgroup_ids[], status, error_list[{adgroup_id, error_message}]}` (error_list only with allow_partial_success=true). R&F groups cannot be ENABLE/DISABLEd.
- Doc bug: both status examples still show `"opt_status"`; tables and SDK say `operation_status`. M claims "max 100 ids" — official tables say 20; use 20.

## E. Smart+ / Upgraded Smart+ (D 1854112742370306, 1854103649826817, 1854104036724929)
- **Different endpoints.** Upgraded Smart+ (`campaign_automation_type=UPGRADED_SMART_PLUS`): `/smart_plus/campaign/{create,update,get,status/update}/`, `/smart_plus/adgroup/{create,update,get,status/update}/`, `/smart_plus/ad/…`, `/smart_plus/campaign/copy/task/create/` (S 0.1.8 + D). Legacy Smart+ ("SPC"): `/campaign/spc/{create,update,get}/` — create ended 2026-03-31; update/status promised until 2026-06-30. D states `/campaign/create|update`, `/campaign/copy/task/create`, `/adgroup/create|update`, `/adgroup/budget/update`, `/ad/create|update` **cannot** create/update/copy Upgraded Smart+ entities. Upgraded Smart+ create requires an allowlisted account; its ad group takes a nested `targeting_spec` (S `SmartPlusAdgroupCreateBody`) — a different payload, not a rename.
- **GET detection.** `/campaign/get/` and `/adgroup/get/` return all three types by default; read `campaign_automation_type` ∈ `MANUAL` / `SMART_PLUS` / `UPGRADED_SMART_PLUS` (present on ad groups too; also a `filtering` key). Legacy Smart+ also has `is_smart_performance_campaign=true` (`false` for Manual and Upgraded). Samples: Manual `"campaign_automation_type":"MANUAL","is_smart_performance_campaign":false`; Smart+ `"SMART_PLUS"`, `true`.
- Other campaigns to **skip with a message**: `campaign_system_origin=PROMOTE` (only 6 fields readable), `is_search_campaign=true`, `campaign_type=IOS14_CAMPAIGN`, `is_advanced_dedicated_campaign=true`, `rf_campaign_type` set / `objective_type` ∈ RF_REACH, TOPVIEW_REACH, BRAND_CONSIDERATION (request `filtering.buying_types=["AUCTION"]`; the response has no buying_types key), GMV Max/Product-Sales/Shop (how GMV Max appears in /campaign/get/ is UNCONFIRMED), deprecated objectives (APP_INSTALL, CONVERSIONS, CATALOG_SALES, SHOP_PURCHASES).

## F. Limits, idempotency, rate limits
- **Campaigns:** "Each ad account can have up to 999 campaigns" (D). Ad group cap per campaign: none documented. **Active ad group quota:** `GET /adgroup/quota/?advertiser_id=` → `data {total_adgroup_quota, used_adgroup_quota}` (fixed 5000/0 for some advertisers; 0/0 if punished). Over quota the ad group is still created but **auto-deactivated within seconds and cannot be re-enabled via status/update** (D 1768463039162369). There is no bulk create and no dry-run (M).
- **Idempotency:** `request_id` (string of a 64-bit int) on create: same id inside **10 s** ⇒ only one succeeds (code 40050 "Duplicated requests have been sent" exists; mapping UNCONFIRMED); a different `request_id` is what allows duplicate names. Without `request_id`, duplicate-name behaviour is undocumented.
- **Rate limits (D, rate-limits page):** per developer app **per endpoint**, default level Basic = **10 QPS / 600 QPM / 864,000 QPD** (Advanced 20/1,200/1.73 M, Premium 30/1,800/2.59 M, Ultimate 50/3,000/4.32 M; one level at a time, via My Apps). `/campaign/create/`, `/adgroup/create/`, `/campaign/get/`, `/adgroup/get/` have no endpoint-specific override; `/ad/create/` Basic 5/150/86,400; `/campaign/copy/task/create/` 1/30/432,000; `/campaign/copy/task/check/` 2/60/864,000. Codes: **40100** app limit (QPM breach ⇒ wait 5 min; QPD resets 00:00 UTC), **40133** advertiser-level QPS ("Advertiser (id)'s QPS reaches limit for current path"; numbers unpublished), 40000/40002 bad params, 40104/40105 token, 50000 system error. Best practice: token bucket/queue; batch GETs with `campaign_ids`/`adgroup_ids` (≤100) instead of one call per id.

## G. Sources
- SDK: github.com/tiktok/tiktok-business-api-sdk — `python_sdk/business_api_client/models/{campaign,adgroup}_{create,update,status_update}_body.py`, `filtering_{campaign,adgroup}_get.py`, `api/{campaign_creation,adgroup}_api.py`, `api_client.py`, `yml_files/{smart_plus_*,adgroup_quota}.yml`, `Changelog.md` (0.1.8). Java/JS docs have empty descriptions.
- Official docs (portal `?id=`): campaign create 1739318962329602 · get 1739315828649986 · update 1739320422086657 · status 1739320994354178 · adgroup create 1739499616346114 · get 1739314558673922 · update 1739586761631745 · status 1739591716326402 · quota 1768463039162369 · enumerations 1737174886619138 · objectives 1737585562434561 · budget 1739381246298114 · currency budget 1737585839634433 · CBO 1739381757818881 · attribution 1777694366654465 · WebConv guide 1775548501843970 · Upgraded Smart+ 1853452461203458 · compat 1854112742370306 · retrieve 1854103649826817 · FAQ 1854104036724929 · copy guide 1788434533212162 · copy task create 1788434394151938 / check 1788434463507458 · rate limits 1740029171730433 · return codes 1737172488964097 · advertiser/info 1739593083610113. The portal is a JS app; text was read from its backend: `GET https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?doc_id=<id>` (or `content_slug=<slug>&version=1.3`) → `data.content_data`. Raw copies: `/tmp/hoplite/api-research/docs/*.md`.
- Cross-checks: Airbyte `source-tiktok-marketing/manifest.yaml` (schemas: campaigns 23 props, ad_groups 109; `filtering` as a stringified object); channel47/mcps `tiktok-ads/server/resources/business-api-reference.md`; docs.zernio.com `llms-full.txt` (TikTok ads: bid mapping, "$20 per ad set" minimum, manual-graph duplicate created paused); n8n-nodes-tiktok-business has no campaign/ad group operations (no cross-check value).

## H. UNCONFIRMED
1. Everything is untested against a live API (no token).
2. Whether TRAFFIC manual creation survives 2027-01-01 (banner silent vs "after Dec 31 2026" page).
3. Whether `/campaign/get/` hides deleted campaigns by default.
4. Error codes for duplicate names / repeated `request_id` (40050 exists, mapping unverified).
5. Whether deprecated campaign fields (`bid_type`, `deep_bid_type`, `roas_bid`, `optimization_goal`) are rejected or ignored on create.
6. Tolerance of `UNSET`/`null`/`0` values on create (strip anyway).
7. Create-time acceptance of `deep_cpa_bid`, `skip_learning_phase`, `creative_material_mode=SMART_CREATIVE`.
8. `dayparting` time zone; `create_time`/`modify_time` zone and format for campaigns.
9. Cross-advertiser use of BC-shared pixels / custom audiences / custom conversions.
10. `app_id` requirement for TRAFFIC + APP_* promotion types.
11. Advertiser-level QPS numbers behind code 40133.
12. Ad groups-per-campaign cap; whether deleted campaigns count toward 999.
13. Status-update max ids (20 in official tables vs 100 in M).
14. Campaign minimum budget (base 20 in Budget guide vs 50 in currency tables).
15. `/adgroup/budget/update/` contract; how GMV Max campaigns appear in /campaign/get/.
16. The exact 2027 banner wording comes from search-engine excerpts of three official pages (the text is injected client-side from an i18n service I could not fetch); only its existence/dates (`manual_flow_sunset`, 2026-09-12 → 2027-03-31) were confirmed from the portal's notification feed.

## I. Recommended ALLOWLIST for a faithful TRAFFIC / WEB_CONVERSIONS copy
Source: GET with all fields (+ `exclude_field_types_in_response=["NULL_FIELD"]`) → copy only these keys, then apply the transforms.

**Campaign payload (both objectives)**
- Copy: `campaign_name`, `objective_type`, `budget_mode`, `budget` (iff mode ≠ INFINITE), `budget_optimize_on` (iff true), `special_industries` (iff non-empty), `virtual_objective_type` + `sales_destination` (iff `virtual_objective_type` non-null = WEB_CONVERSIONS "Sales"), `campaign_type` (only if `REGULAR_CAMPAIGN`). Optional: `po_number`.
- Tool-set: `advertiser_id` (TARGET), `operation_status="DISABLE"`, `request_id` (random 63-bit int string).
- Drop: all read-only fields, deprecated `bid_type/deep_bid_type/roas_bid/optimization_goal`, `app_*`, `campaign_app_profile_page_state`, `disable_skan_campaign`, `postback_window_mode`, `rf_campaign_type`, `campaign_product_source`, `catalog_enabled`, `rta_*`, `is_advanced_dedicated_campaign`, `is_search_campaign`.

**Ad group payload — common**
- Core/placement: `adgroup_name`, `promotion_type`, `placement_type`, `placements` (iff NORMAL), `comment_disabled`, `video_download_disabled`, `share_disabled`, `blocked_pangle_app_ids` (iff Pangle), `search_result_enabled` (iff false).
- Targeting: `location_ids`, `zipcode_ids`, `languages`, `gender`, `age_groups`, `spending_power`, `household_income`, `interest_category_ids`, `interest_keyword_ids`, `purchase_intention_keyword_ids`, `actions`, `smart_audience_enabled`, `smart_interest_behavior_enabled`, `operating_systems`, `min_android_version`, `min_ios_version` + `ios14_targeting` (only if not UNSET), `device_model_ids`, `device_price_ranges`, `network_types`, `carrier_ids`, `isp_ids`.
- Budget/schedule/bid: `budget_mode`, `budget`, `schedule_type`, `schedule_start_time`*, `schedule_end_time`*, `dayparting`, `pacing`, `optimization_goal`, `billing_event`, `bid_type`, `bid_price` (CUSTOM+CPC), `conversion_bid_price` (CUSTOM+OCPM). (*rewritten, see transforms.)
- Safety flags: `brand_safety_type` (+`brand_safety_partner`, `category_exclusion_ids`) iff ≠ NO_BRAND_SAFETY; `is_hfss`/`is_lhf_compliance` iff true.
- Tool-set: `advertiser_id`, `campaign_id` (new), `operation_status="DISABLE"`, `request_id`.

**Per objective**
- TRAFFIC adds nothing for WEBSITE (no pixel, no attribution fields); for `promotion_type` APP_ANDROID/APP_IOS also `operating_systems` (and `app_id`, UNCONFIRMED).
- WEB_CONVERSIONS adds: `promotion_website_type` (iff TIKTOK_NATIVE_PAGE); remapped `pixel_id` + `optimization_event` (goal CONVERT/VALUE); `click_attribution_window` + `view_attribution_window` (+`engaged_view_attribution_window`) + `attribution_event_count` together, as returned; `deep_bid_type`/`roas_bid`/`vbo_window` only for goal VALUE (allowlisted).

**Account-bound (docs: ids come from the target's own list endpoints; cross-advertiser sharing behaviour UNCONFIRMED) ⇒ remap through the target account, or drop and warn:** `pixel_id`, `optimization_event`, `custom_conversion_id`, `audience_ids`, `excluded_audience_ids`, `saved_audience_id`, `audience_rule`, `app_id`/`app_config`, `identity_*`, `catalog_*`, `store_*`, `message_event_set_id`, `deep_funnel_event_source_id`.
**Never send:** read-only fields, `auto_targeting_enabled`, `targeting_expansion`, `bid_display_mode` (non-video), `conversion_window`, `skip_learning_phase`.

**Transforms**
1. Drop `null`, `[]`, `"UNSET"`, `"INVALID"` and `0`/`0.0` bids (the official sample response shows `bid_price: 0.0` for NO_BID).
2. `schedule_start_time` = max(original, now + a few minutes) in UTC; shift `schedule_end_time` by the same delta (keep duration, ≤ 2038-01-01); FROM_NOW ⇒ omit end; TOTAL budget ⇒ START_END + end.
3. AUTOMATIC placement ⇒ omit `placements`. 4. CBO campaign ⇒ omit ad group `budget_mode/budget/pacing`. 5. `saved_audience_id` present ⇒ drop it, keep the expanded targeting.
6. NO_BID ⇒ `pacing=PACING_MODE_SMOOTH`, no bid prices. 7. Convert/validate money for the target currency (§J).
8. Flow: `/advertiser/info/` (both) → `/adgroup/quota/` (target) → create campaign → create ad groups sequentially (≈≤5 req/s) → on failure `/campaign/status/update/ DELETE` → verify via GET → ENABLE in batches ≤20.

Smallest official TRAFFIC ad group (D example): `{advertiser_id, campaign_id, adgroup_name, promotion_type:"WEBSITE", placement_type:"PLACEMENT_TYPE_NORMAL", placements:["PLACEMENT_TIKTOK"], location_ids:[…], gender:"GENDER_UNLIMITED", budget_mode:"BUDGET_MODE_TOTAL", budget, schedule_type:"SCHEDULE_START_END", schedule_start_time, schedule_end_time, optimization_goal:"CLICK", bid_type:"BID_TYPE_NO_BID", billing_event:"CPC", pacing:"PACING_MODE_SMOOTH", operation_status:"ENABLE"}` (the doc also sends `operating_systems:["ANDROID"]`, `video_download_disabled:false`).

## J. Gotchas
- **IDs are strings** everywhere in v1.3 (requests and responses; never numbers, never JS `Number`). **Objective-gated fields to drop when the objective differs:** see the list under §C.
- **Budgets (D 1739381246298114, 1737585839634433).** Daily range = base × *Budget Verification Ratio* of the account currency. I checked the formula against all 56 rows of the doc's three tables: ad group min **20×ratio** (10×ratio for `product_source` STORE/SHOWCASE); campaign min **50×ratio** in the currency table (10×ratio for PRODUCT_SALES+STORE) while the Budget guide text says 20 for campaigns (inconsistent; UNCONFIRMED which is enforced — use 50×ratio as the safe bound); max (exclusive) 10,000,000×ratio; lifetime ad group budget ≥ daily min × scheduled days.
  - Ratio 1: USD EUR GBP MYR AED SAR HUF AUD CAD NZD SGD CHF ARS BRL ILS PEN QAR RON · 4: PLN · 10: HKD ZAR DKK SEK NOK TRY MXN THB CNY BOB CZK EGP GTQ HNL MOP TWD NIO UAH UYU · 50: PHP · 100: JPY RUB DZD BDT ISK INR KES NGN PKR · 1,000: KRW CLP COP CRC · 10,000: IDR PYG VND · 100,000: VEF.
  - Precision 0.01 except integer-only: JPY KRW HUF CLP ISK IDR TWD PYG VND. Example min ad group daily: USD 20, JPY 2,000, KRW 20,000, IDR 200,000. Cross-currency copies need conversion + re-validation (bids must stay below budgets).
- **Time:** format is exactly `YYYY-MM-DD HH:MM:SS` in UTC (no `T`/`Z`/offset); start may be ≤12 h in the past, so copying an old schedule fails — rewrite it (§I). `dayparting` is a 336-char string, zone not stated.
- **CBO:** campaign `budget_optimize_on`/`budget_mode` are immutable; a CBO campaign's ad groups share `optimization_goal`/`bid_type`/`optimization_event`; the CLICK goal is not supported under CBO for WEB_CONVERSIONS.
- **Saved audiences / audiences / pixels / custom conversions are advertiser-bound**: `saved_audience_id` must be the same advertiser and cannot be combined with its own targeting fields; audience/pixel ids come from `/dmp/custom_audience/list/`, `/pixel/list/` of the target (BC sharing behaviour UNCONFIRMED).
- **Attribution:** pass click+view together; immutable; per docs TRAFFIC attribution is not configurable (only app/lead/product-sales/web-conversions have option tables), so do not echo GET defaults back for TRAFFIC.
- **Bidding:** CUSTOM+CPC ⇒ `bid_price`; CUSTOM+OCPM ⇒ `conversion_bid_price`; NO_BID ⇒ SMOOTH pacing only; `bid_price`/`conversion_bid_price` must be lower than budget.
- **Deprecated/blocked:** automated targeting & targeting expansion can no longer be enabled; `VIDEO_VIEW` optimization goal and `CPMV` bid_display_mode are deprecated; `creative_material_mode=DYNAMIC` deprecated.
- Names: always send a fresh `request_id`; names ≤512 chars, no emoji.
- Token must be authorized for BOTH advertisers; check target `status`, `currency`, `timezone` via /advertiser/info/ and `/adgroup/quota/` first.
- Doc inconsistencies to expect: campaign min budget (20 vs 50), pixel optional-vs-unsupported, status-update `opt_status` examples, 20 vs 100 ids.

