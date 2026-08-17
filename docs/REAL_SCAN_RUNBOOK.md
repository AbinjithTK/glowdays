# Real YouCam demo runbook

Use this once before recording the judge-facing walkthrough. Do not substitute the illustrative demo workspace for this run.

## 1. Configure a production-like environment

Set the following values in `.env.local` and in Vercel:

```dotenv
USE_DEMO_YOUCAM=false
YOUCAM_API_KEY=...
YOUCAM_API_BASE_URL=https://yce-api-01.makeupar.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Apply [`../supabase/schema.sql`](../supabase/schema.sql) first. Confirm that the `skinsignal-private` bucket is not public.

## 2. Run a credential smoke test

```bash
pnpm dev
```

1. Open `/api/health`; it must return `"youcamMode":"live"`.
2. Register the demo account in the deployed app.
3. Create a track such as **Barrier reset — real demo**.
4. Upload one consented, clear, front-facing JPG in even light.
5. Confirm the scan is `succeeded`, has raw metrics, and at least one returned mask loads through the private artifact route.

If it fails, use the in-product retry state. Do not copy an API key, raw provider response, image bytes, or transient provider URL into a ticket, recording, or public repository.

## 3. Capture two comparable scans

For both scans:

- obtain the participant’s informed consent;
- use the same camera and approximate framing;
- use bright, even light and avoid filters, glasses, and heavy makeup where possible;
- record routine/context notes;
- wait long enough that a routine question is meaningful, rather than implying a causal outcome from two photos.

The goal is a **high-confidence directional comparison**, not a medical conclusion.

## 4. Pre-recording checks

- Sign in as a second test account and confirm the first account’s timeline/artifact routes return `404`.
- Delete a disposable test track and confirm its database records and Storage objects are gone.
- Confirm the real scan cards do **not** show the “illustrative demo result” label.
- Refresh the deployed app; both real scans must persist.
- Keep the account signed in for the video, but never show credentials or unconsented images.

## 5. If live units are unavailable

Record only the labelled illustrative workspace and state clearly that it demonstrates the interaction design, not real provider output. Do not present seeded masks or scores as real YouCam analysis.
