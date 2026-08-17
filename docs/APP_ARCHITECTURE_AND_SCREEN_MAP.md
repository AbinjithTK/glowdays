# Glowdays â€” real-app architecture and complete screen map

**Status:** implementation plan, written to be built not mocked
**Date:** 2026-07-27
**Provider surface verified against:** live YouCam MCP server (`mcp-api-01.makeupar.com`, `youcam-mcp 1.0.0`) tool schemas, 2026-07-27. The published HTML docs at `docs.perfectcorp.com` are behind a JS/cookie wall and would not render, so the concern lists below come from the machine-readable tool schema rather than the docs site.

---

## 1. What the provider actually gives us

### 1.1 Two analysis tiers, and they cannot be mixed

`AI_Skin_Analysis` takes a `dst_actions` array. Every entry must be HD or every entry must be SD. Mixing is rejected.

| Tier | Concerns available |
| --- | --- |
| HD (16) | `hd_moisture`, `hd_radiance`, `hd_texture`, `hd_pore`, `hd_wrinkle`, `hd_acne`, `hd_oiliness`, `hd_redness`, `hd_age_spot`, `hd_firmness`, `hd_dark_circle`, `hd_eye_bag`, `hd_tear_trough`, `hd_droopy_upper_eyelid`, `hd_droopy_lower_eyelid`, `hd_skin_type` |
| SD (16) | `moisture`, `radiance`, `texture`, `pore`, `wrinkle`, `acne`, `oiliness`, `redness`, `age_spot`, `firmness`, `dark_circle_v2`, `eye_bag`, `tear_trough`, `droopy_upper_eyelid`, `droopy_lower_eyelid`, `skin_type` |

The tool guidance is to attempt HD first and fall back to SD when the source image is too small.

**Product consequences**

1. A scan record must store which tier produced it.
2. **An HD raw score must never be differenced against an SD raw score.** Two tiers are two instruments. This needs its own comparison-blocked state, not a silent comparison.
3. Tier fallback is user-visible information, phrased as capture quality, never as failure.

### 1.2 Two concerns are regional, not single numbers

- `hd_pore` returns forehead, nose, cheek, and whole.
- `hd_wrinkle` returns forehead, glabellar, crowfeet, periocular, nasolabial, marionette, and whole.

So "Pore appearance" is four numbers and "Wrinkles" is seven. A single row cannot represent either honestly. The metric detail screen needs a regional breakdown, and the summary row must show the `whole` value with the regions behind a tap.

### 1.3 Output formats

- `format: "json"` returns scores in the response body.
- `format: "zip"` returns a downloadable archive containing `score_info.json` plus per-concern mask images. Response schemas differ between the two.
- `miniserver_args.enable_mask_overlay`: true returns the mask blended onto the photo as a `.jpg`; false returns the raw mask as a transparent `.png`. Per-concern dark-background colour and opacity are also tunable (`color_dark_background_hd_*`, `opacity_dark_background_hd_*`).

**Product consequence:** request `zip`, persist `score_info.json` and every mask to private storage, and serve masks through an access-checked route. Use `enable_mask_overlay: false` and composite in the client, so the raw mask stays reusable and the face image is never baked into a derived artefact we cannot separate later.

### 1.4 Scores

Public product material states scores run 1â€“100 with higher meaning better condition, and claims a 95% test-retest reliability rate ([Perfect Corp skin analysis product page](https://yce.perfectcorp.com/nl/ai-api/products/ai-skin-analysis-and-api), [API product page](https://yce.perfectcorp.com/ai-api/products/skin-analysis-api)). Content rephrased for licensing compliance.

Treat the reliability claim as vendor-supplied and unverified. Our own test-retest measurement (two scans of the same face in one sitting) remains a prerequisite before any pooled-evidence feature ships, because the noise floor sets the smallest delta we are allowed to call movement.

Keep raw provider score and any UI-normalised score in separate columns. Never overwrite raw.

### 1.5 The pipeline is asynchronous and tasks expire

File API returns an upload URL and a `file_id`; the file must be PUT to exactly that URL or the AI call fails with a 500 or 404. The AI call returns a `task_id`, and the client polls until `success` or `error`. Polling after the task times out returns `InvalidTaskId`.

**Product consequence â€” this is the single biggest driver of screen count.** A scan is a durable local record that moves through states, not a request-response. Required states: `draft`, `uploading`, `queued`, `running`, `succeeded`, `failed`, `expired`. Each needs UI. `expired` in particular must not look like data loss, because the photo is still ours.

### 1.6 Adjacent APIs, deliberately not in v1

Available on the same server and explicitly out of scope: hair colour/style/extension/bang/volume/frizziness/type, beard styles, makeup and look try-on, face reshape, body reshape, nail/earring/necklace/ring/watch/bracelet try-on, aging generator, headshot/avatar/studio generators, face swap, image generation, background change, object removal.

Two are worth a P2 note. `AI_Skin_Tone_Analysis` could record skin tone as stable capture context. `AI_Face_Analyzer` exposes a `face_angle_strictness_level` of strict / high / medium / low / flexible, which is a ready-made model for gating capture geometry. Everything else belongs to a different product and would dilute this one.

---

## 1.7 The core model — read this before changing any screen

**The diary is the spine. A trial is an annotation over a span of it.**

A check-in is a measurement of a person's face at a moment in time. It belongs to the **profile**, not to a trial. It remains true and remains theirs when a trial ends, when they stop using a product, and when they were testing nothing at all.

A trial is a window laid over the timeline with a hypothesis declared in advance: from this date, for this many weeks, testing this one product, expecting this metric to move. It **claims** the check-ins that fall inside its window. It does not contain them.

A comparison pulls two check-ins from the diary. The trial contributes one thing only: the reason a particular metric is the headline rather than another.

### Why this matters

| Under the wrong model (trial owns check-ins) | Under the correct model |
| --- | --- |
| Data is trapped in a container that closes | The timeline is continuous and permanent |
| You cannot check in without a trial | Check-ins need no reason |
| Today has nothing to show between trials | Today always has the diary |
| A comparison reads as "the product's result" | A comparison reads as "what changed between two dates" |

That last row is the important one. Presenting a comparison as a product's result is the causal claim this product exists to avoid making.

### Consequences for structure

- At most **one active trial** at a time. Overlapping trials are confounded by definition. Check-ins continue regardless of whether one is running.
- Today leads with the diary and the next check-in. An active trial appears as secondary context, a chip, never the screen title.
- The capture flow does not belong to a trial. It records a check-in; an active trial claims it silently.
- Diary is the primary destination. Trials is a lens on the timeline, not a parallel list of containers.
- There is no "trial switcher" as primary navigation. What is needed instead is a **no-trial-running** state.

### States this model requires

1. Today, no trial running — the app's most common condition.
2. Today, trial running — trial as chip.
3. Trial just ended — the window closed, the check-ins remain.
4. Check-in recorded outside any trial.

---

## 1.8 Entry flow v2 — diagnosis first, and the exploratory trial

§1.7 fixed who owns a check-in. This section fixes how a trial starts.

### The problem with the v1 entry

v1 requires the user to name a product and predict a metric **before** their first
scan. That ordering is what makes the trial pre-registered, and pre-registration is
what makes the result honest. But it asks someone who does not yet know anything
about their own skin to commit to a hypothesis, which is a genuine onboarding
failure. The intuitive flow is the opposite: scan, see what is weakest, choose a
product for it, track whether it improves.

### Why the intuitive flow cannot simply be adopted

Choosing your **lowest** metric and then measuring whether it rises is measuring
regression to the mean, not the product.

Any single reading is part skin and part circumstance: sleep, hydration, the light
in the room, where you were in your cycle, whether you had just washed your face.
The unusual portion of a low reading is by definition not repeatable, so the lowest
metric tends to rise on the next scan whatever the user changes. A product selected
this way will appear to work almost every time.

This is the exact false confirmation the product exists to refuse, so the flow
cannot be adopted as stated.

### Resolution: keep the flow, label the trial

Do not block the intuitive path. Record what kind of evidence it can produce. This
mirrors the existing treatment of confounded trials, which keep running, carry a
mark, and are excluded from pooling.

| | Pre-registered | Exploratory |
|---|---|---|
| Metric named | before the first scan | after seeing scores |
| Runs normally | yes | yes |
| Comparisons and confidence labels | yes | yes |
| Joins pooled evidence | yes | **no** |
| Vulnerable to regression to the mean | no | yes |

Both are first-class. The difference is what may be inferred from them, and only
pre-registered trials feed the pooled-evidence gate.

A stronger variant, deferred: require two baseline scans before a trial may target a
metric, so the target is chosen against a stable estimate rather than one reading.
Correct, but it charges the user two weeks before they can start, which is a real
onboarding tax. Revisit once the test-retest study gives per-metric noise figures.

### Consequences for structure

- The results of a first scan become a **profile**, not a verdict. The concern list
  is ordered lowest score first and is explicitly framed as starting points.
- The regression warning belongs **in the flow, at the point of choosing**, not in a
  help screen nobody opens.
- `trial` gains a kind: `pre_registered` or `exploratory`, set at creation from
  whether a baseline scan already existed. It is never user-editable.
- Trial detail displays the kind, and pre-registered trials state that naming the
  product first is what lets them join pooled results.
- Pooling filters on kind in addition to the existing single-variable, tier and
  confidence gates.

### Daily scanning

Requested, and already handled correctly by existing components rather than needing
new ones. Daily **logging** is fine. Daily **conclusions** are not: the confidence
engine only pairs scans far enough apart for a routine to have plausibly acted, and
the working band is 7 to 90 days. So a user may check in as often as they like and
the comparison engine will decline to pair scans a day apart.

Two further reasons not to encourage it: every analysis consumes billable units, and
the retention strategy's release gate forbids daily engagement loops.

### Forbidden vocabulary

Never *cure*, *treat*, *heal*, or *clear up*. Cosmetic products do not cure anything,
and cure language moves the product from cosmetic claims into drug claims, which is
the claim-substantiation exposure identified in the market research. Say "whether it
improved" or "whether the score moved".

### Screens this adds

| Screen | Purpose | Built |
|---|---|---|
| What stands out | first-scan profile, lowest scores first, regression warning | `f049f317` |
| Start an exploratory trial | product and metric carried from a concern, explains the trade | `fa92bec4` |
| Trial detail | now carries a `Pre-registered` badge and the pooling rationale | `5792dcff` |

---

## 2. Components to build

### 2.1 Data model

```text
profile            id, created_at, deleted_at
scan               id, profile_id, state, tier(hd|sd), captured_at, provider_task_id,
                   provider_file_id, source_path, expires_at, failure_reason
                   -- owned by the profile. NEVER by a trial.
trial              id, profile_id, product_id, hypothesis_metric, duration_weeks,
                   cadence, locked_at, starts_at, ends_at,
                   state(active|archived|confounded|complete)
                   -- claims scans where captured_at falls between starts_at and ends_at
trial_variable     id, trial_id, product_id, added_at        -- >1 row means confounded
capture_condition  scan_id, light(daylight|indoor|mixed), same_spot_ack,
                   guidance_ack, short_side_px, device_orientation
scan_metric        scan_id, metric_key, region, raw_score, ui_score
scan_mask          scan_id, metric_key, storage_path, kind(raw_png|overlay_jpg)
routine_entry      scan_id, products[], note, factors[]
product            id, profile_id, name, brand, form, added_at   -- personal shelf
consent            id, profile_id, scan_id, version, granted_at, text_hash
reminder           profile_id, cadence, day, time, quiet, context_phrase, enabled
comparison         track_id, baseline_scan_id, latest_scan_id, confidence, computed_at
```

### 2.2 Confidence engine

Inputs: short-side pixels, declared light versus baseline light, same-spot acknowledgement, guidance acknowledgement, tier equality, and days between scans. Outputs exactly one of `Comparable capture`, `Use as a directional check`, `Treat with care`, `Not enough evidence`, plus the single sentence naming which input was weakest. One rationale, never a list.

### 2.3 Comparison engine

Pairs the first and latest `succeeded` scans in a track. Hard gates before any delta is shown: both scans succeeded, both same tier, at least two scans exist. Soft signal: confidence label. Per metric it emits baseline raw, latest raw, signed delta, and region rows where the concern is regional.

### 2.4 Privacy layer

Private bucket, short-lived signed URLs, per-row access checks, consent row written before upload, provider retention disclosed pre-upload, cascade delete of records plus storage objects, analytics payloads carrying IDs and state names only. Server-only API key.

---

## 3. Streaks and calendar

The existing retention strategy forbids streaks outright. Its release gate reads: no check-in flow requires a streak, score target, social share, or purchase. The UX spec lists streak-loss mechanics under explicit non-goals. A daily streak also actively damages the measurement, because daily photos in varying light produce more low-confidence pairs, not more evidence.

The resolution kept here preserves the requested mechanic without the harm:

**Rhythm, not streak.** The counter is consecutive check-ins that landed inside the person's own chosen cadence window, and it is expressed as `4 check-ins in rhythm`. Missing a window pauses it, never zeroes it. There is no restore purchase, no loss copy, no daily target.

**Comparable pairs.** The number that actually matters and the one given the large type: how many usable, same-tier, high-or-medium confidence pairs the track has produced.

**Calendar.** A month grid marking recorded check-ins, the planned next window, and the trial start and end. It is a record and a plan, never a grid of empty squares to be guilty about. Un-checked days are unmarked, not marked as missed.

---

## 4. Complete screen map

46 screens. P0 is the walkthrough spine, P1 completes every branch, P2 is depth.

### A. Entry and setup

| # | Screen | Priority |
| --- | --- | --- |
| 1 | Welcome | P0 |
| 2 | Sign in | P1 |
| 3 | Create account | P1 |
| 4 | How photo privacy works | P1 |
| 5 | Pre-register trial â€” product, expected metric, duration | P0 |
| 6 | Pre-register trial â€” cadence and optional if-then cue | P0 |

### B. Today, one screen per state

| # | Screen | Priority |
| --- | --- | --- |
| 7 | No baseline yet | P0 |
| 8 | Baseline saved, 1 of 2 | P0 |
| 9 | Due window open | P1 |
| 10 | Analysis processing | P0 |
| 11 | Result ready | P0 |
| 12 | Lapsed, compassionate resume | P1 |

### C. Capture and analysis

| # | Screen | Priority |
| --- | --- | --- |
| 13 | Capture guidance and permission primer | P0 |
| 14 | Camera | P0 |
| 15 | Camera permission denied, library fallback | P1 |
| 16 | Library picker | P2 |
| 17 | Review, acceptable | P0 |
| 18 | Review, blocking resolution error | P1 |
| 19 | Routine and context | P0 |
| 20 | Consent sheet | P0 |
| 21 | Analysis running, named steps | P0 |
| 22 | Analysis failed, recovery | P0 |
| 23 | HD unavailable, analysed at SD | P1 |
| 24 | Task expired, photo retained | P2 |

### D. Results and evidence

| # | Screen | Priority |
| --- | --- | --- |
| 25 | Baseline saved | P0 |
| 26 | Comparison, comparable capture | P0 |
| 27 | Comparison, treat with care | P0 |
| 28 | Comparison blocked, tier mismatch | P1 |
| 29 | All metrics | P0 |
| 30 | Metric detail with regional breakdown | P0 |
| 31 | Mask viewer, photo and mask toggle | P0 |
| 32 | Raw versus UI score explainer sheet | P1 |
| 33 | No mask available for this metric | P2 |

### E. Rhythm and calendar

| # | Screen | Priority |
| --- | --- | --- |
| 34 | Calendar month view | P0 |
| 35 | Rhythm detail, pairs and cadence adherence | P0 |
| 36 | Cue setup sheet | P1 |

### F. Diary, tracks, shelf

| # | Screen | Priority |
| --- | --- | --- |
| 37 | Diary timeline | P0 |
| 38 | Tracks list | P1 |
| 39 | Track detail and settings | P1 |
| 40 | Confounded track warning | P0 |
| 41 | Product shelf | P0 |
| 42 | Product detail with pooled evidence | P0 |
| 43 | Pooled evidence withheld, below threshold | P0 |
| 44 | Add product | P1 |

### G. Account and privacy

| # | Screen | Priority |
| --- | --- | --- |
| 45 | Me, notification and cadence controls | P1 |
| 46 | Privacy centre, export, delete track, delete account | P1 |

---

## 5. Build order

1. Entry and setup, plus Today states â€” the spine a judge clicks first.
2. Capture through result, including the failed and SD-fallback branches.
3. Evidence depth: all metrics, regional detail, mask viewer.
4. Calendar and rhythm.
5. Shelf and pooled evidence, including the withheld state.
6. Account, privacy, and the remaining error branches.
