# Glowdays Retention & Engagement Strategy

**Scope:** ethical retention for a private wellness diary  
**Success definition:** the person returns when a check-in is useful, understands their record, and remains in control. Time-in-app, daily opens, and compulsive capture are not success metrics.

## 1. Research position

Glowdays should use behavior-support mechanisms, not growth hacks. The evidence base for mobile-health engagement is useful but heterogeneous: many studies identify associations between behavior-change techniques and engagement rather than universal causal rules. We will treat the mechanisms below as testable product hypotheses and stop or revise them if they reduce satisfaction, trust, or meaningful completion.

### Sources informing this strategy

| Finding used | Source | Product implication |
| --- | --- | --- |
| Goal setting, self-monitoring, feedback, prompts/cues, rewards, and social support were repeatedly associated with engagement across reviewed mHealth studies. | [Oâ€™Connor et al., systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10545861/) | Use self-monitoring, understandable feedback, and opt-in prompts; do not assume social mechanics belong in a face-data diary. |
| Reviews of self-report mHealth apps identify feedback/monitoring, goals/planning, associations, knowledge, and personalization as common techniques. | [Nussbaumer-Streit et al., systematic review](https://pubmed.ncbi.nlm.nih.gov/36083606/) | Make each check-in rewarding through useful evidence and allow the person to choose a repeat context. |
| â€œIfâ€“thenâ€ implementation intentions specify when, where, and how a person will act; the meta-analysis found a medium-to-large effect on goal attainment. | [Gollwitzer & Sheeran, 2006](https://www.socmot.uni-konstanz.de/publications/implementation-intentions-and-goal-achievement-meta-analysis-effects-and-processes) | Let people set a gentle plan such as â€œIf it is Sunday morning in my bathroom, Iâ€™ll take a check-in.â€ |
| Increasing autonomous motivation and perceived competence are valid intervention targets; evidence is stronger when people feel ownership rather than pressure. | [Sheeran et al., 2021 meta-analysis](https://pubmed.ncbi.nlm.nih.gov/34881939/); [Ntoumanis et al., 2021 meta-analysis](https://pubmed.ncbi.nlm.nih.gov/31983293/) | User-controlled goals, frequency, and reminders; explain confidence so users feel capable rather than judged. |
| Prompts can support digital-intervention engagement, but their effectiveness depends on design and context. | [Alkhaldi et al., systematic review](https://pubmed.ncbi.nlm.nih.gov/26747176/) | Send only contextually useful reminders, cap frequency, and let people choose timing/channel. |
| Apple advises concise, high-value notifications, avoiding repeated messages and sensitive content; Android gives users channel-level controls. | [Apple HIG: Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications/); [Android notification channels](https://developer.android.com/develop/ui/compose/notifications/channels) | One notification for a meaningful event, neutral lock-screen copy, and visible granular controls. |
| Repetition in a stable context is a component of habit formation; timing differs substantially by person and behavior. | [Lally et al., 2010](https://doi.org/10.1002/ejsp.674) | Encourage consistency, never promise a fixed â€œ21-dayâ€ habit result or demand daily scanning. |

## 2. Engagement model

```text
Meaningful question
        â†“
Easy first baseline â”€â†’ visible personal record
        â†“                       â†“
Chosen cue / cadence      understandable feedback
        â†“                       â†“
Comparable next check-in â† confidence-aware reflection
        â†“
Compassionate return after interruption
```

The loop is **monthly/weekly according to a userâ€™s chosen track**, not a daily streak loop. The app should frequently make it easy to leave after completing a useful task.

## 3. Retention mechanisms to implement

### 3.1 Activation: create a meaningful first record

**Mechanism:** self-chosen goal + low-friction first action.

**Product behavior**

- During onboarding, ask one question: `What are you trying to learn from this routine?`
- Offer examples without forcing a concern: `Does my skin feel less tight after this moisturiser?`
- After the first scan, show `Baseline saved` and explain the next evidence threshold.
- Do not force reminder permission during onboarding.

**Why it is ethical:** the user owns the experiment and sees a real artifact immediately. We do not imply that a baseline is a health verdict.

**Success signals**

- Onboarding completion.
- Baseline captured within the first 24 hours or saved as a draft.
- User can restate/see their goal on Today.

### 3.2 Implementation intention: turn â€œlaterâ€ into a chosen cue

**Mechanism:** optional when/where plan.

**UI**

After a baseline or successful check-in, show a bottom sheet:

> `Want a gentle cue for the next check-in?`  
> `If itâ€™s Sunday morning, after my usual routine, remind me.`

Controls:

- Cadence: no reminder / weekly / every 2 weeks / monthly / custom.
- Preferred day and time.
- Optional context phrase, visible only in-app, e.g. `after my Sunday routine`.
- Quiet delivery toggle.

**Guardrails**

- Default is `No reminder yet`.
- Never recommend daily capture.
- Editing or skipping a reminder does not reset progress.
- If a user has a low-confidence scan, offer `Choose a better time next time` rather than an immediate re-capture notification.

### 3.3 Self-monitoring and feedback: make data useful on return

**Mechanism:** a person returns when the app gives meaning back, not merely another task.

**Product behavior**

- Today shows only one next action and the most recent evidence state.
- Progress shows raw deltas alongside confidence rationale.
- A weekly/biweekly reflection card appears only after a completed check-in: `What was different about this capture?`
- Progress summaries omit facial images by default.

**Do not use**

- A red â€œdeclineâ€ dashboard.
- Rank/leaderboard comparisons.
- A feed of idealized faces.
- Cosmetic â€œscores to beat.â€

### 3.4 Competence: teach the capture skill just in time

**Mechanism:** feeling capable increases autonomous engagement.

**Product behavior**

- Guide framing, lighting, and context in the camera flow.
- Explain exactly why a pair is high, medium, or low confidence.
- Give one actionable correction at a time.
- Preserve every legitimate scan; never make a person feel they â€œfailedâ€ the app.

**Example copy**

| Situation | Copy |
| --- | --- |
| Mixed light | `This is still your check-in. Even light next time will make comparison clearer.` |
| One scan | `Your baseline is ready. A later comparable check-in adds the missing context.` |
| Lapse | `Nothing was lost. When you are ready, a new check-in continues this track.` |

### 3.5 Timely result delivery: notify only when value is ready

**Mechanism:** result availability is an earned reason to return.

**Push event**

- Trigger only when analysis changes from `running` to `succeeded` or `failed`.
- One push per scan result.
- Safe lock-screen title: `Your Glowdays check-in is ready.`
- Safe body: `Open your private timeline to review it.`
- Never include facial, metric, product, or health information in push content.

**In-app behavior**

- If the app is foregrounded, use a quiet result banner/badge instead of a system notification.
- If the user opens the result, mark the result notification consumed.

### 3.6 Compassionate recovery after a lapse

**Mechanism:** remove shame/friction that causes abandonment.

**Product behavior**

- After 1 missed planned check-in: no push; Today quietly says `Check in when conditions feel right.`
- After 7 days past a chosen cadence: one optional reminder if notifications are enabled.
- After 21 days: show an in-app â€œresumeâ€ card only; do not escalate notification frequency.
- Never use terms such as `overdue`, `broken streak`, `falling behind`, or `donâ€™t lose progress`.

**Resume card**

> `Your track is still here.`  
> `A new check-in will add context whenever youâ€™re ready.`

### 3.7 Private progress artifact

**Mechanism:** ownership and reflection increase perceived value without social pressure.

**Product behavior**

- Allow a privacy-safe text/PDF progress card after two successful scans.
- Exclude the face image, email, detailed notes, provider URLs, and raw unneeded metadata by default.
- Let the person decide whether to save/share outside the app; never prompt public sharing.

### 3.8 Optional education, not content farming

**Mechanism:** relevant understanding can reduce uncertainty.

**Product behavior**

- Use small â€œHow comparison worksâ€ explainers near confidence and raw metrics.
- Limit education to eight short, static, clinically neutral lessons.
- Do not generate infinite content feeds, fear-based skin tips, or product hooks.

## 4. Notification policy

### Notification categories

| Category | Default | Max frequency | Example |
| --- | --- | --- | --- |
| Analysis result | Opt-in requested after the user starts first analysis | One per scan | `Your Glowdays check-in is ready.` |
| Chosen check-in cue | Off by default | One per chosen cadence | `Your chosen check-in time is here when youâ€™re ready.` |
| Lapse recovery | Off unless cadence is active | One after 7 days; none after without new interaction | `Your track is still here when conditions are right.` |
| Product/news | Permanently off in v1 | 0 | Not implemented. |

### System behavior

- iOS: ask notification permission only after a person has seen the value of a baseline or chosen a reminder.
- Android: expose separate channels for `Analysis results` and `Check-in cues`.
- Respect Focus mode, OS-level notification settings, and quiet delivery settings.
- Every notification setting is reachable in two taps from Me.
- Each notification deep-links to one exact useful screen.

### Notification anti-patterns

- No repeated reminder because the person did not act.
- No â€œlast chance,â€ countdown, urgency, or beauty-pressure copy.
- No notification for a low raw score.
- No notification image, mask, or health-sensitive content.
- No â€œwe miss youâ€ campaign.

## 5. Data-driven personalization rules

Personalization may use only product data needed for the requested experience. Do not infer mood, diagnosis, identity, attractiveness, or purchasing intent.

| Signal | Allowed use | Forbidden use |
| --- | --- | --- |
| Chosen cadence/time | Schedule cue | Predicting when a person is vulnerable to pressure |
| Track goal | Tailor Today microcopy | Selling products or making health claims |
| Scan status | Send one result-ready event | Sharing result externally |
| Comparison confidence | Offer capture guidance | Withholding data or blaming the person |
| Recent routine text | Suggest recent chips on next entry | Advertising or training external models |

## 6. Measurement plan

### North-star metric

**Meaningful comparison rate:** percentage of newly created tracks that produce two successful scans within the user-selected cadence window and whose owner opens the resulting comparison.

This is better than daily active users because it aligns with the productâ€™s intended behavior.

### Supporting metrics

| Funnel | Metric | Warning interpretation |
| --- | --- | --- |
| Activation | First baseline within 7 days | Low rate may mean unclear privacy/capture flow. |
| Quality | Second completed scan within 45 days | Low rate may mean reminder/cadence mismatch, not user failure. |
| Trust | Consent-detail open rate and cancellation rate | A spike can identify confusing disclosure. |
| Utility | Comparison detail opened after result | Low rate may mean result copy is not meaningful. |
| Re-engagement | Voluntary return after a lapse | Never pair this with pressure experiments. |
| Harm guardrail | Notification opt-out, notification disable, delete-track/account rates, support complaints | Any material increase pauses reminder experiments. |

### Event taxonomy

Events contain only IDs, state names, app version, and coarse timestamps. Do **not** send image paths, images, notes, metric values, names, email, or notification body text to analytics.

```text
track_created
baseline_capture_started
baseline_capture_saved_draft
scan_submission_started
scan_status_changed { queued | running | succeeded | failed }
comparison_viewed { confidence }
reminder_configured { cadence, quiet_delivery }
reminder_sent { type }
reminder_opened { type }
notification_opted_out
track_deleted
account_deletion_started
```

## 7. Experiment backlog and stop rules

Run experiments sequentially, with a plain-language consent-compatible analytics notice. Never A/B test privacy disclosures, deletion access, or medical-sounding copy.

| Hypothesis | Variant | Success signal | Stop rule |
| --- | --- | --- | --- |
| An optional plan increases comparable follow-up without pressure | Baseline result offers no-plan vs. â€œchoose a gentle cueâ€ sheet | Second-scan rate and satisfaction | Stop if notification opt-out or deletion rises materially. |
| Clear confidence copy improves perceived usefulness | Generic label vs. rationale-first card | Comparison detail/open rate + user survey | Stop if users misread it as clinical certainty. |
| Recent-product chips reduce entry friction | Free text only vs. recent chips | Routine entry completion time | Stop if users report unwanted data reuse. |
| One safe result notification increases return | In-app only vs. opted-in result push | Result open within 72 hours | Stop if push disable rate increases. |

## 8. Release gates

Before releasing retention features:

- [ ] Users can use the app fully with notifications off.
- [ ] Notification copy has privacy review and lock-screen review.
- [ ] Every reminder has an explicit user preference, cadence, and stop path.
- [ ] No check-in flow requires a streak, score target, social share, or purchase.
- [ ] Analytics payload review proves no face image, metric value, note, or PII leaves the product telemetry boundary.
- [ ] At least five usability participants can explain why a comparison is high/medium/low confidence.
- [ ] Reminder copy is tested with people who missed a planned check-in and does not feel accusatory.

## 9. What success looks like after launch

The product is succeeding when users say:

- `I know when a scan is worth comparing.`
- `I can come back after a gap without feeling judged.`
- `I understand what the app stores and how to remove it.`
- `The reminder felt useful, not intrusive.`

If retention rises while notification disablement, deletion, confusion, or reported pressure rises too, treat that as failureâ€”not growth.
