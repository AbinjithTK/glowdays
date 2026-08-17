# Glowdays Mobile Engineering & Delivery Plan

This document turns the product and UX specifications into a sequenced build. It preserves the current web app as the secure backend/reference product while adding a native mobile client.

## 1. Architecture decision

### Recommended repository shape

```text
skinsignal/
â”œâ”€ src/                       # existing Next.js web app and server routes
â”œâ”€ mobile/                    # new Expo / React Native app
â”œâ”€ packages/
â”‚  â””â”€ contracts/              # shared Zod schemas, DTOs, metric labels, tokens
â”œâ”€ supabase/
â”‚  â”œâ”€ schema.sql              # existing schema
â”‚  â””â”€ migrations/             # mobile/job/notification migrations
â””â”€ docs/
```

Do not block the first mobile milestone on converting the whole repository into a monorepo. Start `mobile/` as an Expo app, then move only stable shared contracts out of `src/lib/types.ts` and `src/lib/validation.ts`.

### Native stack

| Concern | Choice | Reason |
| --- | --- | --- |
| Client | Expo + React Native + TypeScript | Native camera, notification, secure storage, iOS/Android delivery. |
| Navigation | Expo Router | File-based routes and modal capture flow. |
| Server state | TanStack Query | Caching, refetch, optimistic context edits, scan polling. |
| Auth | Supabase Auth + Expo SecureStore | Existing auth model with tokens protected at rest. |
| Form validation | Shared Zod contracts | Same field constraints on web, mobile, and API. |
| Camera/media | Expo Camera, ImageManipulator, FileSystem | Front camera, compression, dimensions, local drafts. |
| Notifications | Expo Notifications | Opt-in result delivery and configurable cadence cues. |
| Error monitoring | Sentry or equivalent, privacy-filtered | Capture crashes without images, notes, scores, or tokens. |

## 2. Required backend evolution

The current scan route is ideal for a web proof-of-concept but waits while the provider task is polled. Mobile needs durable state when the app backgrounds.

### Mobile scan lifecycle

```text
Device captures image
  â†’ private Storage upload (user-scoped draft path)
  â†’ POST /api/v1/mobile/tracks/:trackId/scans
  â†’ scan row = queued; YouCam task created
  â†’ durable worker polls provider task
  â†’ worker stores metrics/masks; scan = succeeded or failed
  â†’ result push (only if opted in)
  â†’ app refreshes GET /api/v1/mobile/scans/:scanId
```

### New API contracts

| Method | Route | Client purpose |
| --- | --- | --- |
| `POST` | `/api/v1/mobile/upload-intents` | Obtain private upload rules/path; no public image URL. |
| `POST` | `/api/v1/mobile/tracks/:trackId/scans` | Submit stored draft path, verified capture metadata, routine, and consent; returns `scanId` + `queued`. |
| `GET` | `/api/v1/mobile/scans/:scanId` | Poll/refresh a scan and its result. |
| `POST` | `/api/v1/mobile/scans/:scanId/retry` | Retry a failed provider task using the retained private source. |
| `PATCH` | `/api/v1/mobile/scans/:scanId/context` | Edit routine/context only. |
| `POST` | `/api/v1/mobile/notification-preferences` | Save opted-in result/cadence preferences. |
| `DELETE` | `/api/v1/mobile/tracks/:trackId` | Delete rows and private artifacts. |

All routes require the authenticated Supabase user token. The YouCam API key, Storage service-role secret, push credential, and worker credentials stay server-only.

### Job model

Add a durable `scan_jobs` record or equivalent queue state:

```text
id, scan_id, provider_task_id, state, attempts, next_attempt_at,
lease_expires_at, last_safe_error_code, created_at, completed_at
```

Worker requirements:

- idempotent by `scan_id` and provider task ID;
- exponential retry for transient provider/network errors;
- bounded attempts and terminal failure;
- lease-based concurrency so a task is not processed twice;
- no raw provider response, image byte, or key in logs;
- artifact download into the user-scoped private bucket;
- one safe result notification on a terminal state transition only.

Use a managed durable job runner (for example Inngest/Trigger.dev) or a Supabase Edge Function plus scheduled job. Do not rely only on a foreground device or an open serverless request.

## 3. Mobile domain additions

| Entity | New fields / table | Purpose |
| --- | --- | --- |
| `scans` | `source_draft_path`, `client_capture_at`, `capture_device_orientation`, `capture_version` | Trace product behavior without collecting location/face embeddings. |
| `scan_jobs` | durable task lifecycle fields | Background processing and retries. |
| `notification_preferences` | result enabled, cue enabled, cadence, local time, timezone, quiet delivery | User-owned notification system. |
| `push_devices` | opaque Expo push token, platform, enabled timestamp | Result delivery; delete with account. |
| `routine_entries` | optional structured context tags | Faster native entry; text remains optional. |
| local encrypted draft | image URI + form data + expiry | Offline/interrupted capture recovery; device-only. |

Do not add inferred skin conditions, face embeddings, precise GPS, social graph data, or advertising identifiers.

## 4. Build workstreams

### Workstream A â€” Foundation and design system

**Deliverables**

- Expo app shell, deep links, authentication restoration, secure token storage.
- Native tokens matching `MOBILE_PRODUCT_UX_SPEC.md`.
- Button, field, sheet, metric row, confidence badge, empty-state, and error-state components.
- Storybook or Expo preview catalog for every component state.

**Done when**

- App works in light/dark mode and at 200% font size.
- Four-tab navigation plus capture modal behaves on iOS/Android.
- No screen needs hidden gesture knowledge to proceed.

### Workstream B â€” Track and Today experience

**Deliverables**

- Sign in/create account.
- First-track setup and track switcher.
- Today state machine: no scans, baseline, due, processing, comparison, low confidence.
- Archive/delete track flow.

**Done when**

- A new user understands why a second scan matters without opening help.
- Returning user sees exactly one next action.

### Workstream C â€” Capture, review, and consent

**Deliverables**

- Native camera, gallery fallback, permission-denied branch.
- Local image header/dimension verification, compression, rotation correction.
- Guided framing UI, photo review, retake, routine/context entry.
- Consent version recording and private draft upload.
- Offline encrypted draft and resume/delete behavior.

**Done when**

- An interrupted capture can resume safely.
- The app never uploads without explicit consent.
- Invalid/small image failures explain the corrective action.

### Workstream D â€” Durable analysis and result delivery

**Deliverables**

- Versioned mobile scan API and durable worker.
- Scan status screen, background refetch, result push preference flow.
- Retry endpoint and provider-safe error mapping.
- Private signed artifact retrieval.

**Done when**

- Closing the app during analysis does not lose the scan.
- A second account cannot fetch a scan, source image, mask, or signed artifact URL.
- Push content reveals no sensitive information.

### Workstream E â€” Evidence and reflection

**Deliverables**

- Progress timeline and scan detail.
- Raw score deltas, metric drill-down, source/mask switcher, confidence rationale.
- Routine/context edits, privacy-safe export.
- â€œNot enough evidenceâ€ and â€œlow confidenceâ€ designs.

**Done when**

- Every result makes a distinction between measurement, confidence, and health advice.
- User can delete a scan/track and see its consequences before confirmation.

### Workstream F â€” Retention, quality, and launch

**Deliverables**

- Optional cue scheduling, result notifications, recovery copy, granular controls.
- Privacy-safe event analytics and guardrail dashboard.
- Accessibility, localization, performance, device, and security tests.
- Beta feedback study and App Store/Play Store privacy materials.

**Done when**

- Notifications-off is a first-class supported product mode.
- No analytics event contains private image, notes, raw scores, tokens, or email.

## 5. Delivery sequence

| Phase | Duration | Outcome | Must not slip |
| --- | --- | --- | --- |
| 0. Design validation | 1 week | Figma prototype, usability script, API contracts | Privacy/capture guidance tested first. |
| 1. Native foundation | 1 week | Auth, nav, design system, tracks/Today | Accessibility baseline. |
| 2. Capture flow | 1â€“2 weeks | Camera, review, consent, private draft upload | No upload before consent. |
| 3. Durable processing | 1â€“2 weeks | Job worker, statuses, private result delivery | Background-safe scans. |
| 4. Progress UX | 1 week | Timeline, masks, export/delete | Confidence rationale complete. |
| 5. Ethical retention + beta | 1 week | Preferences, push, analytics, study | Guardrails and notification controls. |

The first testable beta should take roughly 6â€“8 focused engineering weeks for a small team, excluding unforeseen provider/platform approval work.

## 6. Testing plan

### Automated

- Unit: metric normalization, confidence logic, image inspection, notification schedule policy, copy/state mapper.
- API integration: RLS/ownership, consent required, worker idempotency, retry bounds, artifact deletion.
- Mobile component tests: screen state rendering, field validation, keyboard/safe-area behavior.
- End-to-end: onboarding â†’ baseline â†’ background analysis â†’ result â†’ second scan â†’ comparison â†’ deletion.

### Device matrix

- One small iPhone, current large iPhone, mid-range Android, Pixel/Samsung device.
- Camera permission denied/regranted.
- Slow 3G-like network, network loss while uploading, app kill during analysis, notification disabled.
- Large dynamic text, VoiceOver/TalkBack, dark mode, reduced motion.

### Usability research

Recruit at least five people in the target audience. Test with a non-sensitive sample image or prototype unless valid consent is in place. Ask them to:

1. Create a routine question.
2. Explain what they should do before capturing.
3. Locate why comparison confidence is low.
4. Turn off a reminder.
5. Delete a track and explain what will be deleted.

The release cannot proceed if participants interpret the app as diagnostic, cannot find privacy controls, or feel pushed to scan daily.

## 7. Engineering quality gates

- API key and service-role credentials cannot enter the mobile bundle.
- Source/mask Storage paths start with the authenticated `userId/`.
- Signed URLs expire within 60 seconds and are issued only after ownership checks.
- Worker logs are structured and scrubbed.
- Local media drafts are encrypted/securely stored where platform facilities permit, expire after 7 days, and have a visible delete action.
- Account/track delete is tested against both database rows and Storage objects.
- Every UX state in the design spec has a tracked implementation test.

## 8. Release artifacts

- Figma file organized by flow, screen, component, and state.
- Component inventory and token JSON.
- API schema/OpenAPI or typed-contract package.
- Privacy policy, consent text/version, data retention statement, and App Store privacy labels.
- Accessibility audit report.
- Results from the beta usability study.
- Production runbook for live YouCam credentials, task failures, and incident response.
