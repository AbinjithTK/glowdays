# Glowdays

A private skin diary that tells you whether a product actually did anything — and refuses to answer when the evidence cannot support one.

Built on [Perfect Corp's YouCam AI Skin Analysis API](https://yce.perfectcorp.com/ai-api) for the YouCam API Skin AI & Apparel VTO Hackathon.

**Live build:** see the submission for the URL and access code.

---

## The problem

Skin analysis apps hand you a score. The score moves, and you have no idea whether that is the serum you started last week, better sleep, a different bathroom light, or the fact that you stood eight inches closer to the camera.

Two photographs of the same face under different conditions produce different numbers from the same analyser. So a diary that reports every difference as a change is not measuring your skin, it is measuring your bathroom.

## What this does instead

Glowdays treats every comparison as a measurement with error bars, and it is willing to say no.

**It refuses comparisons it cannot stand behind.** Before any two check-ins are compared, five capture signals are graded — light level, light evenness, how much of the frame the face fills, and head yaw and pitch. The result carries one of four confidence labels, and a comparison across mismatched analysis tiers is refused outright rather than fudged. A refusal is a first-class answer with its own screen and its own explanation.

**It never invents a measurement.** Most browsers cannot measure head angle or face distance. Sending zeros for those would tell the confidence engine it saw a perfectly square-on head at an identical distance — the strongest possible evidence, manufactured out of its own absence. Unmeasured signals are excluded from grading and cap the label at "directional check". The capture screen says which signals it managed to measure, before you upload.

**It makes you commit before it lets you conclude.** A trial names the single metric you expect to move, and for how long, before any evidence exists. Start one from a check-in that already happened and the server marks it exploratory — permanently — because a hypothesis formed after seeing the data is a different claim. One trial runs at a time, enforced by a database constraint, because two products started together produce a result you cannot attribute.

**It keeps every reading the analyser returns, at whatever granularity it returns them.** The documented subcategories are real — `hd_pore` is specified across forehead, nose, cheek and whole, and `hd_wrinkle` across seven facial areas — and the parser resolves all of them, in three different nestings, with tests. But a live analysis requested with `format: 'json'` comes back with exactly one `raw_score` per concern and no subcategories; the regional breakdown lives in `score_info.json` inside the ZIP result instead. The screens render whatever arrives and label the summary region as the one comparison uses, so they are correct either way. Reading the ZIP is the outstanding work to make the regional detail actually appear, and it is honest to say it is not appearing yet.

Verified against the deployed build with `scripts/probe-live-face.mjs`: 8 concerns, 8 masks, overall 73.25, photo and masks both resolving through presigned URLs.

**Direction is never colour.** A metric moving down is not a failure, and there is no green or red variant of the delta component to reach for. Sign, arrow and word, always.

## Which YouCam APIs

| API | Use |
| --- | --- |
| **AI Skin Analysis (HD and SD)** | Every reading. Tier chosen from the measured short side of the image, never from what the client claims. |
| **File API** | Upload, then task creation against the returned `file_id`. |
| Detection masks | Copied into our own storage on arrival so they outlive the provider's retention window. |

Analysis is billed by **concern count, not per call** — HD costs 12/16/20/22 units for 1–4/5–8/9–12/13–16 concerns. Requesting all sixteen when you surface eight is 22 units against 16, which on the 1,000-unit allocation is 45 scans against 62. `YOUCAM_CONCERN_SET` controls the breadth; `estimateUnits()` in `packages/core/src/metrics.ts` prices a call before it is made.

Deliberately **not** used: Photo Enhance, Color Correction and Photo Lighting all alter the pixels being measured, which would corrupt the reading; Skin Simulation implies a product will work before it has.

## Architecture

```
apps/web      React + Vite + Tailwind v4. Camera capture, quality measurement.
apps/api      Hono. Runs as a Node server locally and a bundled AWS Lambda deployed.
packages/core Confidence engine, metric registry, comparison rules. No I/O, fully tested.
infra/        CloudFormation: Lambda, private S3 bucket, IAM, log group.
scripts/      Bundle, deploy, secret rotation, deployed-endpoint probes.
```

The API serves the built web app on the same origin. That is not a shortcut — `getUserMedia` needs a secure context, so a phone needs HTTPS, so it needs one address; and serving compiled output means a dev server never exposes the project root, which holds `.env`.

## Running it locally

Requires Node 22+ and pnpm 10+. **No Docker and no Postgres install needed** — an embedded Postgres (PGlite) is used when `DATABASE_URL` starts with `pglite://`, and it is refused in production by config.

```bash
pnpm install
cp .env.example .env

pnpm --filter @glowdays/api db:migrate   # create the schema
pnpm --filter @glowdays/api seed         # optional demo data, invented brands only
pnpm -r build
pnpm --filter @glowdays/api start        # http://localhost:8787
```

`.env` defaults to `YOUCAM_MODE=fixture`, which returns deterministic local responses and spends **no** API units. For live analysis:

```
YOUCAM_MODE=live
YOUCAM_API_KEY=<your key>
YOUCAM_CONCERN_SET=surfaced
```

Sign-in locally is an email address alone. The deployed build uses `AUTH_MODE=demo`: an email plus a shared access code, exchanged for an HMAC session. That removes email delivery from the critical path — Cognito's own sender is rate limited and SES starts sandboxed, and a reviewer who cannot sign in cannot assess anything. The Cognito path exists in `auth/cognito.ts` and is inert unless `AUTH_MODE=cognito`.

### Tests

```bash
pnpm -r test    # 33 in core, 45 in api
```

Worth reading rather than just running:

- `packages/core/src/confidence.test.ts` — includes a test proving two otherwise identical scans reach full confidence only when the pose signals were genuinely measured.
- `apps/api/src/services/framing-gate.test.ts` — a capture is never refused on the strength of a signal nothing measured.
- `apps/api/src/dev-routes-closed.test.ts` — runs in its own process with the dev flag absent, proving the development endpoints are unreachable without it.
- `apps/api/src/youcam/parse.test.ts` — the provider puts `output` *between* action and region in `hd_pore_output_nose`; a matcher that only stripped it from the end silently dropped a reading.

### Verifying a deployment

```bash
node scripts/probe-e2e.mjs   # create, consent gate, analyse, poll, against the live URL
```

## Deploying

```powershell
./scripts/deploy.ps1 -DatabaseUrl "postgres://...?sslmode=require" -YoucamApiKey "..."
./scripts/deploy.ps1 -CodeOnly    # every deploy after the first, ~40s
```

Bundled Lambda rather than a container, because the build machine had no Docker, which rules out App Runner from ECR and ECS Fargate. Notes worth keeping:

- The app **refuses to boot** on a remote `DATABASE_URL` without `sslmode=require`.
- `/health` is liveness and does not touch the database. `/ready` queries it and returns 503 when unreachable, so a load balancer cannot keep routing to a task whose database is gone.
- API Gateway HTTP API sits in front of Lambda, and its ~4.25 MB body ceiling (Lambda's 6 MB synchronous limit after base64 inflation) is why the client encodes captures down a ladder that defends the 1080px short side before it sacrifices quality.
- The API Gateway is **not** in the CloudFormation template; it was created with the CLI and will not be recreated by a stack rebuild.

## Licence

MIT. See [LICENSE](./LICENSE).

## Secret scanning

```bash
pnpm secrets:scan
```

Reads every commit, not just the working tree, and exits non-zero if it finds a
credential. Run it before publishing.

It exists because the check that ran before this repository was first published
tested **filenames** rather than **file contents**. It correctly excluded `.env`,
`access-code.txt`, `signing-secret.txt` and the editor's MCP config — and then
committed a live database URL hardcoded inside a deploy script, plus a live API key
sitting commented-out in `.env.example`, a file whose entire purpose is to be
shared. Commenting a credential out does not hide it, and an allowlist of filenames
cannot tell you what is inside a file.

The scanner distinguishes real credentials from the placeholders this codebase
legitimately contains — `postgres://` appears in validation code, test fixtures and
usage examples — because a scanner that cries wolf gets ignored within a day.
