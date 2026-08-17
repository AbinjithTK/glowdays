# Devpost submission — filled answers

Project is created and saved as a **draft**: https://devpost.com/software/glowdays
Submission page: https://youcam-api.devpost.com/ → My submission

Name, tagline, description, "Built with" tags and both links are **already saved on the
project**. The five long-form answers below were submitted with the project; if the form
shows any of them empty, paste from here.

**Submission closes 17 Aug 2026, 15:45 UTC (11:45am ET).**

---

## Still needs you — three fields

| Field | Why I did not fill it |
| --- | --- |
| **What is your country of residence?** | Personal data. I will not invent it. |
| **What date did you start this project? (MM-DD-YY)** | I do not know it. The submission window opened 07-06-26; the `docs/` planning notes predate the code. Pick the date you actually started. |
| **Demo video URL** (YouTube, public) | Does not exist yet. Required by the rules: 1–3 minutes, must show the app running and must name the YouCam API used. |

I also set **Submitter type = Individual** and **App Status = New** by inference. Change
either if wrong.

---

## Repository URL

```
https://github.com/AbinjithTK/glowdays
```

## Live app

```
https://9l79mtej8j.execute-api.us-east-1.amazonaws.com
```

Access code for reviewers is in `access-code.txt` (gitignored). Judges can also sign up
with Google or an email in about ten seconds — no verification email.

**Put the access code in the submission notes**, or judges will have to create an account
to get in.

---

## Video shot list (1–3 min, in this order)

The whole first-run path works. Shoot it on a phone, in one take if you can.

1. **Landing page** (5s) — the claim: it refuses to answer when evidence is thin.
2. **Continue with Google** (10s) — one tap in. Say "Neon Auth, shared-mode Google".
3. **Onboarding panel 2** (15s) — "same light, same spot". This is the panel that explains
   why the product exists. Let the icons and the stagger land.
4. **Capture** (25s) — show the diagnostics panel with the real resolution. Say the tier is
   measured from the image bytes on the server, not claimed by the client. Take the photo.
5. **Consent screen** (10s) — read the 30-day retention line aloud. This is a differentiator.
6. **Readings** (25s) — the check-in detail: overall score, per-metric readings, the
   analyser's detection masks, and the capture-conditions panel showing which signals were
   measured and which were not.
7. **Diary** (25s) — tap three stickers, attach a photo, save. Point out that the stickers
   are confounders, not moods.
8. **Trial verdict** (20s) — the confidence label, the prediction, and the "what else was
   going on" panel.
9. **Close** (10s) — "Every reading comes from Perfect Corp's YouCam AI Skin Analysis. The
   product is the judgement about whether two of them can be compared at all."

Say the words "YouCam AI Skin Analysis" out loud at least once — the rules require the video
to explain which API was used.

---

## Answer 1 — Text description of features, functionality and consumer/retail value

Glowdays is a private skin diary that answers one question other skin apps cannot: did the thing you tried actually do anything?

The problem is that two photographs of the same face under different conditions produce different numbers from the same analyser. An app that reports every difference as a change is not measuring your skin, it is measuring your bathroom. Glowdays treats every comparison as a measurement with error bars, and it is willing to say no.

FEATURES

1. Measured check-ins. You photograph your face; readings come from Perfect Corp's YouCam AI Skin Analysis. The analysis tier (HD or SD) is decided from the short side measured out of the image bytes on the server, never from what the client claims.

2. Confidence-gated comparisons. Before two check-ins are compared, five capture signals are graded: light level, light evenness, how much of the frame the face fills, and head yaw and pitch. Every comparison carries one of four confidence labels, and a comparison across mismatched tiers is refused outright rather than fudged. A refusal is a first-class answer with its own screen and explanation.

3. It never invents a measurement. Most browsers cannot measure head angle or face distance. Sending zeros would tell the confidence engine it saw a perfectly square-on head at an identical distance, which is the strongest possible evidence manufactured out of its own absence. Unmeasured signals are excluded from grading and cap the label at a directional check, and the capture screen tells you which signals it managed to measure before you upload.

4. Pre-registered trials. A trial names the single metric you expect a product to move, and for how long, before any evidence exists. Start one from a check-in that already happened and the server marks it exploratory, permanently, because a hypothesis formed after seeing the data is a different claim. One trial runs at a time, enforced by a database constraint, because two products started together produce a result you cannot attribute.

5. A diary that logs confounders, not moods. Twenty-two stickers in three groups: what you noticed, what happened to you, what you did to your skin. The last two are confounders; observations never are, because a stinging face is part of what needs explaining rather than an explanation. Tap three stickers, optionally add an instant-print photo, done in seconds with no writing required. The trial verdict then reports how many days of the window carried a confounder and why each matters, and an empty window says so explicitly, because nothing logged is not the same as nothing happened.

6. Region-level readings. Everything the analyser returns is stored and shown, with the summary region marked as the one comparisons use.

7. Direction is never colour. A metric moving down is not a failure. The delta component has no green or red variant to reach for: sign, arrow and word, always.

CONSUMER AND RETAIL VALUE

For a shopper: a defensible answer to "did it work", and the confidence to stop paying for something that did nothing. The average skincare routine is an unmeasured experiment costing hundreds a year.

For a brand or retailer: honest per-SKU efficacy evidence gathered from consenting users with capture conditions attached. That is worth considerably more than a five-star review, and it is the missing input for a genuine "worked for people like you" recommendation rather than one inferred from purchase history.

For a clinic: a shared record between appointments, with refusals that stop a patient over-reading a change actually caused by a sunburn.

PRIVACY

Photographs live in private storage, are never public, never in a feed, and never used to train a model. A photo is sent for analysis only after explicit per-check-in consent, and the consent screen states the provider's 30-day retention before the camera is ever opened. Images are served through short-lived presigned URLs. Any check-in, or the whole account, can be deleted, and the deletion copy is explicit that it cannot reach into the provider's own storage.

VERIFIED

The live pipeline was tested end to end against the deployed build using a face generated by YouCam's own text-to-image endpoint, so no real person's biometrics were involved: 8 concerns scored, 8 detection masks stored, overall 73.25, photo and masks resolving through presigned URLs, analysis complete in about nine seconds. The probe scripts in scripts/ reproduce it. 85 automated tests.

---

## Answer 2 — Was there a moment where the API surprised you?

Three times, and each one changed the product rather than just the code.

The good surprise was how candid the documentation is. It states plainly that ui_score is adjusted upward from raw_score because users prefer positive assessments. I have never seen an API document its own motivational bias that clearly, and it is genuinely useful: it told me exactly which field a product like this must never touch. Glowdays stores and compares raw_score only, and the app says so on screen. An API that had quietly shipped only the flattering number would have made an honest product impossible to build on it.

The expensive surprise was billing. I had assumed, and had written in a code comment, that a Skin Analysis call costs the same regardless of how many concerns you ask for. It does not: HD is banded at 12/16/20/22 units for 1-4/5-8/9-12/13-16 concerns. My code was requesting all sixteen while the UI surfaced eight, which is 22 units against 16 — on the 1,000-unit allocation that is 45 scans instead of 62. I had thrown away a quarter of my budget on a comment I never checked. It is now a typed concern set with an estimateUnits() function that prices a call before it is made.

Fixing that immediately exposed a second-order bug I would never have found otherwise. With only eight concerns requested, my local fixture's fake overall score became exactly the mean of the eight rows it returned — which is the one thing this UI must never imply, because the provider's all.score is a separate measurement and not an average of the concerns. A billing correction surfaced a fidelity bug in my own test double.

The frustrating surprise was subcategory granularity. The docs specify hd_pore across forehead, nose, cheek and whole, and hd_wrinkle across seven facial areas, and my parser resolves all of them in three different nestings with tests behind it. But a live result requested with format json comes back with exactly one raw_score per concern and no subcategories — the regional breakdown lives in score_info.json inside the ZIP result instead. The reference says the JSON response and score_info "share semantics", which is true of the field meanings and not of the granularity. I only found out because I tested against the live API with a real face rather than trusting my fixtures, and I corrected the claim in my README rather than shipping a promise the build does not keep. Reading the ZIP is the outstanding work.

A smaller one worth passing on: the mask filenames put output between the action and the region, as in hd_pore_output_nose, as well as at the end, as in hd_texture_output. My matcher originally only stripped it from the end, which silently dropped a reading rather than failing. A test caught it. Silent data loss in a parser is much worse than a crash, and that naming inconsistency is a good candidate for a documentation note.

---

## Answer 3 — Industries or use cases nobody is talking about

Four, and the common thread is that everyone is aiming this at the moment of purchase when the harder and more valuable problem is what happens in the weeks afterwards.

1. Efficacy substantiation for brands and regulators. Cosmetic claims are currently backed by small in-house panels under controlled lighting, or by star ratings that measure nothing. A Skin Analysis API plus enforced capture conditions and a confidence gate is the missing instrument for evidence gathered at consumer scale with the conditions attached. The commercially interesting part is not the score, it is the refusal: a claim supported only by comparisons the system itself declined to make is a claim you can identify and discard. That is auditable in a way a panel study is not, and advertising standards bodies would understand it immediately.

2. Occupational skin health. Hand and face dermatitis is one of the most common occupational illnesses in food service, healthcare, cleaning and hairdressing, and it is tracked today by a supervisor's eye and a paper form. Objective redness and barrier readings on a phone, logged against shift patterns and glove or product changes, is a real compliance and insurance product. Nobody in beauty tech is looking at it because it is not beauty.

3. Medication adherence and side-effect monitoring. Isotretinoin causes predictable dryness, topical steroids thin skin, and several oncology drugs cause rashes serious enough to interrupt treatment. Patients abandon courses because the side effects feel worse than they are, or push through ones that are genuinely dangerous. A diary that measures the side effect objectively between appointments, without claiming to diagnose anything, gives a clinician something better than recall. This needs the confidence gating more than any other use case, because here an over-claimed change has a clinical consequence.

4. Post-procedure recovery in aesthetics clinics. After a peel, laser or injectable there is a normal redness and firmness curve, and the anxious question is always whether you are on it. A clinic that hands you a recovery track with objective daily readings replaces reassurance with evidence, reduces unnecessary follow-up appointments, and gets a per-practitioner outcome dataset it can actually learn from.

One use case I would deliberately steer away from: anything that infers age, ethnicity or health status for targeting rather than for the user's own benefit. The same technology that supports these four supports profiling people by appearance, and the distinction is entirely in whether the reading belongs to the person or to whoever is selling to them.

---

## Answer 4 — Where did you hit a wall technically?

Three walls. The two most instructive were both cases where the failure was invisible from the client's side.

WALL 1: uploads failing with nothing in the logs.

On a phone, the capture button stuck on "Saving..." forever and CloudWatch showed only cold starts. My prime suspect was multipart form data through API Gateway, since the gateway base64-encodes binary bodies and a decode into a string rather than binary would corrupt the boundary. I tested that first and it was wrong: 40 KB and 3 MB multipart uploads both reached the handler cleanly.

So I probed for the real boundary instead of theorising, and found that 4.25 MB of raw image is delivered while 4.5 MB comes back 413 from API Gateway itself. That is Lambda's 6 MB synchronous request payload limit after base64 inflates binary by a third. Critically, a gateway 413 never invokes the function, so nothing appears in your logs at all — the request simply vanishes.

The fix is a client-side encode ladder that defends resolution before quality and holds the 1080-pixel short side that high-detail analysis requires, because dropping to 720 to save bytes would silently move a check-in into the standard tier, and the comparison engine refuses to compare across tiers. A byte-saving decision would have resurfaced weeks later as two check-ins mysteriously refusing to compare, with nothing to explain why. I also added a request deadline, since fetch has no default timeout and a request that is accepted and never answered leaves a button saying "Saving..." until the page is reloaded. And I added request logging, whose absence was the actual reason this cost a whole debugging cycle. The honest long-term fix is a presigned direct-to-S3 upload, which has no such ceiling.

WALL 2: the app confidently telling every user something false.

My pre-flight check enforced the provider's documented rule that the face must fill more than 60% of the frame width, comparing against a faceRatio value measured in the browser. But faceRatio can only be measured where the browser exposes a face detector, which is a flagged Chromium feature and absent from iOS Safari entirely. Everywhere else my client sent 0 as a placeholder. Zero is below the threshold, so every single check-in was refused with "Move a little closer".

That message is worse than a generic error, because it is confidently wrong: it names a cause nothing ever observed and asks for a correction that cannot change the number. Someone following the instruction gets the identical refusal from two inches away.

The fix was to apply the rule my confidence engine already followed and my admission gate did not: an unmeasured signal is not evidence. The client now sends which signals it actually measured, framing is only judged when framing was measured, and when it was not the scan is admitted, the comparison stays capped at a directional check, and if the face really is too small the provider says so itself — which I map to the same wording, but from something that actually looked. Six regression tests hold that invariant down.

WALL 3: Lambda Function URLs returning 403 on everything.

A textbook-correct resource policy, AuthType NONE, no service control policies and no resource control policies, and every path still 403. A direct lambda invoke proved the function itself was fine, so rather than keep debugging a door that would not open I put an API Gateway HTTP API in front of it and moved on. That is the decision that later imposed the 4.25 MB ceiling in Wall 1, which is a fair trade I would make again but is worth knowing is connected.

A smaller one, for anyone integrating Neon Auth: Better Auth requires an Origin header and refuses a request without one, and it does not care that the caller is a server rather than a browser. My backend-for-frontend forwarding pattern only worked once I sent an Origin explicitly, derived from configuration rather than forwarded from the client, since that value is what the CSRF check validates against and a caller must not get to choose it.
