# Devpost submission, final text

Draft is live and saved: https://devpost.com/software/glowdays
Submit here: https://youcam-api.devpost.com/ then "My submission"

**Closes 17 Aug 2026 at 15:45 UTC, which is 11:45am ET.** Judging runs 18 to 31 August, so
the app has to stay up for two more weeks.

Already saved on the project: name, tagline, the whole description, 18 "Built with" tags,
the live link, the repo link, submitter type, app status, and the repo URL field.

The four long answers below were sent twice. Both times the submit bounced on the two
personal fields, so I cannot confirm they stuck. **Check the form. If any answer box is
empty, paste it from here.**

---

## Three things only you can fill

| Field | Why it is blank |
| --- | --- |
| **Country of residence** | Yours to give, not mine to guess. |
| **Start date, MM-DD-YY** | I do not know it. Submissions opened 07-06-26 and your planning notes came before the code. Use the date you actually started. |
| **Demo video URL** | Does not exist yet. The rules want 1 to 3 minutes, public on YouTube, showing the app working and saying which YouCam API you used. |

I set submitter type to **Individual** and app status to **New**. Change either if that is wrong.

Also add the reviewer code from `access-code.txt` into the submission notes. Without it a
judge has to create an account before they can see anything.

## Links

Repo: `https://github.com/AbinjithTK/glowdays`
Live app: `https://9l79mtej8j.execute-api.us-east-1.amazonaws.com`

---

## Video, nine shots, in this order

Shoot it on a phone. Every one of these works right now.

1. **Landing page**, 5 seconds. The line about refusing to answer when the evidence is thin.
2. **Continue with Google**, 10 seconds. One tap in. Mention Neon Auth.
3. **Onboarding, second panel**, 15 seconds. "Same light, same spot." This is the panel that
   explains why the app exists at all.
4. **Capture**, 25 seconds. Show the panel with the real camera resolution on it. Say the
   server measures the tier from the image itself rather than trusting the phone. Take the shot.
5. **Consent screen**, 10 seconds. Read the 30 day retention line out loud.
6. **Readings**, 25 seconds. Overall score, the per metric readings, the analyser's detection
   masks, and the panel showing which capture signals were measured and which were not.
7. **Diary**, 25 seconds. Tap three stickers, attach a photo, save. Say the stickers are
   things that could have caused a change, not moods.
8. **Trial verdict**, 20 seconds. The confidence label, what you predicted, and the panel
   listing what else was going on that week.
9. **Close**, 10 seconds. "Every reading comes from Perfect Corp's YouCam AI Skin Analysis.
   What I built is the judgement about whether two of them can be compared at all."

Say "YouCam AI Skin Analysis" out loud at least once. The rules require the video to explain
which API you used.

Grab screenshots while you are in there: landing, onboarding, capture, readings, diary, trial
verdict. Screenshots are required too.

---

## Answer 1: features, functionality, and value to a shopper or a retailer

Glowdays is a private skin diary that answers the one question other skin apps dodge: did the thing you tried actually do anything?

Here is the problem. Photograph the same face twice in different light and the same analyser gives you different numbers. So an app that calls every difference a change is not measuring your skin. It is measuring your bathroom. Glowdays treats every comparison as a measurement, with the uncertainty that comes with one, and it is willing to tell you no.

WHAT IT DOES

You photograph your face. The readings come from Perfect Corp's YouCam AI Skin Analysis. The server decides whether to run HD or SD by measuring the short side out of the image bytes itself, rather than trusting what the phone claims about its own camera.

It says no when it should. Before comparing two check-ins it grades five things about how the photos were taken: how bright the light was, how evenly it fell, how much of the frame your face filled, and how your head was turned and tilted. Every comparison arrives with one of four confidence labels. If the two photos came from different analysis tiers, it refuses outright instead of fudging it, and the refusal gets its own screen and its own explanation.

It never makes a number up. Most phone browsers cannot measure your head angle or how far away you are. I could have sent zero. But zero means "perfectly square on, identical distance", which is the strongest possible evidence, invented out of nothing. So signals that were not measured get left out of the grading and cap the label at a directional check. The capture screen tells you which ones it managed to measure before you upload anything.

You commit before you get to conclude. Starting a trial means naming one metric you think a product will move and how long you will give it, recorded before any evidence exists. Start one from a check-in you already took and the server marks it exploratory, permanently, because a guess made after seeing the data is a different kind of guess. Only one trial runs at a time, enforced by the database, because two products at once means you cannot tell which one did anything.

The diary tracks what else was going on. Twenty-two stickers in three groups: what you noticed, what happened to you, what you did to your skin. The last two count against a result. What you noticed never does, because "my skin stung" is the thing that needs explaining, not the explanation. Three taps and you are done, no typing needed. Add a photo and it sits on the page like an instant print. When a trial ends, the verdict tells you how many days of that window had something else going on and why each one matters. Log nothing and it says so, because an empty diary is not the same as a quiet month.

Nothing is ever green or red. A number going down is not a failure, so there is no green or red version of the change indicator to reach for. Only a sign, an arrow and a word.

WHO IT IS FOR

If you buy skincare: a straight answer to "did that do anything", and permission to stop paying for something that did not. Most routines are an unmeasured experiment costing a few hundred a year.

If you sell it: real evidence per product, from people who agreed to give it, with the photo conditions attached to every reading. That is worth far more than a star rating, and it is what you would need to honestly say "this worked for people like you" instead of guessing from what someone bought before.

If you run a clinic: something to look at together between appointments, and refusals that stop a patient reading too much into a change their holiday caused.

PRIVACY

Photos go to private storage. Never public, never in a feed, never used to train anything. A photo is only sent for analysis after you agree to it, one check-in at a time, and the consent screen tells you the analyser keeps its own copy for up to 30 days before you ever open the camera. Images load through short lived signed links. You can delete a single check-in or the whole account, and the wording is honest that deleting here cannot reach into the provider's storage.

PROOF

I tested the whole pipeline against the deployed app using a face generated by YouCam's own text to image endpoint, so no real person's photo was involved. Eight concerns scored, eight detection masks stored, overall 73.25, photo and masks both loading through signed links, done in about nine seconds. The scripts that do it are in the repo. There are 85 tests.

---

## Answer 2: did the API surprise you?

Three times, and each one changed the product rather than just the code.

The good surprise was how honest the docs are. They say straight out that ui_score is nudged upward from raw_score because people prefer a positive assessment. I have never seen an API admit its own motivational bias that plainly, and it was genuinely useful. It told me exactly which field this app must never touch. Glowdays stores and compares raw_score only, and says so on screen. If the API had quietly shipped just the flattering number, an honest product would have been impossible to build on top of it.

The expensive surprise was the billing. I had assumed a Skin Analysis call costs the same no matter how many concerns you ask for. I had even written that in a code comment. It is not true. HD is banded: 12, 16, 20 or 22 units for 1 to 4, 5 to 8, 9 to 12 or 13 to 16 concerns. My code was asking for all sixteen while the app only showed eight, so I was paying 22 units for 16 units of value. On a 1,000 unit allowance that is 45 scans instead of 62. I had thrown away a quarter of my budget because of a comment I never checked.

Fixing it immediately turned up a second bug I would never have found any other way. Once I was only asking for eight concerns, the fake overall score in my local test fixture became exactly the average of the eight rows it returned. That is the one thing this app must never imply, because the provider's overall score is its own measurement and not an average of the concerns. So a billing fix exposed a fidelity bug in my own test double.

The frustrating surprise was subcategories. The docs are specific: hd_pore comes back for forehead, nose, cheek and whole, and hd_wrinkle for seven areas of the face. My parser handles all of it, in three different possible shapes, with tests. But when you request the result as JSON you get exactly one score per concern and no subcategories at all. The regional breakdown lives in a separate file inside the ZIP result. The reference says the JSON response and that file share semantics, which is true about what the fields mean and not true about how much detail you get. I only found out because I ran a real face through the live API instead of trusting my fixtures. Rather than leave a promise in my README that the build does not keep, I corrected the README. Reading the ZIP is the work I did not get to.

One smaller thing worth passing on. The mask filenames put the word output in the middle, like hd_pore_output_nose, as well as at the end, like hd_texture_output. My matcher originally only stripped it from the end, so it silently dropped a reading instead of failing. A test caught it. Quietly losing data is much worse than crashing, and that naming inconsistency would be worth a line in the docs.

---

## Answer 3: use cases nobody is talking about

Four, and they have something in common. Everyone is pointing this technology at the moment someone decides to buy. The harder and more valuable problem is what happens in the weeks after.

1. Backing up product claims, for brands and for regulators. Right now a cosmetic claim rests on a small in-house panel under controlled lighting, or on star ratings that measure nothing at all. Skin analysis plus enforced photo conditions plus a confidence gate is the missing instrument for gathering that evidence at consumer scale with the conditions attached to every reading. The commercially interesting part is not the score. It is the refusal. If a claim only survives because you counted comparisons the system itself declined to make, that is now something you can spot and throw out. A panel study cannot be audited that way. An advertising standards body would understand it instantly.

2. Skin at work. Hand and face dermatitis is one of the most common work related illnesses in kitchens, hospitals, cleaning and hairdressing. Today it gets tracked by a supervisor's eye and a paper form. Objective redness and barrier readings on a phone, logged against shift patterns and changes of glove or product, is a real compliance and insurance product. Nobody in beauty tech is looking at it, because it is not beauty.

3. Staying on medication. Isotretinoin dries you out in a predictable way. Steroid creams thin skin. Several cancer drugs cause rashes bad enough to interrupt treatment. People abandon courses because the side effect feels worse than it is, or push through one that is genuinely dangerous. A diary that measures the side effect between appointments, without claiming to diagnose anything, gives a clinician something better than what the patient remembers. This is the use case that needs the confidence gating most, because here an overstated change has a clinical consequence.

4. Recovery after a procedure. After a peel, laser or injectable there is a normal redness and firmness curve, and the anxious question is always whether you are on it. A clinic that sends you home with a recovery track and daily readings replaces reassurance with evidence, cuts down on unnecessary follow up appointments, and ends up with outcome data per practitioner that it can actually learn from.

One direction I would steer away from. Anything that reads age, ethnicity or health from a face in order to target someone rather than help them. The same technology that makes those four work also makes profiling people by appearance work. The whole difference is whether the reading belongs to the person or to whoever is selling to them.

---

## Answer 4: where did you hit a wall?

Three walls. The two worst ones were both cases where the failure was completely invisible from the outside.

WALL ONE: uploads failing with nothing in the logs.

On a phone the capture button stuck on "Saving..." forever. CloudWatch showed nothing but cold starts. My first suspicion was multipart form data through API Gateway, because the gateway base64 encodes binary bodies and decoding that into a string instead of bytes would wreck the boundary. I tested that first and I was wrong. A 40 KB upload and a 3 MB upload both reached my handler cleanly.

So instead of theorising I went looking for the actual boundary. It turns out 4.25 MB of raw image gets through and 4.5 MB comes back as a 413 from API Gateway itself. That is Lambda's 6 MB request limit, once base64 has inflated the image by a third. The part that cost me the afternoon is that a 413 from the gateway never invokes the function, so nothing appears in your logs at all. The request just disappears.

The fix is a ladder on the client that shrinks the photo to fit, and defends resolution before it sacrifices quality. It holds the 1080 pixel short side that HD analysis needs, because dropping to 720 to save bytes would silently move that check-in into the standard tier, and the comparison engine refuses to compare across tiers. Saving a few bytes today would have come back weeks later as two check-ins mysteriously refusing to compare, with nothing on screen to explain why. I also gave every request a deadline, because fetch has no timeout by default and a request that is accepted and never answered leaves a button saying "Saving..." until you reload the page. And I added request logging, whose absence was the real reason this took so long to find.

WALL TWO: the app confidently telling every single user something false.

I was enforcing the provider's documented rule that a face has to fill more than 60% of the frame, checked against a value measured in the browser. But that value can only be measured where the browser exposes a face detector, which is a flagged Chromium feature and does not exist in iOS Safari at all. Everywhere else my own client was sending zero as a placeholder. Zero is below 60%, so every check-in got refused with "Move a little closer".

That is worse than a generic error, because it is confidently wrong. It names a cause nothing ever observed and asks for a fix that cannot change the number. Follow the instruction and you get the identical refusal from two inches away.

The fix was applying a rule my own confidence engine already followed and my admission check did not: something nobody measured is not evidence. The client now says which signals it actually measured. Framing is only judged when framing was measured. When it was not, the photo goes through, the resulting comparison stays capped at a directional check, and if the face genuinely is too small the provider tells me so itself, which I show with the same wording, except now it comes from something that actually looked. Six tests keep it that way.

WALL THREE: Lambda Function URLs returning 403 on everything.

Correct resource policy, auth type set to none, no service control policies, no resource control policies, and still 403 on every path. Invoking the function directly proved the function was fine. Rather than keep pushing on a door that would not open, I put an API Gateway in front of it and moved on. That decision is what later gave me the 4.25 MB ceiling in wall one. Fair trade, and I would make it again, but the two are connected and it is worth knowing that.

One small one for anyone wiring up Neon Auth. Better Auth requires an Origin header and refuses a request without one, and it does not care that the caller is a server rather than a browser. My server side forwarding only started working once I sent an Origin explicitly, taken from config rather than passed through from the client, because that value is exactly what the CSRF check is validating and a caller must not get to pick it.
