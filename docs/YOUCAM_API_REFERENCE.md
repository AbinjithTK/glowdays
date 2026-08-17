# YouCam API Reference (Perfect Corp) — Glowdays implementation notes

Compiled 31 July 2026 from the official documentation. Primary sources:

- [Introduction](https://docs.perfectcorp.com/develop/introduction) — doc version v1.14
- [Quick Start Guide](https://docs.perfectcorp.com/develop/quick_start_guide)
- [API Server](https://docs.perfectcorp.com/develop/api_server)
- [Rate Limit](https://docs.perfectcorp.com/develop/rate_limit)
- [File Retention Period](https://docs.perfectcorp.com/develop/file_retention_period)
- [Error Codes](https://docs.perfectcorp.com/develop/error_codes)
- [Webhook](https://docs.perfectcorp.com/develop/webhook)
- [AI Skin Analysis v2.1](https://docs.perfectcorp.com/reference/ai_skin_analysis/v2.1)
- Machine-readable spec: [ai_skin_analysis.yaml](https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.yaml?download) / [.json](https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.json?download)

Content was rephrased for compliance with licensing restrictions. Figures, field
names, enums and thresholds are reproduced as factual data.

---

## 0. Corrections to earlier Glowdays assumptions

Read this section first. Four things we designed around were wrong.

| # | We assumed | Documentation says | Impact |
|---|---|---|---|
| 1 | Provider deletes the image after **24 hours** | Uploaded files and their `file_id` are kept **30 days**. Generated images are also removed at 30 days. The 24-hour figure applies to *processed results* being available for polling, not image deletion. | **P0.** Privacy copy on at least 5 screens states 24 hours. It understates vendor retention by 30x, in a biometric consent flow. |
| 2 | Only v2.0 exists | **v2.1** is current: newer engines, output up to 2560px, automatic input resizing | Use v2.1 paths |
| 3 | Polling is the only completion mechanism | **Webhooks are the documented preference**; polling is the fallback | Simplifies "close the app, result will be waiting" |
| 4 | The confidence engine must be invented | **CameraKit** returns real lighting, face-area and head-pose metrics, with STRICT/MODERATE/RELAXED presets and numeric thresholds | Confidence can be grounded in vendor metrics rather than our own guesswork |

Also newly available and currently unused by the design: `all.score` (overall
condition), `skin_age`, and `hd_skin_type` with `whole` / `t_zone` / `u_zone`
subcategories.

---

## 1. Authentication and servers

Bearer token in the request header:

```
Authorization: Bearer YOUR_API_KEY
```

Keys are issued and managed in the API console: `https://yce.makeupar.com/api-console/en/api-keys/`

| Purpose | Host |
|---|---|
| API server | `https://yce-api-01.makeupar.com` |
| MCP server (already wired into Kiro) | `https://mcp-api-01.makeupar.com/mcp` |

Units are purchased or subscribed. Usage is visible in the console.

---

## 2. The request lifecycle

```
1. POST /s2s/v2.0/file                  -> file_id + pre-signed PUT url
2. PUT  <pre-signed url>                -> actual bytes (MANDATORY, separate step)
3. POST /s2s/v2.1/task/skin-analysis    -> task_id
4. webhook (preferred) or GET poll      -> task_status
5. GET  /s2s/v2.1/task/skin-analysis/{task_id} -> results
```

**Step 2 is the classic trap.** Calling the File API does not upload anything —
it only issues a destination. Skipping the PUT produces a 500
`unknown_internal_error` or a 404 later, at task creation, where the cause is
not obvious.

### 2.1 File API

`POST /s2s/v2.0/file`

```json
{
  "files": [
    { "content_type": "image/png", "file_name": "scan.png", "file_size": 547541 }
  ]
}
```

Response carries `data.files[].file_id` and `data.files[].requests[]`, each
request having `method` (PUT), `url`, and required `headers`
(`Content-Length`, `Content-Type`). Upload with exactly those headers.

A publicly reachable `src_file_url` may be used instead of uploading, which
Glowdays will not do — our images are private by design.

### 2.2 Create the task

`POST /s2s/v2.1/task/skin-analysis`

| Field | Type | Notes |
|---|---|---|
| `src_file_id` **or** `src_file_url` | string | one of the two, not both |
| `dst_actions` | string[] | required; see §3. HD and SD cannot be mixed |
| `format` | `"zip"` \| `"json"` | default `zip`. Response schema differs between them |
| `miniserver_args` | object | mask rendering controls, §4 |
| `pf_camera_kit` | boolean | set true when the image came from CameraKit |

Returns `data.task_id`.

### 2.3 Retrieve

`GET /s2s/v2.1/task/skin-analysis/{task_id}`

`data.task_status` is `running`, `success`, or `error`. With `format=zip`,
success gives `data.results` as a download URL. With `format=json`, results
come back inline as `data.results.output[]`, each entry having `type`,
`ui_score`, `raw_score`, `mask_urls[]`.

---

## 3. dst_actions

Two tiers, **never mixed in one call**. Mixing returns HTTP 400
`InvalidParameters` with an explicit "cannot mix HD and SD" message. A
misspelled action returns the same error code naming the bad action.

### HD (16)

`hd_redness`, `hd_oiliness`, `hd_age_spot`, `hd_radiance`, `hd_moisture`,
`hd_dark_circle`, `hd_eye_bag`, `hd_droopy_upper_eyelid`,
`hd_droopy_lower_eyelid`, `hd_firmness`, `hd_texture`, `hd_acne`, `hd_pore`,
`hd_wrinkle`, `hd_tear_trough`, `hd_skin_type`

### SD (16)

`wrinkle`, `droopy_upper_eyelid`, `droopy_lower_eyelid`, `firmness`, `acne`,
`moisture`, `eye_bag`, `dark_circle_v2`, `age_spot`, `radiance`, `redness`,
`oiliness`, `pore`, `texture`, `tear_trough`, `skin_type`

### Subcategorised metrics

| Action | Subcategories |
|---|---|
| `hd_pore` | forehead, nose, cheek, whole |
| `hd_wrinkle` | forehead, glabellar, crowfeet, periocular, nasolabial, marionette, whole |
| `hd_texture` | whole |
| `hd_acne` | whole |
| `hd_skin_type` / `skin_type` | whole, t_zone, u_zone |

`hd_skin_type` is **categorical, not a score**. Its eight values: Normal, Oily,
Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness.
It cannot participate in any numeric comparison and has no home in the current UI.

---

## 4. Scores

`score_info.json` (inside the ZIP) and the JSON response share semantics.

| Field | Type | Meaning |
|---|---|---|
| `raw_score` | float, 1–100 | The engine's number. Higher is a better condition. |
| `ui_score` | integer, 1–100 | Raw score deliberately adjusted upward for user comfort. |
| `output_mask_name` | string | Filename of the matching mask PNG |
| `all.score` | float | Overall skin condition |
| `skin_age` | integer | AI-derived skin age vs population |

The documentation is candid that `ui_score` is a psychological motivator —
scores are adjusted to read more favourably because users prefer positive
assessments. **Glowdays must store and compare `raw_score` only.** The existing
"How scores work" screen already says this and is now citable.

Higher-is-better holds for every metric, including acne and redness. This is
what the all-metrics legend fix was about.

### Mask output

Default: one PNG per concern, transparent, meant to be alpha-composited over the
original. With `miniserver_args.enable_mask_overlay = true` you get a single
pre-blended JPG instead.

Per-concern dark-background controls exist as
`enable_dark_background_hd_<concern>`, `color_dark_background_hd_<concern>`
(hex, no `#`), `opacity_dark_background_hd_<concern>` (0–1).

ZIP layout: a `skinanalysisResult/` folder holding `score_info.json` plus masks
named `hd_<concern>_output.png`, with regional variants suffixed
(`hd_pore_output_forehead.png`, `hd_pore_output_all.png`,
`hd_wrinkle_output_crowfeet.png`, and so on).

Note: `hd_moisture`, `hd_radiance`, `hd_firmness` and friends do have mask
files listed. The "no mask for hydration" screen we built may therefore be
wrong — verify against a live response before shipping it.

---

## 5. Image requirements

| Tier | Min short side | Max long side | Size | Formats |
|---|---|---|---|---|
| SD | 480 px | auto-resized down to 2560 px | < 10 MB | jpg, jpeg, png |
| HD | **1080 px** | auto-resized down to 2560 px | < 10 MB | jpg, jpeg, png |

Hard constraint: **face width must exceed 60% of image width**; the guidance
target is 60–80%. Portrait orientation is recommended over landscape.

Capture guidance from the docs: even bright lighting without blown highlights,
front-facing neutral pose, mouth closed, eyes open, forehead unobstructed, hair
back, glasses off (recommended, not mandatory), makeup removed for accuracy, no
motion blur or occlusion.

### Skin-analysis-specific error codes

| Code | Meaning |
|---|---|
| `error_below_min_image_size` | Resolution too small |
| `error_exceed_max_image_size` | Resolution too large |
| `error_src_face_too_small` | Face under the 60%-of-width rule |
| `error_src_face_out_of_bound` | Face partly outside the frame |
| `error_lighting_dark` | Too dark |

### Platform-wide error codes

`exceed_max_filesize`, `invalid_parameter`, `error_download_image`,
`error_decode_image`, `error_nsfw_content_detected`, `error_no_face`,
`error_pose`, `error_face_parsing`, `error_inference`, `error_upload`,
`error_multiple_people`, `error_large_face_angle`, `error_unsupport_ratio`,
`unknown_internal_error`.

`error_multiple_people` and `error_no_face` both need UI states we do not have.

---

## 6. Rate limits

250 requests per 300 seconds **per IP** and 250 per 300 seconds **per access
token**. Both must hold; violating either returns `429`. Recommended pacing is
about 5 requests/second. Implement backoff and retry.

At Glowdays' scale this only bites if polling is naive: one user polling every
2 seconds for 90 seconds is 45 requests. Twenty concurrent analyses would
approach the ceiling from a single server IP. Another reason to prefer webhooks.

---

## 7. Retention — the corrected numbers

| Thing | Lifetime |
|---|---|
| Uploaded file and its `file_id` | **30 days** |
| `task_id` | **30 days** |
| Result download URL | **2 hours** |
| All uploaded and generated media | removed at **30 days** |
| Processed results available for polling after completion | 24 hours |

If the 2-hour download URL lapses, re-query with the `task_id` to mint a new
one. If a running task is not polled inside its window it can expire, later
status checks can return `InvalidTaskId` even though processing finished, and
units may still have been charged.

**This is the P0.** Every screen saying the provider holds the image for 24
hours is wrong: privacy explainer, consent sheet, privacy centre, delete
check-in, delete account.

---

## 8. Webhooks (preferred over polling)

Configured in the console at `https://yce.makeupar.com/api-console/en/webhook/`,
up to 10 endpoints. Follows the [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
specification. Use an official Standard Webhooks library rather than
hand-rolling verification.

Delivery is a `POST` with headers `webhook-id`, `webhook-timestamp`,
`webhook-signature`, and a body of `created_at` plus
`data.task_id` / `data.task_status`.

Signing: HMAC-SHA256. The secret is base64 with a `whsec_` prefix — strip the
prefix and base64-decode before use. Signature input is
`{webhook-id}.{webhook-timestamp}.{raw-minified-json-body}`, and
`webhook-signature` is `v1,<base64 hmac>`.

`webhook-id` is stable across retries, so key idempotency on it.

The payload carries only status, never scores. Fetch results with the
`task_id` afterwards.

---

## 9. CameraKit — the confidence engine we were going to invent

Both a JS SDK and a mobile SDK (Android/iOS) perform real-time quality
validation before capture. This is the single most valuable discovery for
Glowdays: the "comparable capture" logic can be built on vendor metrics.

JS SDK: `https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js`, global
`YMK`, requires HTTPS, a `<div id="YMK-module">` mount point, and
`window.YMKAsyncInit` defined before load. Mobile CameraKit is v2.5.0
(Apr 2026); Android needs API 23+, iOS 12+.

Relevant `faceDetectionMode` values: `skincare`, `hdskincare` (needs a
2560px-capable camera), and `comprehensive`.

`videoQuality` accepts `720p`, `1080p`, `1920p` (2560x1920) and is only
supported for `skincare` / `hdskincare`. **HD analysis needs 1080px minimum on
the short side, so `720p` cannot feed HD.**

### Quality presets and thresholds

| Parameter | STRICT | MODERATE | RELAXED |
|---|---|---|---|
| Face size ratio (min) | 0.75 | 0.65 | 0.55 |
| Yaw | ±5° | ±10° | ±15° |
| Pitch upper | 0° | +5° | +10° |
| Pitch lower | −10° | −15° | −20° |
| Lighting lower | 0.80 | 0.70 | 0.55 |
| Lighting upper | 0.90 | 0.85 | 0.80 |
| Lighting unevenness (max luma difference between the eyes) | 0.10 | 0.15 | 0.20 |

Perfect Corp's own recommendation for skin analysis is STRICT or MODERATE.
Custom overrides may not be looser than RELAXED. Roll is also constrained
(±5/±10/±15).

### Events

`faceQualityChanged` fires continuously with `hasFace` (bool), `position`
(`good` / `notgood` / `toosmall` / `outofboundary`), `frontal`
(`good` / `notgood`), `lighting` (`good` / `ok` / `notgood`).
`faceDetectionCaptured` fires after validation passes, returning
`images[]` with `phase`, `image` (base64 or Blob), `width`, `height`.
`cameraFailed` reports `error_permission_denied`,
`error_resolution_unsupported`, `error_access_failed` — which maps onto our
camera-access-off screen.

Mobile exposes `lightingQuality` with named states GOOD, NORMAL,
OVER_EXPOSED, UNDER_EXPOSED, **BACKLIGHTING**, UNEVEN; `faceAreaQuality` with
GOOD, TOO_SMALL, OUT_OF_BOUNDARY; `facePoseQuality` with GOOD, BAD plus a
numeric yaw via `getFacePoseDegree()`.

**Implication for the design.** Our capture-conditions model currently records a
user-selected light bucket (Daylight / Indoor / Mixed) and a self-reported
"same spot" checkbox. Both can be replaced by measured values: lighting level,
lighting unevenness, face ratio, and pitch/yaw/roll in degrees. Confidence
stops being a judgement we assert and becomes a computation over recorded
numbers — which is the product's central claim.

---

## 10. Billing behaviour

Units are consumed only when a task reaches `success`. A task ending in `error`
costs nothing. Polling a `running` task costs nothing. Units nearest expiry are
deducted first. A task abandoned mid-flight may still be charged.

Per-call price is not published; it is quote-based. This remains the largest
open number in the business case.

---

## 11. Still unknown

- Per-unit pricing and how many units one skin-analysis call consumes.
- Whether a Data Processing Agreement is available, and where processing occurs
  (the pre-signed URLs seen in docs are `yce-us` S3 buckets — a GDPR transfer
  question).
- Test-retest variance per metric. Vendor marketing claims 95% test-retest
  reliability; the raw σ per metric is what our "not a finding" threshold needs
  and it is not published.
- Whether `hd_moisture` genuinely returns a usable mask.
- Whether the 30-day retention is configurable by contract.
