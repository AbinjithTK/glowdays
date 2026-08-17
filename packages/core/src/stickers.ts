/**
 * Diary stickers.
 *
 * These look like decoration and are the opposite. The product exists to answer
 * one question - did this product do anything - and the honest answer depends
 * entirely on what else was going on. A week of bad sleep, a sunburn, a flight, or
 * starting a second product will each move a reading on their own, and a diary
 * that records only the score is quietly attributing all of that to whatever
 * happened to be in the trial.
 *
 * So a sticker is a logged confounder. Tapping four of them takes three seconds and
 * requires no typing, which is the only reason anyone does it at all - the journal
 * apps that get logged consistently are the ones that never demand a sentence. What
 * the confounders then buy is the ability for a verdict to say "hydration rose, and
 * you also logged five poor-sleep days in this window", instead of implying the
 * serum did it.
 *
 * Three groups, and the distinction is load-bearing:
 *
 *  - `observation` is something you noticed about your skin. It is an outcome, not
 *    a cause, so it never counts as a confounder. Logging "stung today" does not
 *    explain away a change; it is part of what is being explained.
 *  - `lifestyle` is something that happened to you.
 *  - `routine` is something you did to your skin.
 *
 * The last two are confounders. Treating an observation as one would let the app
 * dismiss its own findings using the very symptoms it is meant to be tracking.
 */

export type StickerKind = 'observation' | 'lifestyle' | 'routine';

export interface StickerDef {
  /** Stored in a note's tags. Stable; the emoji and wording may be restyled. */
  readonly id: string;
  readonly emoji: string;
  /** Shown under the emoji. Never emoji alone - it carries the meaning for
   *  anyone using a screen reader, and emoji render differently per platform. */
  readonly label: string;
  readonly kind: StickerKind;
  /**
   * Whether this plausibly moves a reading independently of a product under
   * test. Derived from `kind` rather than set by hand so the two cannot drift.
   */
  readonly confounder: boolean;
  /** Why it matters, shown when a verdict cites it. */
  readonly because: string;
}

function def(
  id: string,
  emoji: string,
  label: string,
  kind: StickerKind,
  because: string,
): StickerDef {
  return { id, emoji, label, kind, confounder: kind !== 'observation', because };
}

export const STICKERS: readonly StickerDef[] = [
  // ---- what you noticed. Outcomes, never confounders. ----
  def('calm', '😌', 'Calm', 'observation', 'Skin felt settled.'),
  def('stinging', '😖', 'Stung', 'observation', 'Something was irritating.'),
  def('tight', '🫥', 'Tight', 'observation', 'Skin felt dry or tight.'),
  def('oily', '✨', 'Shiny', 'observation', 'More oil than usual.'),
  def('breakout', '🔴', 'Breakout', 'observation', 'New spots appeared.'),
  def('flaky', '🍂', 'Flaky', 'observation', 'Visible flaking.'),

  // ---- what happened to you. Confounders. ----
  def('poor_sleep', '😴', 'Slept badly', 'lifestyle', 'Short sleep affects barrier recovery and under-eye readings.'),
  def('stress', '🌀', 'Stressed', 'lifestyle', 'Stress is linked to oil production and flare-ups.'),
  def('alcohol', '🍷', 'Drank', 'lifestyle', 'Alcohol is dehydrating and reddens skin for a day or two.'),
  def('sun', '🌞', 'Sun', 'lifestyle', 'Sun exposure changes redness and pigmentation readings directly.'),
  def('heat', '🥵', 'Hot and humid', 'lifestyle', 'Heat raises oil and sweat, which shifts shine and pores.'),
  def('cold', '🌬️', 'Cold or windy', 'lifestyle', 'Cold dry air pulls moisture out of the barrier.'),
  def('travel', '✈️', 'Travelled', 'lifestyle', 'Cabin air, water changes and lost sleep arrive together.'),
  def('cycle', '🩸', 'Cycle', 'lifestyle', 'Hormonal phase moves oil and breakouts on its own schedule.'),
  def('illness', '🤒', 'Unwell', 'lifestyle', 'Being ill changes sleep, hydration and inflammation at once.'),
  def('workout', '💪', 'Worked out', 'lifestyle', 'Sweat and friction affect pores and redness short-term.'),

  // ---- what you did to your skin. Confounders. ----
  def('new_product', '🧴', 'Started something', 'routine', 'A second new product makes any result unattributable.'),
  def('stopped_product', '🚫', 'Stopped something', 'routine', 'Removing a step is a change as real as adding one.'),
  def('exfoliated', '🧽', 'Exfoliated', 'routine', 'Exfoliation changes texture and pore readings immediately.'),
  def('retinoid', '🌙', 'Retinoid', 'routine', 'Retinoids cause a transition period before improvement.'),
  def('sunscreen', '🧢', 'Sunscreen', 'routine', 'Protects against the single largest outside variable.'),
  def('missed', '🌚', 'Skipped routine', 'routine', 'A gap in the routine is part of what is being tested.'),
];

const BY_ID = new Map<string, StickerDef>(STICKERS.map((s) => [s.id, s]));

export function sticker(id: string): StickerDef | null {
  return BY_ID.get(id) ?? null;
}

/** Resolve stored tags to stickers, dropping anything unrecognised. */
export function stickersFrom(tags: readonly string[]): StickerDef[] {
  return tags.map((t) => BY_ID.get(t)).filter((s): s is StickerDef => s !== undefined);
}

export function stickersOfKind(kind: StickerKind): StickerDef[] {
  return STICKERS.filter((s) => s.kind === kind);
}

/** The API caps a note at eight tags, so the picker must cap too. */
export const MAX_STICKERS_PER_ENTRY = 8;

export interface ConfounderSummary {
  /** Distinct confounders logged, most frequent first. */
  readonly counted: readonly { readonly sticker: StickerDef; readonly days: number }[];
  /** How many separate days carried at least one confounder. */
  readonly daysAffected: number;
  readonly totalDays: number;
}

/**
 * Summarise the confounders logged across a window.
 *
 * Counts *days*, not stickers. Someone who logs poor sleep twice on one day has
 * had one bad night, and counting tags would inflate a single day into a trend -
 * which is exactly the kind of overstatement this whole feature exists to prevent.
 */
export function summariseConfounders(
  entries: readonly { readonly noteOn: string; readonly tags: readonly string[] }[],
  totalDays: number,
): ConfounderSummary {
  const daysById = new Map<string, Set<string>>();
  const affected = new Set<string>();

  for (const entry of entries) {
    for (const found of stickersFrom(entry.tags)) {
      if (!found.confounder) continue;
      affected.add(entry.noteOn);
      const days = daysById.get(found.id) ?? new Set<string>();
      days.add(entry.noteOn);
      daysById.set(found.id, days);
    }
  }

  const counted = [...daysById.entries()]
    .map(([id, days]) => ({ sticker: BY_ID.get(id)!, days: days.size }))
    .sort((a, b) => b.days - a.days || a.sticker.label.localeCompare(b.sticker.label));

  return { counted, daysAffected: affected.size, totalDays };
}
