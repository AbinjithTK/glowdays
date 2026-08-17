# Glowdays prototype â€” canonical dataset, interactions, motion

Every screen in the Flowstep v2 file uses these exact values. If a number appears on two screens it must match here, or the prototype reads as fiction when clicked through.

---

## 1. Canonical dataset

### Account
Abin Â· `abin@example.com` Â· diary created 6 July 2026 Â· today is 27 July 2026.

### The trial (pre-registered)
| Field | Value |
| --- | --- |
| One change | CeraVe Moisturising Lotion |
| Expected to move | Hydration |
| Duration | 8 weeks |
| Cadence | Every 2 weeks |
| Locked at | 6 July 2026, before baseline |
| State | Active, single variable, not confounded |

### Scans
| # | Date | Light | Tier | State | Confidence vs baseline |
| --- | --- | --- | --- | --- | --- |
| 1 | 6 July 2026 | Daylight | HD | succeeded | baseline |
| 2 | 20 July 2026 | Indoor | HD | succeeded | Use as a directional check |
| 3 | 27 July 2026 | Mixed | HD | succeeded | Treat with care |

The headline comparison in the prototype is **scan 1 â†’ scan 2**, which earns `Comparable capture`. Scan 3 exists to drive the low-confidence screen. Never show a comparison spanning HD and SD.

### Raw scores, 1â€“100, higher is better
| Metric | 6 Jul baseline | 20 Jul latest | Delta |
| --- | --- | --- | --- |
| Hydration (moisture) | 51.0 | 63.0 | +12.0 |
| Radiance | 44.0 | 51.5 | +7.5 |
| Pore appearance (whole) | 49.0 | 52.0 | +3.0 |
| Oiliness | 58.0 | 61.0 | +3.0 |
| Wrinkles (whole) | 66.0 | 66.5 | +0.5 |
| Texture | 62.0 | 60.5 | âˆ’1.5 |
| Acne | 71.0 | 69.0 | âˆ’2.0 |
| Redness | 63.0 | 60.0 | âˆ’3.0 |
| Overall | 58.0 | 62.4 | +4.4 |

Order metric lists by absolute delta, never by whether the movement is upward.

### Scan 3, the low-confidence pair: 6 Jul â†’ 27 Jul
Used only on the `Treat with care` screen. Mixed light, framing differed, so the same routine produces a smaller apparent movement â€” which is the point of the screen.

| Metric | 6 Jul baseline | 27 Jul | Delta |
| --- | --- | --- | --- |
| Hydration | 51.0 | 59.5 | +8.5 |
| Radiance | 44.0 | 48.0 | +4.0 |
| Texture | 62.0 | 59.5 | âˆ’2.5 |
| Overall | 58.0 | 60.1 | +2.1 |

### Regional breakdowns, 20 July
Because `hd_pore` and `hd_wrinkle` return regions, not one number.

**Pore appearance** â€” forehead 47.0, nose 41.5, cheek 58.0, **whole 52.0**
**Wrinkles** â€” forehead 71.0, glabellar 68.5, crowfeet 59.0, periocular 62.0, nasolabial 64.5, marionette 70.0, **whole 66.5**

### Timeline arithmetic â€” get this right, several screens currently disagree

Baseline 6 July is week 0. The cadence is every 2 weeks, so scheduled windows fall on 20 July and 3 August. The 27 July scan is an extra, off-cadence check-in.

| Statement | Correct value |
| --- | --- |
| Trial length | 8 weeks, 6 July to 31 August |
| Today, in the prototype | 27 July |
| Week label for 27 July | week 3 of 8 |
| Last scheduled window | 20 July |
| Next window | 3 August |
| Days from 27 July to next window | 7 days |

Known wrong on built screens: four Today states say `week 5 of 8`, and the Glowdays dashboard Today says `9 days` to the next window. Both should read `week 3 of 8` and `7 days`.

### Rhythm
3 check-ins in rhythm Â· 2 comparable pairs Â· next window opens 3 August.

Three scans exist, so the rhythm count is three, not four. Calendar month is July 2026: the 1st falls on a Wednesday and every check-in landed on a Monday â€” 6, 20 and 27 July.

### Product shelf
| Product | Role |
| --- | --- |
| CeraVe Moisturising Lotion | in this trial |
| La Roche-Posay Toleriane Cleanser | constant, unchanged since baseline |
| The Ordinary Niacinamide 10% | on the shelf, not in a trial |
| Beauty of Joseon Relief Sun SPF 50 | constant |

### Pooled evidence (descriptive only)
**CeraVe Moisturising Lotion**, above threshold: 47 pre-registered isolation trials Â· hydration moved up in 31, flat in 11, down in 5 Â· median +6.0 raw Â· 64% still using it at 12 weeks Â· pooled from high and medium confidence HD pairs only.

**The Ordinary Niacinamide 10%**, below threshold: 9 trials, minimum is 30. Panel withheld with the reason shown.

### Routine context on the 20 July check-in
Products used: CeraVe Moisturising Lotion, La Roche-Posay Toleriane Cleanser.
Note: "Less tightness after cleansing, still dry along the jaw."
Factors: Travel.

---

## 2. Interaction inventory

Every tappable thing in the prototype and what it does. No dead ends.

### Global
| Element | Action |
| --- | --- |
| Bottom bar Today / Diary | Switch destination, preserve scroll |
| Raised Check-in circle | Opens capture primer as a modal from the bottom |
| Avatar, top right of Today | Opens Me as a full-screen push |
| Back chevron | Pops one level, never loses entered form data |
| Sheet close X or backdrop tap | Dismisses, returns to the screen beneath |
| Trial name with chevron on Today | Opens trial switcher sheet |

### Capture flow
| Element | Action |
| --- | --- |
| Use camera | Requests permission on first tap only, then opens camera |
| Permission denied | Falls through to library path, never a dead end |
| Choose from library | System picker, returns to review |
| Shutter | Captures, haptic tick, pushes review |
| Retake | Returns to camera, discards nothing else |
| Light pills | Single select, updates the advisory copy live |
| Same-spot checkbox | Toggles, changes projected confidence beneath |
| Continue | Opens consent sheet over a dimmed form |
| Consent checkbox | Enables the analyse button, which is disabled until then |
| Analyse private check-in | Writes consent row, uploads, pushes status |
| Leave during processing | Scan persists as running, Today reflects it |
| Retry analysis | Reuses the same stored photo, never re-shoots |

### Evidence
| Element | Action |
| --- | --- |
| See what changed | Opens the comparison |
| See all metrics | Expands the full metric list |
| A metric row | Opens metric detail with regions |
| Photo / Mask segmented control | Swaps between source photo and the returned mask |
| Show photo | Reveals a blurred private photo for this session only |
| Question-mark icon | Opens the raw versus UI score sheet |
| Timeline row | Opens that scan's detail |

### Rhythm
| Element | Action |
| --- | --- |
| Calendar day with a check-in | Opens that scan |
| Calendar day, empty | Inert, not tappable, no guilt affordance |
| Next window chip | Opens the cue sheet |
| Cue toggle | Enables reminders, reveals day and time |

---

## 3. Motion specification

Restrained and fast. Motion explains where things came from; it never performs.

| Moment | Motion | Duration | Curve |
| --- | --- | --- | --- |
| Button press | Scale to 0.98, opacity 0.9 | 120ms | ease-out |
| Screen push | Slide in from right 24px with fade | 260ms | cubic-bezier(0.2, 0, 0, 1) |
| Sheet present | Translate up from +32px, backdrop to 40% | 220ms | ease-out |
| Sheet dismiss | Reverse, backdrop first | 180ms | ease-in |
| Pill select | Border and fill cross-fade, no bounce | 140ms | ease-out |
| Checkbox tick | Draw the tick over 160ms, box fill 100ms | 160ms | ease-out |
| Advisory copy change | Cross-fade the text only, height animates | 200ms | ease-out |
| Analysis step completing | Ring fills to a tick, one 400ms pulse of the ring at 1.04 scale | 400ms | ease-in-out |
| Analysis signal motif | Concentric rings fade in and out in sequence, 2.4s loop, opacity 0.35 to 0.7 only, no rotation, no scale | 2400ms loop | ease-in-out |
| Result arriving | Card cross-fades and rises 12px | 300ms | ease-out |
| Large number appearing | Fade only. Never count up, never roll digits | 240ms | ease-out |
| Delta pill appearing | Fade with 8px rise, staggered 40ms per row, top row first | 240ms | ease-out |
| Mask reveal | Cross-fade over the photo | 260ms | ease-out |
| Blurred photo reveal | Blur radius 20px to 0 | 320ms | ease-out |
| Calendar month change | Horizontal slide 16px with fade | 240ms | ease-out |
| Toast | Rise 16px, hold 3s, fade | 200ms in | ease-out |
| Destructive confirm | No motion flourish. Appears immediately | 0ms | â€” |

### Reduced motion
When the OS requests reduced motion: all slides and rises become cross-fades, the analysis motif becomes a static three-step list, the ring pulse is removed, and stagger is dropped so rows appear together. Nothing is removed from the interface, only its movement.

### Forbidden motion
No confetti. No success checkmark that bounces. No skeleton shimmer. No parallax. No count-up on a score, because a number climbing implies achievement and these numbers are measurements. No spinner over a photograph of a face. No rotating gradient. No progress bar that reports a percentage the server never gave us.

---

## 4. Haptics
| Event | Haptic |
| --- | --- |
| Shutter | Light impact |
| Pill or checkbox select | Selection tick |
| Consent granted | Light impact |
| Analysis succeeded | Success notification, once, only if app is foregrounded |
| Analysis failed | Warning notification, once |
| Destructive confirm | Medium impact on the confirming tap only |

No haptic on scroll, on screen transitions, or on results arriving in the background.
