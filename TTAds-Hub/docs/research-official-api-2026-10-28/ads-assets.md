# TikTok Marketing API v1.3 — ads & assets: contracts for cross-advertiser ad copy

Verified 2026-10-28. Base `https://business-api.tiktok.com/open_api/v1.3/`, auth header `Access-Token`.
Source tags:
- **D:<id>** official portal doc, fetched live as markdown (ids in §K)
- **SDK** tiktok/tiktok-business-api-sdk @f809c39 (2026-02-28): field names/types only, lags the docs
- **AB** Airbyte source-tiktok-marketing manifest · **PD** Pipedream action
- **GO** bububa/tiktok-business (comments translate the CN official docs → not independent)
- **2×** = confirmed by ≥2 independent sources. Unproven items are collected in §J (UNCONFIRMED).

## 0. Key findings
1. **Official asset sharing exists**: `POST /creative/asset/share/` (VIDEO/IMAGE/MUSIC by `material_ids`). It returns no new IDs (§D.4).
2. **No official cross-advertiser copy of ads / ad groups / campaigns.** `POST /campaign/copy/task/create/` (+`/campaign/copy/task/check/`) copies a Manual campaign *within one* `advertiser_id` (its ~60 request fields contain no target advertiser) and is allowlist-only [D:1788434533212162, D:1788434394151938].
3. **Custom identity is being phased out.** `/ad/create/` and `/ad/update/` with `identity_type=CUSTOMIZED_USER` (or a custom `identity_id`) **error** for ad groups delivering to Automatic/Select placement incl. TikTok — existing accounts now, new accounts since 2026-01-15. Not affected: Pangle/Global-App-Bundle-only placements, Branded Mission, Sales–TikTok Shop, Smart Creative, Manual+catalog [D:1848048566169730]. Pre-check the target with `GET /advertiser/info/` → `can_use_custom_identity`, `ads_only_mode` [D:1739593083610113].
4. `/ad/create|update/` cannot create/update **Upgraded Smart+** ads (use `/smart_plus/ad/*`) [D:1854112742370306]. Announced sunset (portal banner, not in doc bodies): from 2027-01-01 `/ad/create/`, `/ad/aco/create/`, `/campaign/copy/task/create/` drop non-Search *Legacy Manual Flow* campaigns for Sales / App Promotion / Lead Gen.
5. `call_to_action_id` (CTA portfolio) is advertiser-bound: "Auto-optimized CTAs can only be used in the advertiser accounts that they were created for" [D:1739091950439426].
6. IDs are globally unique, but a re-uploaded video gets a **new `video_id` with the same `material_id`** [D:1792139804568578].
7. JS hazard: `tracking_pixel_id` and `page_id` are JSON **numbers** (~19 digits) — see §I.

## 1. Conventions & limits
- Bodies are JSON (`Content-Type: application/json`), except `/file/*/ad/upload/` with `upload_type=UPLOAD_BY_FILE` → `multipart/form-data` [D:1737587322856449, D:1739067433456642].
- GET arrays/objects are **JSON text inside the query value**, URL-encoded:
  `ad/get/?advertiser_id=1&filtering={"ad_ids":["1","2"]}&fields=["ad_id","ad_name"]&page=1&page_size=100`
  [D:1735735588640770 curl; D:1740218420781057 sample code `json.dumps` for non-strings; D:1740051721711618 `image_ids=["…"]`]. The SDK sends repeated `fields=` params — use the JSON form.
- Envelope `{code,message,request_id,data}`; HTTP 200 with `code!=0` is a failure [D:1737172488964097]:
  40001 no permission · 40002 param error · 40007 object missing · 40011 too many IDs · 40050 duplicate request · 40053 invalid video id · 40016/40100 app-level and 40133 advertiser-level rate limit · 40502 ad-group ad limit.
- App rate limits (QPS/QPM/QPD): Basic 10/600/864k · Advanced 20/1,200/1.728M · Premium 30/1,800/2.592M · Ultimate 50/3,000/4.32M. `/ad/create/` has its own limit: 5/150 (Basic), 10/200, 10/300, 15/300 per s/min, QPD 86,400. QPM hit → wait 5 min [D:1740029171730433].
- Token scopes [D:1753986142651394]:

| scope id | name | endpoints |
|---|---|---|
| 220 / 221 | Read Ads / Create+Update Ads | `/ad/get/` / `/ad/create`, `/ad/update`, `/ad/status/update` |
| 600 / 601 | Image library read / write | `/file/image/ad/search|info` / `…/upload` |
| 610 / 611 / 612 | Video library read / write / thumbnails | `/file/video/ad/search|info` / `…/upload` / `/file/video/suggestcover` |
| 64 | Creative tool | `/creative/asset/share/` |
| 692 / 693 | Create / Query Identity | `/identity/create` / `/identity/get`, `/identity/video/get|info` |
| 690 / 691 | Query / Authorize TikTok posts | `/tt_video/info` / `/tt_video/authorize|list|unbind` |
| 800 · 153 · 100 · 32 | Read Pixels · BC Asset · Ad account info · Share audiences | `/pixel/list` · `/bc/asset/*`, `/bc/pixel/*` · `/advertiser/info` · `/dmp/custom_audience/share` |
| 6110100 | CTA recommendation | `/creative/portfolio/*`, `/creative/cta/recommend/` |
Scope of `/bc/asset/advertiser/*` is not listed in the doc.

## A. GET /ad/get/  [D:1735735588640770 · SDK AdApi/FilteringAdGet · AB ads_stream]
Params: `advertiser_id`* · `fields` string[] (keys under `data.list`; omitted → all) · `exclude_field_types_in_response` `["NULL_FIELD"]` · `page` ≥1 (def 1) · `page_size` **1–1000** (def 10; AB uses 100) · `filtering` object:

| filtering key | notes |
|---|---|
| ad_ids, adgroup_ids, campaign_ids, ad_ids_v2 | string[], **≤100 each** |
| primary_status | STATUS_ALL, STATUS_NOT_DELETE (SDK default; deleted hidden by default), STATUS_DELETE, STATUS_NOT_DELIVERY, STATUS_DELIVERY_OK, STATUS_DISABLE, STATUS_FROZEN, STATUS_TIME_DONE, STATUS_RF_CLOSED [D:1757239620352002] |
| secondary_status | AD_STATUS_ALL (incl. deleted; AB uses it), AD_STATUS_DELIVERY_OK, AD_STATUS_DISABLE, AD_STATUS_AUDIT_DENY, AD_STATUS_DELETE … [D:1737174886619138] |
| campaign_automation_type | MANUAL, SMART_PLUS, UPGRADED_SMART_PLUS |
| objective_type, optimization_goal, destination, creative_material_mode | enums (creative_material_mode CUSTOM/DYNAMIC/SMART_CREATIVE; destination APP/TIKTOK_INSTANT_PAGE/WEBSITE/SOCIAL_MEDIA_APP…) |
| buying_types | def `["AUCTION","RESERVATION_RF"]`; `RESERVATION_TOP_VIEW` only alone |
| campaign_system_origins | def `["TT_ADS_PLATFORM"]`; PROMOTE ads return only 10 base fields |
| creation_filter_start_time / _end_time, modified_after | `YYYY-MM-DD HH:MM:SS` UTC; ≤6-month window advised |

Response:
- `data.list[]` sorted by `ad_id` desc, plus `data.page_info{page,page_size,total_number,total_page}`.
- Product/LIVE GMV Max ads are excluded; Upgraded Smart+ filters return only ids/names/`ad_id_v2`/`campaign_automation_type`; Smart Creative materials come from `/ad/aco/get/`.
- Complete `list[]` field set (string unless noted):

| group | fields |
|---|---|
| ids/meta | advertiser_id, campaign_id, campaign_name, campaign_automation_type, campaign_system_origin, adgroup_id, adgroup_name, smart_plus_ad_id, ad_id, ad_id_v2, ad_name, create_time, modify_time |
| identity | identity_id, identity_type, identity_authorized_bc_id (BC_AUTH_TT only), display_name, avatar_icon_web_uri (image id), profile_image_url (URL), tiktok_item_id (**only** Spark Pull ads, or Push ads that passed review), dark_post_status, branded_content_disabled (bool), promotional_music_disabled (bool), item_duet_status, item_stitch_status |
| creative | ad_format, video_id (**null** for Spark Pull), image_ids[], music_id, carousel_image_index (int), ad_text, ad_texts[], call_to_action, call_to_action_id, card_id, creative_type, creative_authorized (bool), creative_auto_enhancement_strategy_list[], aigc_disclosure_type, vertical_video_strategy, dynamic_format, end_card_cta, auto_disclaimer_types[], product_display_field_list[], disclaimer_type, disclaimer_text{text}, disclaimer_clickable_texts[{text,url}] |
| destination | landing_page_url, utm_params[{key,value}], page_id (**number**), cpp_url, tiktok_page_category, phone_region_code, phone_region_calling_code, phone_number, deeplink, deeplink_type, deeplink_format_type, deeplink_utm_params[], shopping_ads_deeplink_type, shopping_ads_fallback_type, fallback_type, dynamic_destination, auto_message_id, app_name |
| tracking | tracking_pixel_id (**number**), tracking_app_id, tracking_offline_event_set_ids[], tracking_message_event_set_id, impression_tracking_url, click_tracking_url, playable_url, viewability_postbid_partner, viewability_vast_url, brand_safety_postbid_partner, brand_safety_vast_url, vast_moat_enabled (bool) |
| catalog | catalog_id, product_specific_type, item_group_ids[], product_set_id, sku_ids[], vehicle_ids[], showcase_products[{item_group_id,store_id,catalog_id}], shopping_ads_video_package_id |
| status/other | operation_status (ENABLE\|DISABLE\|FROZEN), secondary_status, is_aco (bool), is_new_structure (bool), optimization_event, share_disabled / comment_disabled / video_download_disabled (bool, TopView only) |

- Not returned by GET (cannot round-trip): `video_view_tracking_url`, `schedule_id`, `instant_product_page_used`, `page_image_index`.
- AB also lists undocumented legacy `image_mode`, `premium_badge_id`, `landing_page_urls`, `shopping_deeplink_type` — never send them.

## B. POST /ad/create/  [D:1739953377508354 · SDK AdCreateBody/AdcreateCreatives · GO · PD]
- Body: `advertiser_id`* (TARGET) · `adgroup_id`* (TARGET) · `creatives`* object[] (**max 20 per call**; ≤50 ads per ad group, 20 for RF_REACH or PRODUCT_SALES+STORE).
- Response: `data.ad_ids` string[] + `data.creatives[]` (full ad entity, a subset of GET fields) + `page_info`. No idempotency key and no partial-failure semantics are documented.
- `creatives[]` item (REQ required · COND depends):

| field | type | req | notes | src |
|---|---|---|---|---|
| ad_name | string | REQ | ≤512 chars, no emoji; `""` → auto-name (= ad_id) | D,SDK |
| ad_format | string | REQ | SINGLE_IMAGE, SINGLE_VIDEO, LIVE_CONTENT, CAROUSEL_ADS, CATALOG_CAROUSEL (carousel formats immutable) | D,SDK |
| identity_type | string | REQ (v1.3) | CUSTOMIZED_USER, AUTH_CODE, TT_USER, BC_AUTH_TT (TTS_TT exists but is not an ad value) | D,SDK,PD |
| identity_id | string | REQ | see §E | D,SDK |
| identity_authorized_bc_id | string | COND | required iff BC_AUTH_TT | D,SDK |
| video_id | string | COND | REQ for SINGLE_VIDEO+CUSTOMIZED_USER; TT_USER/BC_AUTH_TT: `video_id` (push) **or** `tiktok_item_id` (pull); unsupported for SINGLE_IMAGE/CAROUSEL_ADS | D,SDK |
| image_ids | string[] | COND | SINGLE_IMAGE: exactly 1 · SINGLE_VIDEO non-Spark / Spark Push: REQ, exactly 1 = cover, same aspect ratio as the video · Spark Pull: **not supported** · CAROUSEL_ADS: 1–35, ordered | D,SDK |
| tiktok_item_id | string | COND | Spark Pull: REQ for AUTH_CODE/BC_AUTH_TT (guide also uses it for TT_USER); not for CUSTOMIZED_USER | D,SDK |
| music_id | string | COND | REQ for CAROUSEL_ADS (non-Pull) and CATALOG_CAROUSEL | D,SDK |
| ad_text | string | COND | non-Spark: `ad_text` or `ad_texts` REQ; Spark Push REQ; ≤100 chars, no emoji (CJK = 2); ignored if `ad_texts` set | D,SDK |
| ad_texts | string[] | COND | ≤5; "valid only for Search Ads campaigns" | D,SDK |
| call_to_action | string | COND | CTA enum; TikTok ads need this OR `call_to_action_id` (id wins if both); Live SHORT_VIDEO_LIVE must be `WATCH_LIVE` | D,SDK |
| call_to_action_id | string | COND | CTA-portfolio id (advertiser-bound) | D,SDK |
| card_id | string | opt | creative-portfolio id (cards, stickers, Pop-up Showcase, Gesture, Superlike…) | D,SDK |
| landing_page_url | string | COND | website destinations (GET filter `destination=WEBSITE` ⇔ ad has `landing_page_url`); may carry a UTM query | D,SDK |
| utm_params, deeplink_utm_params | {key,value}[] | opt | ≤14 each | D,SDK |
| page_id | **number** | COND | instant page/form (`destination=TIKTOK_INSTANT_PAGE` ⇔ ad has `page_id`; LEAD_GENERATION forms need the `LeadAds` agreement via `/term/confirm/`) | D,SDK |
| deeplink · deeplink_type · deeplink_format_type · fallback_type | string | opt | type NORMAL (def) / DEFERRED_DEEPLINK (allowlist); format UNIVERSAL_OR_APP_LINK / SCHEME_LINK / NONE (immutable once set); fallback APP_INSTALL / WEBSITE (needs landing_page_url) / UNSET | D,SDK |
| display_name | string | COND | 1–40 chars (CJK 1–20); "required when promotion type is landing page or pure exposure" (legacy) | D,SDK |
| avatar_icon_web_uri | string | opt | avatar **image id**, 1:1 (from `/file/image/ad/upload/`) | D,SDK |
| app_name | string | COND | 1–40, app promotion | D,SDK |
| tracking_pixel_id | **number** | opt | with an ad-group `pixel_id`, must be the same id | D,SDK |
| tracking_app_id · tracking_message_event_set_id | string | opt | `/app/list/` id · message event set (immutable once set) | D,SDK |
| tracking_offline_event_set_ids | string[] | opt | ≤50; omitted → all auto-tracking sets of the advertiser | D,SDK |
| impression_ / click_ / video_view_tracking_url | string | opt | third-party URLs; ignored for app partner 44/49 or self-attribution apps | D,SDK |
| viewability_ / brand_safety_postbid_partner (+_vast_url), playable_url | string | opt | allowlist-only; playable on TikTok sunset 2024-09-30 | D,SDK |
| **operation_status** | string | opt | `ENABLE` (def) / **`DISABLE`** = created paused (never DISABLE for Reach&Frequency); change later with `/ad/status/update/` | D,SDK **2×** |
| creative_authorized | bool | opt | Creative Center display; video ads only, non-US advertisers, def false | D,SDK |
| dark_post_status | string | opt | `ON`/`OFF`; **default ON since 2026-01-27**; Spark Push only; OFF illegal if identity or advertiser `ads_only_mode`=true | D |
| promotional_music_disabled (def true) · item_duet_status · item_stitch_status | | opt | Spark posts only; duet/stitch ENABLE/DISABLE valid only if promotional_music_disabled=false | D,SDK |
| aigc_disclosure_type | string | opt | **only CUSTOMIZED_USER**: SELF_DISCLOSURE / NOT_DECLARED (def) | D,SDK |
| creative_auto_enhancement_strategy_list | string[] | opt | VIDEO_QUALITY, MUSIC_REFRESH, IMAGE_QUALITY, IMAGE_RESIZE; default depends on allowlist; absent from SDK | D |
| disclaimer_type · disclaimer_text{text} · disclaimer_clickable_texts[{text,url}] · auto_disclaimer_types | | opt | objective/advertiser restricted | D,SDK |
| catalog_id · product_specific_type · item_group_ids · product_set_id · sku_ids · vehicle_ids · showcase_products (≤20) · shopping_ads_video_package_id · shopping_ads_deeplink_type · shopping_ads_fallback_type | | COND | shopping/catalog only | D,SDK |
| vertical_video_strategy · dynamic_format · dynamic_destination · instant_product_page_used · page_image_index · carousel_image_index · end_card_cta · product_display_field_list · creative_type · cpp_url · tiktok_page_category · phone_region_code / _calling_code / phone_number · auto_message_id · schedule_id | | COND | objective/ad-group dependent; not needed for plain SINGLE_VIDEO | D,SDK |

- Per-format minimum:
  - SINGLE_VIDEO: `video_id` (+1 cover in `image_ids` unless Pull)
  - SINGLE_IMAGE: 1 `image_ids`
  - CAROUSEL_ADS: 1–35 `image_ids` + `music_id`
  - LIVE_CONTENT: `creative_type` SHORT_VIDEO_LIVE|DIRECT_LIVE (+`call_to_action=WATCH_LIVE` for SHORT_VIDEO_LIVE); identity requirements UNCONFIRMED (`can_use_live_ads` flag exists)
- **GET-only / read-only — never send to create**: ad_id, campaign_id, campaign_name, adgroup_name, campaign_automation_type, campaign_system_origin, smart_plus_ad_id, ad_id_v2, create_time, modify_time, secondary_status, profile_image_url, is_aco, is_new_structure, optimization_event, branded_content_disabled, vast_moat_enabled (update-only in SDK), share_disabled / comment_disabled / video_download_disabled, `FROZEN` as operation_status, legacy `image_mode`, `premium_badge_id`, `landing_page_urls`, `shopping_deeplink_type`, `status`, `opt_status`, `profile_image`, `open_url`. `advertiser_id`/`adgroup_id` only at top level.

## C. Update & status
- `POST /ad/update/` [D:1739953405142018 · SDK AdUpdateBody]: `advertiser_id`*, `adgroup_id`*, `creatives`* (≤20, each with `ad_id`), `patch_update` bool.
  - Patch mode covers only ad_name, identity_id, identity_type, identity_authorized_bc_id, video_id, image_ids, music_id, tiktok_item_id, ad_text, ad_texts; otherwise it is a full update (omitted fields may be nulled).
  - Same custom-identity error as create.
- `POST /ad/status/update/` [D:1739953422970882 · SDK AdStatusUpdateBody]: `advertiser_id`*, `ad_ids` **1–20** (or `aco_ad_ids` 1–20, ENABLE/DISABLE only), `operation_status`* ENABLE|DISABLE|DELETE. Deleted ads / ads in deleted groups cannot be changed. Response `data{ad_ids, aco_ad_ids, status}`.

## D. Media
**D.1 Read**
- `GET /file/video/ad/info/` [D:1740050161973250 · AB]: `advertiser_id`*, `video_ids`* (**max 60**; unusable ids silently dropped).
  - `data.list[]`: video_id, material_id, file_name, format, duration (float s), width, height, bit_rate, size (bytes), signature (file MD5), displayable, allow_download, allowed_placements[], create_time / modify_time (`2020-06-10T07:39:14Z`).
  - `video_cover_url` + `preview_url` are **temporary, valid 6 h** (cover URL carries `x-expires`); `preview_url_expire_time` is `YYYY-MM-DD HH:MM:SS` UTC.
- `GET /file/video/ad/search/` [D:1740050472224769]: `filtering{video_ids≤100, material_ids≤20, video_name (fuzzy), video_material_sources[], sort_field CREATE_TIME|MODIFY_TIME}`; height/ratio/width/displayable were removed in v1.3 (SDK still lists them); `page_size` 1–100 (def 20); only the 10,000 most recently modified; without `video_ids` one id per material is returned.
- `GET /file/image/ad/info/` [D:1740051721711618]: `image_ids` ≤100 → image_id, material_id, is_carousel_usable, width, height, format, size, signature, file_name, displayable, times, `image_url` (valid **1 h**). Thumbnails of Ads-Manager ads (ids from `/ad/get/`) are **not** in the library, so info fails for them.
- `GET /file/image/ad/search/` [D:1740052016789506]: `filtering{image_ids≤100, material_ids≤100, ratio, width, height, displayable}`, `page_size` 1–100, 10,000 cap.

**D.2 `POST /file/video/ad/upload/`** [D:1737587322856449 · SDK AdUploadBody · GO]
- `advertiser_id`*; `upload_type`:
  - `UPLOAD_BY_FILE` (def): multipart `video_file` (500 MB limit; mp4/mov/mpeg/avi) + `video_signature` MD5 REQ
  - `UPLOAD_BY_URL`: `video_url`, JSON; "better within 10 MB"; Content-Type must not be text/*; `Content-MD5` verified if set
  - `UPLOAD_BY_FILE_ID`: `file_id` from the file repository, JSON
  - `UPLOAD_BY_VIDEO_ID`: `video_id` "created in Ads Manager or via API"; returns the **same** id
- Optional: `file_name` (1–100, **unique per advertiser**, check via `/file/name/check/`), `is_third_party`, `flaw_detect`, `auto_fix_enabled` (LOW_RESOLUTION→720p, ILLEGAL_VIDEO_SIZE→1:1/9:16/16:9; returns `fix_task_id`, `flaw_types`), `auto_bind_enabled`, `pre_review_enabled` + `pre_review_info`.
- **10 s request timeout.** Response `data` is an **array of one object** (`[{video_id,…}]`, fields as D.1 + fix_task_id/flaw_types). Often only `video_id` is returned → wait 30 s–5 min, then `/file/video/ad/search/`.
- File/URL/FILE_ID uploads mint a NEW video_id each time; the doc also says an already-existing video in the same advertiser returns that video's info (conflicting statements).
- Video spec: ratio 1:1 / 9:16 / 16:9, ≥540×960 | 640×640 | 960×540 [D:1738963828459521].

**D.3 `POST /file/image/ad/upload/`** [D:1739067433456642 · SDK FileImageAdUpload]
- `advertiser_id`*, `upload_type` `UPLOAD_BY_FILE` (def; `image_file` ≤50 MB jpg/jpeg/png, ≤3,686,400 px, `image_signature` MD5 REQ) | `UPLOAD_BY_URL` (`image_url`) | `UPLOAD_BY_FILE_ID` (`file_id`); `file_name` 1–100, unique per advertiser.
- Response `data` is an **object**: image_id, material_id, is_carousel_usable (may be absent → wait ~10 s, query info/search), displayable, width, height, format, size, signature, file_name, `image_url` (1 h), times.
- Cover rules: same ratio as the video; 9:16 & 16:9 960–3840×540–2160, 1:1 640–1280.
- `GET /file/video/suggestcover/` [D:1740051189071873]: `advertiser_id`*, `video_id`*, `poster_number` 1–10 → `data.list[{id (image id), url (1 h), width, height}]`; wait 30 s–5 min after upload or it errors "Insufficient permissions for some videos".

**D.4 Share / copy — what exists**
- **`POST /creative/asset/share/`** [D:1773192725768193 · SDK AssetShareBody · yml]:
  - `advertiser_id`* (operator = asset owner) · `asset_type` VIDEO (def) | IMAGE | MUSIC · `material_ids`* string[] **1–20** (**material IDs, not video_id/image_id**) · `shared_advertiser_ids`* **1–10**.
  - Needs Admin/Operator on both accounts **and** being the asset owner (so shared-in assets probably cannot be re-shared).
  - Response `data.failed_infos` = `{advertiser_id: [material_id…]}`; "currently fails only when a material with the same name exists in the target"; the **name is copied**.
  - No new video_id/image_id is returned → find them via `/file/video/ad/search/` `filtering.material_ids` (or image search) on the target.
- `UPLOAD_BY_VIDEO_ID` is described as "bind video ID with your advertiser ID" [D:1739953377508354]; cross-advertiser use of a foreign `video_id` is not documented.
- `POST /creative/asset/delete/` [D:1797202997456897]: `video_ids` / `image_ids` ≤50 each → `failed_video_ids` / `failed_image_ids`.
- Fallback = re-upload: `preview_url` → `UPLOAD_BY_URL`, or download + `UPLOAD_BY_FILE`; honour `allow_download=false`.

## E. Identity  [D:1738958351620097 · D:1740218420781057 · D:1740654203526146 · D:1740218453385217 · D:1759155939236865]
Types:
- **CUSTOMIZED_USER**: virtual account used only to display in-feed ads; created by `/identity/create/`.
- **AUTH_CODE**: created when an authorization code for a TikTok post/account is applied.
- **TT_USER**: TikTok Business Account bound to the TikTok For Business account.
- **BC_AUTH_TT**: TikTok account added to a Business Center and approved by its owner; `identity_authorized_bc_id` = that BC; BC asset type `TT_ACCOUNT`. (TTS_TT = Shop account, not an ad value.)
- Spark-capable: AUTH_CODE, TT_USER, BC_AUTH_TT.

Endpoints:
- `GET /identity/get/`: `advertiser_id`*, `identity_type`, `identity_authorized_bc_id` (REQ for BC_AUTH_TT), `filtering{keyword}` (CUSTOMIZED_USER/unspecified; fuzzy display name), `page`, `page_size` 1–100 (def 20).
  - `data.identity_list[]`: identity_id, identity_type, identity_authorized_bc_id, display_name, profile_image (URL), username, available_status (AVAILABLE|NO_VALID_BIND_ACCOUNT|SCOPE_UNAVAILABLE|IS_PRIVATE_ACCOUNT|NOT_BUSINESS_ACCOUNT), can_push_video, can_pull_video, can_use_live_ads, can_manage_message, can_use_showcase, can_use_series, ads_only_mode (BC_AUTH_TT), is_gpppa (true ⇒ no Spark Ads).
  - `page_info` is reliable only when `identity_type` is set. `GET /identity/info/` takes {advertiser_id, identity_id, identity_type[, identity_authorized_bc_id]}.
- `POST /identity/create/`: `advertiser_id`*, `display_name`* (≤100 chars), `image_uri` (avatar image id, 1:1, from `/file/image/ad/upload/`; default image if omitted) → `data.identity_id`. `POST /identity/delete/` {advertiser_id, identity_id, identity_type=CUSTOMIZED_USER}.

BC_AUTH_TT is **not automatic for every ad account of the BC** — a TikTok account must be linked to each ad account:
- `POST /bc/asset/advertiser/assign/` {bc_id, asset_type TT_ACCOUNT|MANAGED_BUSINESS_ACCOUNT, asset_id, advertiser_id}: BC Admin, same BC [D:1846868953025538, D:1848048566169730].
- List `GET /bc/asset/advertiser/assigned/` (page_size ≤50), unlink `POST /bc/asset/advertiser/unassign/` [D:1855027294743554, D:1855027260369921].
- Owner consent: `POST /bc/asset/account/authorization/` {bc_id, is_ads_only_mode} → `bc_auth_qr_code` URL [D:1846868897541122].
- Optional per-member grant: `POST /bc/asset/assign/` (asset_type TT_ACCOUNT + `tt_account_roles` POST | PUBLISH_VIDEO_ADS_ONLY | PUBLISH_VIDEO_SHOW_ON_TT_PROFILE_AND_ADS | LIVE | SHOWCASE | DIRECT_MESSAGE | SERIES) [D:1739438211077121].

Spark mechanics:
- **Push** = a new TikTok post is created from `video_id` + cover (`can_push_video`).
- **Pull** = existing post via `tiktok_item_id` (`can_pull_video`); list with `GET /identity/video/get/` {advertiser_id, identity_id, identity_type, identity_authorized_bc_id, item_type VIDEO|CAROUSEL, exclude_adsonly, cursor, count 1–20} [D:1740218475032577].
- AUTH_CODE: `POST /tt_video/authorize/` {advertiser_id, auth_code}, then `GET /tt_video/list/` (`user_info.identity_id`, `item_info.item_id`; page_size ≤50) [D:1738376435339265, D:1738376465972226, D:1739470744631298].

## F. Pixels  [D:1740858697598978 · D:1753994950327297 · D:1753994966965249 · D:1753994928261122]
- `GET /pixel/list/`: `advertiser_id`*, `code`, `pixel_id`, `name` (fuzzy), `order_by` EARLIEST_CREATE (def) | LATEST_CREATE, `filtering{available_for_catalog_only}`, `page`, `page_size` **1–20** (def 10).
- `data.pixels[]`: pixel_id, pixel_code, pixel_name, pixel_category, pixel_script, pixel_setup_mode, partner_name, create_time, advanced_matching_fields, automatic_advanced_matching_fields, enable_first_party_cookies, enable_expanded_data_sharing, `asset_ownership{asset_relation_status null|TRANSFERRED|SHARED|UNBOUND, ownership_status, owner_bc_id}`, `events[]{name, event_type|custom_event_type, optimization_event, event_id, event_code, statistic_type, rules[], deprecated, currency…}`; plus `page_info`. There is no `pixel_setup_instructions` field in v1.3 (setup snippet = `pixel_script`, mode = `pixel_setup_mode`).
- Sharing is BC-only:
  - `POST /bc/pixel/transfer/` {bc_id, pixel_code} → `data.asset_id` (BC Admin; the pixel's ad account must be owned by / admin-ed by the BC)
  - `POST /bc/pixel/link/update/` {bc_id, pixel_code, advertiser_ids[], relation_status LINK|UNLINK}
  - `GET /bc/pixel/link/get/` {bc_id, pixel_code} → advertisers; `/bc/asset/get/` asset_type PIXEL lists BC pixels; `/bc/asset/assign/` has no PIXEL type
- `SHARED` = "shared with the advertiser as an asset… can modify, cannot delete" (presumably the result of LINK — inferred).

## G. Other advertiser-scoped IDs used by ad groups
- Audiences (custom: customer file / segment / engagement / app activity / website traffic; lookalike): `POST /dmp/custom_audience/share/` {advertiser_id, custom_audience_ids 1–10, shared_advertiser_ids 1–10}, **same Business Center only** [D:1740245803888706].
- Instant forms/pages: per ad account or BC form library (`GET /page/get/` `advertiser_id`|`library_id`; BC asset `LEAD`) [D:1820826387779586].
- Catalogs: BC assets via `/bc/asset/assign/`; the ad group then needs `catalog_authorized_bc_id` [D:1738964064361474].
- CTA/card portfolios: created per advertiser (`/creative/portfolio/*`; CTA portfolios are not listable) [D:1739091950439426, D:1766324010279938].
- Offline event sets / apps: no cross-advertiser mechanism documented.
- Default stance: **do not reuse any of these IDs across advertisers without verifying them in the target.**

## H. Recommended GET → create ALLOWLISTS (faithful SINGLE_VIDEO copy)
Common: `advertiser_id`=TARGET, `adgroup_id`=TARGET; one creative per source ad; send a field only if non-null in GET; `operation_status:"DISABLE"` recommended, enable afterwards.
- **Copy as-is**: ad_name, ad_format=`SINGLE_VIDEO`, ad_text (else ad_texts), call_to_action, landing_page_url, utm_params, deeplink, deeplink_type, deeplink_format_type, fallback_type, deeplink_utm_params, impression_tracking_url, click_tracking_url, creative_auto_enhancement_strategy_list; creative_authorized (non-US only) and disclaimer_* only if present (may be restricted).
- **Remap per target**: identity_id (+identity_type, identity_authorized_bc_id), video_id, image_ids[0], call_to_action_id, tracking_pixel_id, tracking_app_id, page_id, card_id (drop if unresolved).
- **Omit cross-advertiser**: tracking_offline_event_set_ids, tracking_message_event_set_id, music_id, catalog/shopping/vehicle fields (unless the catalog is verified in the target), video_view_tracking_url (not returned by GET).

```jsonc
// 1) CUSTOMIZED_USER (blocked on TikTok placements, see §0.3); placeholders in <>
{"advertiser_id":"<T>","adgroup_id":"<TG>","creatives":[{"ad_name":"…","ad_format":"SINGLE_VIDEO",
 "identity_type":"CUSTOMIZED_USER","identity_id":"<T custom identity>","video_id":"<T video>","image_ids":["<T cover>"],
 "ad_text":"…","call_to_action":"<CTA enum>","landing_page_url":"https://…","aigc_disclosure_type":"NOT_DECLARED","operation_status":"DISABLE"}]}
// 2) Spark Push (TT_USER|BC_AUTH_TT): same, minus aigc_disclosure_type; + identity_authorized_bc_id for BC_AUTH_TT; ad_text REQUIRED; dark_post_status omitted → ON
// 3) Spark Pull: {"identity_type":"BC_AUTH_TT","identity_id":"…","identity_authorized_bc_id":"…","tiktok_item_id":"…","call_to_action":"…"}  — NO video_id, NO image_ids
```
1. **CUSTOMIZED_USER**: `identity_type`, target custom `identity_id`, `video_id`, `image_ids:[cover]`, `aigc_disclosure_type`. Omit tiktok_item_id, dark_post_status, promotional_music_disabled, item_duet/stitch_status; send `display_name`/`avatar_icon_web_uri` only if the API demands them. If the target ad group is blocked → convert to Spark Push.
2. **Spark Push (TT_USER / BC_AUTH_TT; GET has `video_id`)**: identity_type, identity_id, identity_authorized_bc_id (BC_AUTH_TT), video_id, image_ids:[cover], **ad_text REQ**, CTA, dark_post_status (omit → ON), promotional_music_disabled, item_duet_status, item_stitch_status. Omit aigc_disclosure_type, display_name, avatar_icon_web_uri, tiktok_item_id. Every Push creates another TikTok post on that account.
3. **Spark Pull (AUTH_CODE / BC_AUTH_TT / TT_USER; GET `video_id` null, `tiktok_item_id` set)**: identity_type, identity_id, identity_authorized_bc_id (BC_AUTH_TT), tiktok_item_id, CTA, destination/tracking fields. **No** video_id / image_ids; omit ad_text. If GET returns both `video_id` and `tiktok_item_id`, send ONE: `tiktok_item_id` if the target identity has `can_pull_video`, else `video_id`+cover.

**Remap recipes**
- *Video*: source `/file/video/ad/info/` → share (D.4) **or** re-upload (D.2) → wait for processing → resolve the target id with `/file/video/ad/search/` (`material_ids` / `video_name`) → verify via info (`signature`).
- *Cover*: download `video_cover_url` and upload to the target (D.3), or call `/file/video/suggestcover/` on the target video.
- *Identity*: query target `/identity/get/`.
  - CUSTOMIZED_USER → match `keyword`=display_name, else `/identity/create/` (+avatar upload).
  - TT_USER / BC_AUTH_TT → match `identity_id`/`username`; require `available_status=AVAILABLE`, `can_push_video`/`can_pull_video`, `is_gpppa=false`; else link the account (§E).
  - AUTH_CODE → re-apply the code for the target.
- *CTA*: keep the `call_to_action` enum when GET has it; if only `call_to_action_id`, read the source portfolio (`/creative/portfolio/get/`) and recreate it in the target (`/creative/cta/recommend/` → `/creative/portfolio/create/`) or choose a static enum.
- *Pixel*: source `pixel_code` → target `/pixel/list/?code=…`; it must equal the target ad group's `pixel_id`.

## I. Gotchas
- **String IDs everywhere** except `page_id` and `tracking_pixel_id` (numbers, up to 19 digits > 2^53). Quote-wrap them in the raw text (or use a BigInt-safe parser) before `JSON.parse`; send back as numeric literals (string acceptance unknown).
- `preview_url` / `video_cover_url` expire in **6 h**, `image_url` in **1 h** — re-fetch right before download or `UPLOAD_BY_URL`.
- Video processing is **async** (30 s–5 min): upload may return only `video_id`; suggestcover fails until transcoding ends; `/ad/create/` on an unprocessed video is undocumented (`40053` = invalid video id). Images: ~10 s for `is_carousel_usable`.
- File names are unique per advertiser (upload fails, share collides) — append a timestamp/suffix.
- Upload timeout is 10 s; large files → file repository (`/file/start|transfer|finish/upload/`, 20 MB chunks, 24 h `file_id`) then `UPLOAD_BY_FILE_ID` [D:1738963828459521]. WebCrypto lacks MD5 → bundle a JS MD5 for `video_signature` / `image_signature`.
- `allow_download=false` videos (creative-tool music) must not be re-uploaded. `/ad/get/` `image_ids` of Ads-Manager video ads aren't library images → always rebuild the cover.
- Filter sources: `filtering.campaign_automation_type=MANUAL`; skip `is_aco`, SMART_PLUS, UPGRADED_SMART_PLUS* (they use `/ad/aco/*`, `/campaign/spc/*`, `/smart_plus/ad/*`).
- Limits: ≤20 creatives/call, ≤50 ads/ad group (40502), `/ad/create/` 5 QPS/150 QPM; no idempotency key → don't blind-retry (duplicates).
- `dark_post_status` default flipped to ON on 2026-01-27; with identity/advertiser `ads_only_mode` it cannot be OFF.

## J. UNCONFIRMED
1. After `/creative/asset/share/`: target `video_id`/`image_id`, whether `material_id` is kept, same-BC requirement, IMAGE behaviour, re-share of shared-in assets.
2. Whether `UPLOAD_BY_VIDEO_ID` accepts a video owned by another advertiser (permission rules; JSON content-type assumed).
3. Whether a CUSTOMIZED_USER identity works for a second advertiser; whether `/identity/create/` still works for new accounts / TikTok placements.
4. Whether `identity_id` is identical across advertisers for the same TT_USER/BC_AUTH_TT/AUTH_CODE account (docs only say IDs are globally unique); whether one AUTH_CODE can be applied to several advertisers.
5. Interplay of `display_name`/`avatar_icon_web_uri` with `identity_id`; whether `ad_text` is rejected for Spark Pull; sending both `video_id` and `tiktok_item_id`; whether ads-only (dark) Push posts are pullable by another advertiser.
6. `/ad/create/` partial-failure atomicity, idempotency, string acceptance of `page_id`/`tracking_pixel_id`; real GET key `shopping_ads_deeplink_type` vs `shopping_deeplink_type`.
7. CTA-portfolio → static `call_to_action` mapping; cross-advertiser use of `card_id`, `page_id`, offline event sets, apps.
8. Whether `preview_url` bytes equal the original (MD5 == `signature`) — compute MD5 on the downloaded bytes.
9. Scope id for `/bc/asset/advertiser/*`; LIVE_CONTENT identity requirements; the 2027-01-01 sunset banner (only seen in search extracts of official pages); "10,000 ads per Spark identity" appears only in the CN-doc translation (GO), not in current English docs.
10. Rejected third-party claims: a GitHub script sends `status:"DISABLE"` (not a v1.3 field) and assumes an auto-extracted cover when `image_ids` is empty (contradicts D); Zernio docs give no field lists; AdRate (a material-transfer vendor) markets "no native cross-account sharing" although the official API has `/creative/asset/share/`.

## K. Source index
Portal docs via `GET https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=<id>&language=ENGLISH` (public key from the docs web bundle; search endpoint `…/gateway/api/doc/client/search/?identify_key=…&language=ENGLISH&keyword=`).
- Ads: get 1735735588640770 · create 1739953377508354 · update 1739953405142018 · status 1739953422970882 · statuses 1757239620352002 · enums 1737174886619138 · Upgraded Smart+ compatibility 1854112742370306 · Migrate to Spark 1848048566169730 · Spark guide 1739470744631298 · advertiser info 1739593083610113 · copy campaign 1788434533212162 / task 1788434394151938.
- Media: video info 1740050161973250 · search 1740050472224769 · upload 1737587322856449 · image info 1740051721711618 · search 1740052016789506 · upload 1739067433456642 · suggestcover 1740051189071873 · overview 1738963828459521 · share 1773192725768193 · delete 1797202997456897.
- Identity/BC: identities 1738958351620097 · get 1740218420781057 · create 1740654203526146 · info 1740218453385217 · delete 1759155939236865 · video get 1740218475032577 · tt_video authorize 1738376435339265 / list 1738376465972226 · BC link TT 1846868953025538 / auth URL 1846868897541122 / assigned 1855027294743554 / unlink 1855027260369921 · assign 1739438211077121 · asset get 1739432717798401 · page get 1820826387779586 · catalogs in BC 1738964064361474.
- Pixels/audiences/portfolios: pixel list 1740858697598978 · link 1753994950327297 · link get 1753994966965249 · transfer 1753994928261122 · audience share 1740245803888706 · portfolio create 1739091950439426 / get 1739092113671170 / list 1766324010279938.
- Platform: ID uniqueness 1792139804568578 · return codes 1737172488964097 · rate limits 1740029171730433 · permission scope 1753986142651394.
- Other: SDK `python_sdk/business_api_client/models/{ad_create_body,adcreate_creatives,ad_update_body,adupdate_creatives,ad_status_update_body,ad_upload_body,file_image_ad_upload}.py`, `python_sdk/docs/AssetShareBody.md`, `yml_files/creative_asset_share.yml`; AB `airbytehq/airbyte …/source-tiktok-marketing/manifest.yaml`; PD pipedream.com/apps/tiktok-ads-manager/actions/create-or-update-ad; GO github.com/bububa/tiktok-business.
- Local compact copies of every cited doc: `/tmp/hoplite/work-ads-assets/docs/<id>.md` (helpers `fetchdoc.py`, `search.py` in `/tmp/hoplite/work-ads-assets/`).
