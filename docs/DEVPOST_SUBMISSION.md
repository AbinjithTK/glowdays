# Glowdays â€” Devpost handoff

## Title and tagline

**Glowdays**  
*A private skin diary that shows evidence, confidence, and uncertaintyâ€”not just a score.*

## Suggested project description

Daily skin changes are noisy: light, sleep, makeup, camera angle, and ordinary variation can all make a routine look better or worse. Glowdays helps a person ask a narrower questionâ€”â€œis this routine showing a directional change?â€â€”without pretending to diagnose skin or promise product results.

Users create one focused track, capture a consented baseline, log routine/context details, and repeat the check-in under similar conditions. The app sends the image through a server-side YouCam Skin Analysis v2.1 workflow, persists raw scores and available masks in private storage, and compares the first and latest successful scans. A confidence label is calculated from framing, lighting, capture guidance, and same-condition acknowledgements. When the diary lacks enough comparable evidence, it says so plainly.

Glowdays uses Next.js, TypeScript, Supabase Auth/Postgres/private Storage, and a server-only asynchronous YouCam integration. It does not use an LLM in the core path. Original images and masks are access-checked, consent is recorded, provider retention is disclosed before upload, and deleting a track removes its records and artifacts.

The intended impact is better-informed personal skincare decisions and, later, consented post-purchase progress experiences for retailersâ€”without turning beauty metrics into medical advice.

## 2â€“3 minute video outline

| Time | Show | Say |
| --- | --- | --- |
| 0:00â€“0:20 | Problem statement + Glowdays landing page | â€œA selfie can change for reasons that have nothing to do with a routine.â€ |
| 0:20â€“0:45 | Create â€œNew moisturiserâ€ track | â€œGlowdays begins with one answerable question, not a generic gallery.â€ |
| 0:45â€“1:10 | Capture checklist + consent disclosure | â€œComparable conditions and facial-data consent are part of the product, not footnotes.â€ |
| 1:10â€“1:35 | Real baseline result + raw score/mask | â€œThe pipeline uploads privately, runs YouCam asynchronously, and stores raw scores plus supporting evidence.â€ |
| 1:35â€“2:05 | Second real scan + confidence/deltas | â€œThis is a directional signal with high/medium/low confidenceâ€”not a diagnosis or product promise.â€ |
| 2:05â€“2:25 | Routine note, export card, delete control | â€œContext and privacy stay attached to the measurement.â€ |
| 2:25â€“2:45 | `src/lib/youcam.ts` and `supabase/schema.sql` | â€œThe API key is server-only; RLS and private paths enforce account boundaries.â€ |

## Screenshot checklist

1. Landing/auth screen with the measurement-aware value proposition.
2. Two-real-scan timeline with confidence, raw deltas, and a mask.
3. Capture/consent workflow and routine logging.
4. Delete/privacy control or private artifact evidence view.

Use real scans only with consent. Do not use the illustrative workspace image in a way that implies it came from YouCam.

## Custom-question response notes

Fill these after the final live run; do not invent details.

- **API surprise:** describe an observation from your own real request/result (for example, the distinction between raw and UI scores) and how it changed the product.
- **Technical obstacle:** truthfully describe the asynchronous upload/task/polling/mask-normalization challenge and the recovery/error states you built.
- **Project start date:** enter the actual date work began.
- **Future use cases:** consented post-purchase routine tracking, retailer follow-up experiences, and longitudinal wellness reflectionâ€”never clinical diagnosis.

## Submission checklist

- [ ] Public repository pushed from this standalone `skinsignal` directory.
- [ ] Deployed URL tested with a fresh account.
- [ ] Two genuine consented scans prepared for the demo account.
- [ ] 1â€“3 minute public video uploaded.
- [ ] Screenshots uploaded.
- [ ] Description pasted and custom answers made truthful.
- [ ] API key absent from commit history, client bundles, screenshots, and logs.
