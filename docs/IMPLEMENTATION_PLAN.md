# Glowdays — Implementation Plan

Written 31 July 2026, after reading the YouCam documentation properly. Grounded in
`YOUCAM_API_REFERENCE.md`, `APP_ARCHITECTURE_AND_SCREEN_MAP.md` and
`PROTOTYPE_DATASET_AND_MOTION.md`.

---

## Step 0: Scope challenge

Before any architecture, four things the documentation forces us to change. Three
are copy or logic corrections; one is a genuine simplification.

### 0.1 The 24-hour claim has to go (P0, blocking)

Five screens tell the user Perfect Corp deletes the image after 24 hours. The
documented figure is **30 days** for uploaded files, `file_id`s, `task_id`s and
generated media. The 24-hour number in the docs refers to processed results
remaining retrievable, which is a different thing entirely.

Screens carrying the wrong claim:

| Screen | Location of the claim |
|---|---|
| `0470bbef` privacy explainer | numbered item 3 |
| `e0090620` consent sheet | third row of the lavender card |
| `fae9793f` privacy centre | the PROVIDER card |
| `e425c572` delete check-in | "already released their copy after 24 hours" |
| `4d9fd362` delete account | "24-hour retention window runs separately" |

This is not a polish item. It is a factual misstatement about biometric data
handling inside a consent flow, in a product whose own market research
identified Washington's MHMDA (which carries a private right of action) and
Illinois BIPA as existential risks. Ship the wrong number and the consent is
arguably not informed.

Replacement copy, accurate and no longer than what it replaces:
> Perfect Corp holds the image for up to 30 days, then removes it.

And on the deletion screens, the reassurance has to change shape, because we can
no longer claim the provider copy is already gone:
> Deleting here removes our copy immediately. Perfect Corp's own 30-day window runs separately.

### 0.2 Confidence should be measured, not asserted

Currently the user picks a light bucket and ticks "same spot as my baseline".
CameraKit returns actual numbers: lighting level, lighting unevenness (luma
difference between the eyes), face-area ratio, and pitch/yaw/roll in degrees.

This is the difference between an app that *says* two photos are comparable and
one that can *show why*. It is also the product's entire differentiator, so it
should not rest on a checkbox. Self-reported context becomes optional colour;
measured geometry becomes the confidence input.

### 0.3 Webhooks remove the hardest part of the async story

"You can close the app, the result will be waiting" was going to need background
polling. With a webhook plus a push notification it becomes ordinary. Polling
stays as the fallback path only.

### 0.4 Scope reductions

- **Drop `hd_skin_type` from the metric grid.** It is categorical with eight
  values, cannot be differenced, and has no home in a comparison-first UI.
  Keep it out of v1 rather than inventing a place for it.
- **Do not add the other 8 HD metrics** to the UI yet. Request them (they cost
  nothing extra on the same call) and store them, but keep the visible set at 8.
  Storing now means historical data exists when the UI is ready.
- **Verify the "no mask for hydration" screen before shipping it.** The ZIP
  manifest lists `hd_moisture_output.png`. If moisture does return a mask, that
  screen is fiction and should be cut.

---

## 1. Architecture

A server is not optional, for three independent reasons: the API key cannot ship
in a client, webhook delivery needs a stable HTTPS endpoint, and pooled evidence
requires aggregation no client can do.

```
┌────────────────────────────┐
│  Mobile client             │
│  ┌──────────────────────┐  │
│  │ CameraKit (native)   │  │  quality gate happens here,
│  │  lighting / ratio /  │  │  before any bytes leave the device
│  │  pitch,yaw,roll      │  │
│  └──────────┬───────────┘  │
│             │ capture + metrics
└─────────────┼──────────────┘
              │ HTTPS (our auth)
              ▼
┌──────────────────────────────────────────────────┐
│  Glowdays API                                    │
│                                                  │
│  POST /scans          ── holds YouCam key        │
│    ├─ validate tier gate (HD needs >=1080px)     │
│    ├─ store image in private bucket              │
│    ├─ POST /s2s/v2.0/file  ──────────┐           │
│    ├─ PUT bytes to pre-signed url  ◄─┘           │
│    ├─ POST /s2s/v2.1/task/skin-analysis          │
│    └─ persist task_id + tier + metrics           │
│                                                  │
│  POST /webhooks/youcam  ── Standard Webhooks     │
│    ├─ verify HMAC-SHA256                         │
│    ├─ dedupe on webhook-id                       │
│    ├─ GET task result, parse raw_score only      │
│    └─ push "your comparison is ready"            │
│                                                  │
│  GET  /comparisons/{a}/{b} ── confidence engine  │
│  GET  /evidence/{product}  ── n>=30 gate         │
└───────────────┬──────────────────────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
   Postgres          Private object store
   (scores,          (images, masks)
    metrics,          never public
    trials)
```

Boring by default: Postgres, a single API process, object storage, one queue for
retries. No innovation tokens spent on infrastructure — they belong in the
confidence engine.

### 1.1 Data model, corrected

`scan` belongs to `profile`, never to `trial` (the §1.7 restructure). A `trial`
is a window that claims scans by date range.

```
profile ──┬── scan ──┬── scan_metric   (metric, region, raw_score, ui_score)
          │          ├── scan_mask     (metric, region, storage_key)
          │          └── capture_quality (the CameraKit numbers)
          │
          ├── trial (starts_at, ends_at, product_id, predicted_metric,
          │          locked_at, single_variable bool)
          ├── product
          └── note (date, body, tags)   -- may be backdated; photos may not
```

`capture_quality` is the new table and the important one:

| Column | Source |
|---|---|
| `tier` | `hd` or `sd`, decided by short-side pixels |
| `lighting_level` | CameraKit, 0–1 |
| `lighting_uneven` | CameraKit, 0–1, luma difference between eyes |
| `face_ratio` | CameraKit, 0.55–1.0 |
| `pitch`, `yaw`, `roll` | CameraKit, degrees |
| `preset` | which preset was active at capture |
| `light_bucket` | user-declared, optional, colour only |

Store `raw_score` as the comparison value. Store `ui_score` too, unused, so we
never have to re-run analysis to explain a discrepancy.

---

## 2. The confidence engine

Two scans are comparable when they were taken with the same instrument under
similar geometry. Now computable.

```
                    ┌─────────────────────────┐
   scan A ─────────►│  same tier?             │──no──► REFUSE
   scan B ─────────►│  hd vs sd               │        (screen 05e549d4)
                    └───────────┬─────────────┘
                                │ yes
                                ▼
                    ┌─────────────────────────┐
                    │  Δlighting_level        │
                    │  Δlighting_uneven       │
                    │  Δface_ratio            │
                    │  Δyaw, Δpitch, Δroll    │
                    │  days between           │
                    └───────────┬─────────────┘
                                ▼
              ┌─────────────────────────────────────┐
              │ all deltas inside tight band        │──► Comparable capture
              │ one condition outside               │──► Directional check
              │ two or more outside, or framing     │──► Treat with care
              │ fewer than two usable scans         │──► Not enough evidence
              └─────────────────────────────────────┘
```

Proposed opening bands, to be calibrated against the σ study in Stage 0 of the
market-research plan:

| Signal | Comparable | Directional |
|---|---|---|
| Δ lighting_level | ≤ 0.10 | ≤ 0.20 |
| Δ lighting_uneven | ≤ 0.05 | ≤ 0.10 |
| Δ face_ratio | ≤ 0.05 | ≤ 0.10 |
| Δ yaw / pitch / roll | ≤ 3° | ≤ 7° |
| Days apart | 7–90 | 3–180 |

These are starting numbers, not findings. They must be labelled as provisional
in code, because the honest threshold for "this movement is not a finding" needs
the vendor's per-metric repeat-measurement spread, which is unpublished.

Hard rule that already exists in the UI and must exist in code: never subtract
an HD score from an SD score. The refusal is a feature.

---

## 3. Capture flow

The gate that matters: **HD needs a short side of at least 1080px, and the face
must exceed 60% of image width.** CameraKit's `720p` cannot satisfy HD.

```
open camera
   │
   ├─ request permission ──denied──► screen 40b8c248 (camera access off)
   │
   ├─ CameraKit init: mode hdskincare, videoQuality 1080p, preset MODERATE
   │     └─ device cannot do 1080p ──► fall back mode skincare (SD), tell the user
   │
   ├─ faceQualityChanged loop: shutter stays disabled until
   │     hasFace && position==good && frontal==good && lighting in (good|ok)
   │
   ├─ faceDetectionCaptured ──► review screen with the measured numbers
   │     └─ short side < 1080 ──► SD tier, screen abd29ee1
   │
   ├─ consent (screen e0090620, corrected copy)
   │
   └─ POST /scans
```

Using MODERATE rather than STRICT is a deliberate call. STRICT wants face ratio
≥0.75, yaw within ±5° and lighting 0.80–0.90, which will reject a lot of real
bathrooms. MODERATE keeps capture achievable while still tight enough that
confidence means something. The preset used is recorded per scan, so the choice
is auditable and changeable later.

---

## 4. Error handling

Every documented failure needs a destination. Gaps are marked.

| API error | User-facing meaning | Screen |
|---|---|---|
| `error_src_face_too_small` | move closer | **GAP** |
| `error_lighting_dark` | too dark | **GAP** |
| `error_no_face` | no face found | **GAP** |
| `error_multiple_people` | more than one face | **GAP** |
| `error_large_face_angle` | turned too far | **GAP** |
| `error_below_min_image_size` | resolution too low | partly `abd29ee1` (SD fallback) |
| `error_nsfw_content_detected` | rejected | **GAP**, needs careful wording |
| `InvalidTaskId` after expiry | window closed | `96a5d67a` ✓ |
| mixed HD/SD request | must never reach the API | `05e549d4` ✓ |
| `task_status: error` | did not finish | `bfaa5a8a` ✓ |
| `429` | too many requests | server-side backoff, invisible to user |

Five of these gaps are pre-flight conditions CameraKit can catch on-device
before an upload happens, which is the cheaper place to handle them: a
disabled shutter with a reason beats a failed analysis. `error_multiple_people`
and `error_nsfw_content_detected` still need real screens.

---

## 5. Phasing

**Phase 1 — prove the instrument.** Auth, File API, one HD task, parse
`score_info.json`, store raw scores. Exit test: the same face photographed twice
in one sitting produces two score sets, and their difference tells us the
per-metric noise floor. That number decides whether the product is viable at
all, and the market-research plan already names it the kill criterion (σ > ~8
raw points).

**Phase 2 — capture that earns confidence.** CameraKit integration, tier gate,
`capture_quality` persistence, the four confidence labels, and the HD/SD refusal.

**Phase 3 — the diary.** Scans owned by profile, timeline, calendar with
retrospective notes, rhythm. No trial logic yet — the diary has to stand alone,
per the restructure.

**Phase 4 — trials as annotation.** Pre-registration, single-variable detection,
the two-variable state, one active trial at a time.

**Phase 5 — pooled evidence.** Only after enough real trials exist. Until then
the withheld state is the live experience, which the design already accepts.

Webhooks belong in Phase 1, not later. Retrofitting them after building polling
means writing the hard path twice.

---

## 6. Tests

Full coverage of the confidence engine is non-negotiable — it is the product
claim, and a wrong "comparable" label is worse than no label.

| Path | Test | Kind |
|---|---|---|
| HD vs SD pair | refuses, returns reason | unit |
| identical conditions | Comparable capture | unit |
| one condition off | Directional check | unit |
| two off | Treat with care | unit |
| one scan only | Not enough evidence | unit |
| boundary values on every band | table-driven, both sides of each threshold | unit |
| File API without the PUT | surfaces a clear internal error, not a 404 mystery | integration |
| webhook signature | valid passes, tampered body fails, replayed `webhook-id` is ignored | unit |
| webhook before task row commits | queued, not dropped | integration |
| 2-hour URL expiry | re-mints via `task_id` | integration |
| 429 | backs off, eventually succeeds | integration |
| task expiry | InvalidTaskId maps to the window-closed screen | integration |
| tier gate | 1079px short side goes SD, 1080 goes HD | unit |
| trial claims scans by date | scan inside window is claimed, outside is not | unit |
| deleting a scan | image, scores, masks all removed | integration |

The regression rule applies to the metric-direction legend: acne going 71 → 69
is a *decline*, and the earlier UI implied improvement. That needs a test
asserting sign handling per metric, since it was a real defect.

---

## 7. NOT in scope

| Deferred | Why |
|---|---|
| The other 8 HD metrics in the UI | request and store them, surface later |
| `hd_skin_type` | categorical, no home in a comparison UI |
| `skin_age` | invites the vanity framing the product exists to avoid |
| `ui_score` anywhere in the UI | vendor states it is adjusted for comfort |
| Product recommendations | contradicts the non-goals, creates claim-substantiation exposure |
| Pooled evidence at launch | needs ~30 trials per product to say anything |
| Dark mode, tablet | no user demand evidenced yet |
| Public image URLs | our images are private by design |

## 8. What already exists

The 100-screen prototype covers the flows, including error and edge states. Nine
of the ten mapped API errors have a screen or a clear owner. The dataset doc
fixes canonical values so implementation has fixtures ready. The architecture doc
already carries the corrected diary-first model.

What does not exist: any code, the σ study, a DPA, and per-call pricing.

## 9. Failure modes worth naming now

| Codepath | Realistic production failure | Covered? |
|---|---|---|
| webhook endpoint | delivery arrives before the task row is committed | needs a queue; test listed above |
| webhook endpoint | attacker posts a forged success | signature verification, mandatory |
| result download | 2-hour URL expires while a retry is queued | re-mint from `task_id` |
| polling fallback | naive interval trips the 250/300s limit | budget per-IP, back off |
| tier gate | device reports 1080p but delivers less | measure the actual bytes, never trust the label |
| confidence engine | provisional thresholds shipped as if calibrated | label them provisional in code and in the UI |
| deletion | our copy goes, provider copy lives 30 days | say so plainly; do not imply otherwise |

The last one is the P0 again. It is the only item on this list that is currently
*wrong in the product* rather than merely unbuilt.
