# Glowdays Mobile Product & UX Specification

**Status:** build-ready product/design specification  
**Platform:** iOS and Android, built with Expo/React Native  
**Product posture:** private wellness tracking; never diagnosis, treatment advice, or a product-effect guarantee

## 1. Product decision

Glowdays mobile is a **capture-first private diary**, not a score browser. Its job is to help a person answer one modest question at a time:

> â€œAcross comparable check-ins, is there a directional signal worth paying attention to?â€

The current web app already owns the important backend primitives: tracks, scans, raw metrics, routine entries, consents, confidence comparisons, private artifacts, server-only YouCam processing, and deletion. The mobile app should reuse those contracts; it should not recreate a second measurement model.

### Product principles

1. **Evidence before excitement.** No strong progress claim before two successful comparable scans.
2. **One clear next action.** Every primary screen has one dominant task.
3. **Capture quality is part of the product.** Guidance is useful and nonjudgmental; bad conditions lower confidence rather than shame the person.
4. **Private by default.** Facial images never appear in public views, notifications, analytics, or social features.
5. **Autonomy over compulsion.** Reminders, cadence, and goals are chosen by the person; lapses never erase progress.
6. **Plain language over beauty jargon.** â€œDirectional movement,â€ â€œcapture conditions,â€ and â€œnot enough evidenceâ€ are clearer and safer than diagnostic labels.

### Explicit non-goals

- Acne/condition diagnosis, treatment recommendations, or medical triage.
- Daily scoring as a reason to return.
- A product marketplace, affiliate prompts, public feed, likes, followers, or before/after sharing.
- Streak-loss mechanics, variable rewards, shame copy, or notification pressure.
- An LLM coach in the measurement path.

## 2. Audience and jobs to be done

| User | Primary job | Anxiety to remove | Mobile promise |
| --- | --- | --- | --- |
| Routine experimenter | See whether one chosen routine is worth continuing | â€œI cannot tell if this is real progress.â€ | Make a comparable next check-in feel simple. |
| Sensitive-data-conscious user | Track privately without becoming a beauty app subject | â€œWhere does my face image go?â€ | Explain and control data use at the moment it matters. |
| Busy returner | Resume after missing a check-in | â€œI ruined the experiment.â€ | Preserve history; offer a calm next step. |

The first mobile release optimizes for one active track. Multiple tracks are supported, but the app never asks the person to manage them all at once.

## 3. Information architecture

```text
App launch
â”œâ”€ Signed out
â”‚  â”œâ”€ Welcome / privacy promise
â”‚  â”œâ”€ Sign in / create account
â”‚  â””â”€ First-track setup
â””â”€ Signed in
   â”œâ”€ Today                 (default tab)
   â”‚  â””â”€ Start check-in
   â”œâ”€ Progress              (current track timeline)
   â”‚  â”œâ”€ Scan detail
   â”‚  â”œâ”€ Metric evidence / mask
   â”‚  â””â”€ Export private card
   â”œâ”€ Capture               (modal flow, not a persistent content tab)
   â”‚  â”œâ”€ Guidance
   â”‚  â”œâ”€ Camera / library
   â”‚  â”œâ”€ Review
   â”‚  â”œâ”€ Routine + consent
   â”‚  â””â”€ Processing / result
   â”œâ”€ Tracks
   â”‚  â”œâ”€ Track list
   â”‚  â”œâ”€ Create / archive track
   â”‚  â””â”€ Track settings
   â””â”€ Me
      â”œâ”€ Reminder preferences
      â”œâ”€ Privacy / export / deletion
      â””â”€ Account settings
```

### Bottom navigation

Use four destinations plus a raised capture action:

| Position | Label | Purpose | Badge rule |
| --- | --- | --- | --- |
| 1 | Today | Answer â€œwhat should I do next?â€ | Small dot only when a result is ready. |
| 2 | Progress | Evidence timeline for selected track | No count badges. |
| Center | Check-in | Opens camera workflow | Rose circular action; 56dp minimum. |
| 3 | Tracks | Switch or create experiments | No badge. |
| 4 | Me | Privacy, reminders, account | No badge. |

Do not put â€œJournalâ€ in the tab bar. Routine/context is attached to a scan, where it is useful.

## 4. End-to-end happy path

```text
Today
  â†’ Start baseline
  â†’ capture guidance
  â†’ camera
  â†’ review photo
  â†’ routine/context + informed consent
  â†’ upload/analysis status
  â†’ baseline saved
  â†’ schedule preferred next check-in
  â†’ Progress says â€œnot enough evidence yetâ€

Next check-in
  â†’ same flow
  â†’ directional comparison + confidence explanation
  â†’ review private mask / log note / export if desired
```

The user can leave during upload or processing. A scan remains visible as `queued` or `analysing`; the result arrives via an in-app state update and, if opted in, one push notification.

## 5. Screen specifications

### A. Welcome and authentication

**Purpose:** establish a private, trustworthy mental model before requesting any permission.

**Layout**

- Top 40%: dark plum field with the abstract Glowdays orb; no face photography.
- Bottom sheet-like paper surface: title, one-sentence value proposition, sign-in/create-account actions.
- Link: â€œHow photo privacy works.â€

**Exact hierarchy**

1. Eyebrow: `PRIVATE MEASUREMENT DIARY`
2. Headline: `See a routine with less guesswork.`
3. Body: `Compare repeat check-ins with capture confidence, not a one-off beauty score.`
4. Primary: `Create private diary`
5. Secondary: `I already have an account`
6. Tertiary: `How photo privacy works`

**Rules**

- Do not request camera or notification permissions here.
- Explain demo data only in a separate developer/demo entry, never as the default consumer path.
- Password fields support password-manager autofill and visible-password toggle.

### B. First-track setup

**Purpose:** convert vague interest into a self-chosen, observable experiment.

Use a three-step pager with a visible `1 of 3` progress label; do not use a long form.

| Step | Content | Default / validation |
| --- | --- | --- |
| 1. Name the experiment | Title and goal sentence | Suggested title: â€œNew moisturiserâ€; goal must be 8+ characters. |
| 2. Choose focus | Hydration, radiance, even tone, clarity, balance, texture, pore appearance, fine-line appearance, overall | Single select; â€œoverallâ€ is available but not visually promoted. |
| 3. Choose a rhythm | â€œIâ€™ll decide each time,â€ â€œWeekly,â€ â€œEvery 2 weeks,â€ â€œMonthlyâ€ | No daily default; show that comparable conditions matter more than frequency. |

Final primary action: `Capture baseline`.

### C. Today

**Purpose:** be self-explanatory in under five seconds.

**Above the fold**

1. Greeting, date, and selected-track switcher.
2. One `Next best action` card.
3. Compact evidence summary, if available.

**Next best action card states**

| State | Headline | Body | Primary action |
| --- | --- | --- | --- |
| No scans | `Your first baseline is waiting.` | `A single clear photo starts the record. You will compare it only after a later check-in.` | `Capture baseline` |
| One successful scan | `Your baseline is saved.` | `A second comparable check-in is what makes a direction visible.` | `Plan next check-in` |
| Due window | `Ready when your conditions are similar.` | `Use your usual place and even light if you choose to check in today.` | `Start check-in` |
| Processing | `Your private analysis is underway.` | Stage label and elapsed-time-neutral progress; no false percentage. | `View status` |
| Two+ scans | `Your latest comparison is ready.` | Confidence badge + one plain-language result. | `View progress` |
| Low-confidence latest pair | `You have a signal, with a caveat.` | Name the condition that differed. | `See what changed` |

Below the card, show a small `Recent context` strip with the last note and a `View timeline` link. Never show full facial imagery on Today by default.

### D. Capture guidance

**Purpose:** make a comparable photo feel achievable before camera permission.

Show four illustrated instructions, each in one short line:

1. `Use bright, even light.`
2. `Face the camera straight on.`
3. `Keep the same place and framing when you can.`
4. `Avoid filters, glasses, and heavy makeup where possible.`

The bottom area contains `Use camera` and `Choose from library`. A smaller `Why this matters` disclosure explains that conditions affect confidence, not worth or health.

Request camera permission only after `Use camera` is tapped. If refused, show `Choose from library` and `Open settings`, never block the flow.

### E. Camera

**Purpose:** provide quiet framing help, not surveillance.

**Visual structure**

- Full-screen live preview.
- Semi-transparent oval guide centered vertically around 42% from the top.
- Two low-contrast horizontal eye-line ticks; no facial landmarks are stored or drawn.
- Top: close, flash off/on, help.
- Bottom: gallery, shutter (64dp), camera flip.
- Persistent text below guide: `Align your face inside the outline.`

**Capture rules**

- Default flash is off.
- Do not auto-capture.
- Do not call a photo â€œbadâ€; use `Try brighter, more even light for a stronger comparison.`
- Capture device orientation, actual dimensions, and declared conditions; do not persist precise location unless a future user-controlled feature needs it.

### F. Photo review

**Purpose:** give the person control before data transmission.

Display the image in a rounded 4:5 frame, with a `Retake` text action and `Use this photo` primary action. Under it, show a simple quality card:

| Signal | Display |
| --- | --- |
| Short side < 480px | Blocking error; choose another photo. |
| Mixed/unknown light | Amber advisory; still continue. |
| Same conditions off | Neutral advisory; confidence may be lower. |
| Guidance not confirmed | Blocking acknowledgement before analysis. |

Do not display a numerical â€œbeauty quality score.â€

### G. Routine, context, and consent

**Purpose:** attach useful context while making facial-data consent unmistakable.

Inputs appear in this order:

1. `What products did you use since your last check-in?` â€” chips from recent entries plus free text.
2. `What did you notice?` â€” optional multi-line note.
3. `Anything that may affect comparison?` â€” optional chips: sleep, stress, travel, weather, cycle, makeup, other; every chip is optional and dismissible.
4. `Capture conditions` â€” light selector and same-conditions checkbox.
5. Consent card.

Consent card requirements:

- Heading: `Before private analysis`
- State what is sent, why it is sent, Perfect Corp retention disclosure, local/private Storage behavior, and deletion control.
- Link to full privacy detail.
- An unchecked checkbox with explicit affirmative text.
- Analysis button remains disabled until consent and mandatory guidance acknowledgement are complete.

Primary action: `Analyse private check-in`. Secondary action: `Save as draft`.

### H. Analysis status

**Purpose:** create confidence without pretending that an asynchronous process is instant.

Use a three-step status list:

- `Photo stored privately` â€” complete
- `Skin analysis running` â€” active
- `Evidence added to your timeline` â€” pending/complete

Use a calm looping signal animation limited to 1.5 seconds and respect reduced-motion preference. Show `You can leave this screen; weâ€™ll keep the result in this track.`

Failure state:

- Headline: `This check-in did not finish.`
- Explain a safe action: `Retry with a clear, front-facing photo in even light.`
- Actions: `Retry analysis`, `Choose another photo`, `Keep draft`, `Delete photo`.
- Never show raw provider errors, IDs, headers, or API details.

### I. Baseline result

**Purpose:** celebrate a useful first data point without implying a result.

Headline: `Baseline saved.`

Use a soft â€œnot enough evidenceâ€ card:

> `One scan is a starting point. Add a later comparable check-in before interpreting movement.`

Show the selected focus metric and other raw metric cards as secondary information. Offer `Plan next check-in` and `Add routine note`. Do not call metrics â€œimprovedâ€ or â€œworseâ€ at baseline.

### J. Progress

**Purpose:** make comparison trustworthy, readable, and reversible.

**Top sequence**

1. Track title and goal, with a current-track selector.
2. Comparison card: baseline date â†’ latest date, confidence badge, one-sentence rationale.
3. Overall raw-score movement if available.
4. Metric delta list ordered by absolute change, not by visual drama.
5. Timeline list.

**Metric row anatomy**

- Metric label: `Hydration`
- Values: `51.0 â†’ 63.0 raw`
- Direction pill: `+12.0`; color is a supplementary cue only.
- `Why this is shown` icon opens a short sheet explaining raw score / UI score distinction.

**Confidence language**

| Confidence | Label | Copy |
| --- | --- | --- |
| High | `Comparable capture` | `Framing, even light, and your capture checklist aligned.` |
| Medium | `Use as a directional check` | `The photo setup was mostly comparable, but one condition differed.` |
| Low | `Treat with care` | `The diary keeps the measurement, but conditions make a strong progress claim unreliable.` |
| Insufficient | `Not enough evidence` | `Add another successful, comparable check-in before comparing movement.` |

### K. Scan detail and private evidence

**Purpose:** let a person inspect the evidence behind a metric without exposing it elsewhere.

- Default view: private source image blurred until tapped `Show photo` in a current authenticated session.
- Segmented control: `Photo` / `Metric mask`.
- If mask does not exist: state `No saved mask is available for this metric.`; do not make it look like an error.
- Include metric raw/UI scores, capture conditions, routine, note, and context.
- Actions: `Edit context` (not measurement), `Delete this scan`, `Report an issue`.

### L. Tracks

Cards contain title, focus concern, start date, completed-check-in count, and current state. The empty state is instructional:

> `Track one routine question at a time. This makes the timeline easier to understand.`

Archive is reversible. Deletion requires a confirmation bottom sheet naming all deleted categories.

### M. Me, privacy, and settings

Sections:

- Reminders and check-in rhythm
- Privacy center
- Export private progress card
- Delete a track
- Delete account and all data
- Notification controls
- Help / how comparisons work

Account deletion requires reauthentication and a typed confirmation. It must explain the provider retention window separately from Glowdaysâ€™s deletion of its own data.

## 6. Visual system and aesthetics

### Brand character

**Quietly editorial, warm, evidence-led.** The visual system should feel like a thoughtfully kept private notebook supported by clear measurementâ€”not a clinic, cosmetics counter, or addictive social app.

### Color tokens

Carry the existing web palette into native tokens.

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#2B2426` | Primary text, dark typography |
| `canvas` | `#F8F4F1` | App background |
| `paper` | `#FFFDFB` | Cards and sheets |
| `plum` | `#382B30` | Hero field, nav contrast |
| `rose` | `#B9576E` | Primary action, focus ring |
| `roseDark` | `#963D55` | Pressed/eyebrow state |
| `roseSoft` | `#F7E6E8` | Gentle emphasis |
| `lavender` | `#E9E4F6` | Information/comparison surface |
| `sage` | `#E6EFE8` | High-confidence support only |
| `caution` | `#F6EDD9` | Capture advisory |
| `danger` | `#A7434B` | Destructive confirmation only |
| `line` | `#E8DDDA` | Dividers/borders |

Every text/background pairing must meet WCAG 2.2 AA. Color never communicates confidence or direction by itself; all colored pills have text and an icon/shape difference.

### Typography

- Display: `DM Serif Display` (fallback: Georgia) for only H1/H2 and emotionally quiet moments.
- UI/body: `Inter` (fallback: system sans) for all controls, data, instructions, and long text.
- Use tabular numerals for raw scores.
- Minimum body size: 16sp. Minimum metadata: 12sp. Do not truncate evidence rationale.

### Spacing, shape, and depth

- 4dp base grid; common spaces 8, 12, 16, 24, 32, 40.
- Standard screen edge padding: 20dp; tablet max content width: 680dp.
- Card radius: 16dp; controls: 12dp; pill: 999dp.
- Use one subtle shadow level and 1px `line` borders. Avoid glassmorphism, hard gradients, and dense chart chrome.
- The abstract concentric signal motif may appear on welcome, processing, and empty states. It never appears over a face image.

### Motion

- Press feedback: 100â€“150ms opacity/scale response.
- Sheet transitions: 220ms ease-out.
- Success: one restrained 500ms signal pulse, not confetti.
- Respect reduce-motion: replace animated processing with static step indicators.

## 7. Component inventory

| Component | Variants | Non-negotiable behavior |
| --- | --- | --- |
| `SignalButton` | primary, secondary, text, danger | 48dp height, loading label, disabled reason visible nearby |
| `EvidenceCard` | baseline, comparison, low-confidence, processing | Never presents a metric as diagnosis |
| `ConfidenceBadge` | high, medium, low, insufficient | Text always visible; semantic role announced |
| `MetricRow` | normal, selected, unavailable | Shows baseline/current/raw/delta clearly |
| `CaptureGuide` | instruction, warning, blocking | Gives a corrective action, not only a state |
| `PrivacySheet` | consent, artifact, delete, account delete | Links to readable policy and has explicit confirmation |
| `TrackSwitcher` | one / many tracks | Current selection accessible via screen reader |
| `RoutineField` | recent chips, free text, optional context | Never requires sensitive context |
| `EmptyState` | no track, no evidence, no mask, offline | Explains why and offers one next action |

## 8. Copy and accessibility rules

- Use first-person, optional language: `Choose a time that works for you`, not `You must check in now`.
- Put the important noun first: `Hydration moved +12.0`, not `+12.0 is your hydration movement`.
- Do not say `normal`, `flawed`, `bad skin`, `healthy skin`, or `fix`.
- Every icon-only button has an accessibility label.
- Camera guide is accompanied by voice-readable instructions and haptic confirmation after capture.
- Support 200% text scaling without clipped CTAs; long consent copy scrolls inside a labelled sheet.
- Localize dates, 12/24-hour time, decimal conventions, and culturally specific routine language.

## 9. Design-review gates

Before engineering begins, create these Figma frame sets at 390Ã—844, 430Ã—932, and 768px tablet widths:

1. Signed-out and first-track flow.
2. Every capture step and permission denial branch.
3. Baseline, high-confidence comparison, low-confidence comparison, failed analysis, and no-mask state.
4. Track management, reminder controls, export, scan deletion, and account deletion.
5. Light, dark, large-text, and reduced-motion variants.

No mobile screen is â€œdoneâ€ until it has default, loading, empty, error, disabled, and accessibility states documented.
