# Working notes — building 100 screens in Flowstep over MCP

**What this is:** the messy middle. A record of driving Flowstep from an IDE agent rather than the web app, what the tool did well, where it broke, and the workflow that emerged in response.

**Setup:** Flowstep MCP server (`https://api.flowstep.ai/mcp`, streamable HTTP) wired into Kiro on Windows. Every screen created, read, verified and patched from the editor. No screens drawn by hand.

**Output:** one file, ~100 screens, one app. 43 Flowstep messages consumed of 80 monthly.

---

## 1. The single most important discovery

**The design guidelines file is the design system, and editing it is how you steer.**

Everything else is downstream. We rewrote it five times, and each rewrite changed every subsequent generation without touching a single existing screen:

| Version | Change | Effect |
| --- | --- | --- |
| v1 | Warm plum/rose palette, tokens, prohibitions | Baseline consistency across 5 screens |
| v2 | Added simplicity rules and 3-tab navigation | Screens stopped competing for attention |
| v3 | Swapped to Google-style colour | Immediately read as generic AI output — reverted |
| v4 | Accessible palette (measured), explicit anti-generic clause | New screens passed AA by default |
| v5 | Accent-per-metric, icon rules, whitespace rules | Colour arrived without becoming a dashboard |

The v3 → v4 reversal is the useful lesson. Blue `#1A73E8` on white with a soft-shadow card is the median output of every design generator, and the guidelines are where you forbid it. We added a literal clause: *"Never look like generated software."* Subsequent generations obeyed it.

**Practical note:** the tool soft-validates the frontmatter and tells you what it ignored. It rejected `platform`, `viewport`, `character` and `fonts` as unknown keys. Useful — it means the prose body carries more weight than the YAML, so type rules belong in the markdown, not the header.

---

## 2. Tool surface actually used

| Tool | Used for | Verdict |
| --- | --- | --- |
| `update-design-guidelines` | The system of record | Highest leverage in the whole API |
| `create-new-design` | Batches of 3–5 new screens | Fast, non-deterministic on controls |
| `edit-design` | Systemic passes, e.g. recolouring 3 screens in one call | Excellent for colour, poor for structure |
| `expand-design` (`next_screen`) | Deriving the consent sheet from the form it sits over | Visually anchors to the source screen — better than generating fresh |
| `add-screen` | Code-first import of hand-patched JSX | The reliability escape hatch |
| `get-screen` | Reading JSX back out | The thing that makes the loop possible |
| `get-screen-image` | Verifying every single screen | Non-negotiable. Never trust a generation unseen |
| `upload-attachment` | Grounding generation in a 19k-character UX spec | Measurably better copy fidelity |
| `get-plan-details` | Quota management mid-build | Useful for pacing batches |
| `list-screens` | Recovering from dropped responses | Essential, see §4 |

---

## 3. The defect taxonomy

Roughly **two in five generated screens needed a code fix.** Not random — the same six failures recur, and knowing them changes how you prompt.

**1. Interactive controls emit with no styling.** The most common by far. Pills, chips and segmented controls come back as `<button>Hydration</button>` with no `className` at all, rendering as bare text with no border, no fill, no selected state. Hit this on at least eight screens.

**2. Prompting the same fix twice does not work.** We asked for real bordered pills three times across two files, in increasingly explicit language. Failed every time. The code path worked first time, every time.

**3. Component overrides silently lose brand colour.** `<Switch>` rendered black despite an explicit `data-[state=checked]:bg-[#A8465E]`. Two attempts failed. A hand-built div toggle worked immediately.

**4. Disabled buttons render black.** `<Button>` with no className becomes a solid black block — dangerous on a destructive screen, where "Delete my account" and "Keep my account" ended up visually identical.

**5. Content overflows the viewport.** Sheets and pinned-footer screens routinely lose their bottom actions. Four screens needed restructuring so the footer stayed pinned and the content scrolled.

**6. Invented data.** A password field materialised containing the plaintext string `genuine1`. Metric rows duplicated one row's values into two others. **Always verify numbers against a canonical dataset.**

### The workflow that emerged

```text
generate (create-new-design)
   → verify (get-screen-image)      ← never skip
   → if control/data/overflow defect:
        get-screen  → patch JSX locally → add-screen
   → verify again
```

Costs no message quota, since `add-screen` is an import rather than a generation. The tradeoff is a duplicate screen per fix and no delete tool over MCP, so canvas hygiene is manual.

---

## 4. The failure mode that cost the most time

**A dropped response looks identical to a failed call, but the work completed server-side.**

Three times the MCP connection closed mid-generation. Each time the screens had actually been created. Retrying produced duplicates — including three near-identical Today screens and two complete sets of the same five explainer screens.

The rule we adopted: **on a stall, never retry. Call `list-screens` first.** It saved a third duplicate set.

Related: five screens per call is near the timeout boundary. Three per call is materially more reliable, at the cost of more messages, since quota is per call not per screen.

---

## 5. Where generation beat hand-design

**State families are the wrong job for prompting, and the right job for code.** Six Today states generated individually drifted — the active tab lost its colour on two, a quiet row moved vertically on three, and one dropped its text entirely. Pixel-identical states matter because a prototype that jumps when you click between states reads as broken.

Fix: take the cleanest generated screen, read its JSX, and emit the remaining states from it as a template with swapped strings. All six then matched exactly.

**Novel layouts are the right job for prompting.** Screens with no precedent — a tier-mismatch refusal with a `≠` glyph on a divider, a pooled-evidence panel whose default state withholds data, a calendar with a trial window drawn as a band — came back close to intent on the first attempt. That is genuinely faster than drawing them.

The split we settled on: **generate novel layouts, template state variants.**

---

## 6. What we measured rather than assumed

Two audits the tool doesn't do for you, both of which changed the design:

**Contrast.** Computed WCAG ratios for fifteen colour pairings in the system. Four failed AA: rose text at 4.13:1, rose on paper at 4.45:1, white on the rose button at 4.45:1, and secondary text at 4.42:1. All needed 4.5:1. Fixed by darkening rose to `#A8465E` (5.19:1) and secondary text to `#6B5F5B` (5.63:1). Unselected control borders measured 1.22:1 against a 3:1 requirement.

**Large text.** Rebuilt the densest screen at 200% type. About 60% of the content fell below the fold, and side-by-side rows collided. The first fix attempt removed the collisions but not the information loss — the finding was still buried under framing. The second attempt led with the numbers and deferred the rationale behind a tap. That before-and-after pair is the clearest evidence in the whole project that the accessibility work was real rather than claimed.

---

## 7. Honest verdict on the tool

**What it is genuinely good at:** holding a visual system across a hundred screens via the guidelines file; producing novel, copy-dense layouts close to intent on the first attempt; and being drivable entirely from an editor, which means design work sits in the same loop as everything else.

**What it needs:** deterministic interactive controls, a delete tool over MCP, and idempotent generation so a dropped response cannot produce duplicates.

**What surprised us:** that the correct workflow is hybrid. Not "AI designs it" and not "I design it", but generate for novelty, read the JSX back, and patch for determinism. The `get-screen` tool is what makes that possible and it is the most underrated thing in the API.
