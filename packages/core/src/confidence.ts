/**
 * The confidence engine.
 *
 * This decides whether two scans may be compared at all, and if so how much
 * weight the comparison carries. It is the product's central claim, so it is
 * pure, exhaustively tested, and refuses rather than guesses.
 *
 * Two things are hard rules, not judgements:
 *  - HD and SD are different instruments. Subtracting one from the other
 *    produces a number that means nothing, so it is refused outright.
 *  - Fewer than two usable scans is not a weak comparison, it is no comparison.
 *
 * Everything else is a graded signal over measured capture conditions.
 */

import type { Tier } from './metrics.js';

/**
 * The bands below are STARTING VALUES, not findings.
 *
 * An honest threshold for "this movement is not a finding" needs the provider's
 * own per-metric repeat-measurement spread, which is not published. Until the
 * test-retest study runs, the UI must describe confidence as provisional.
 * See docs/IMPLEMENTATION_PLAN.md, Stage 0.
 */
export const THRESHOLDS_ARE_PROVISIONAL = true as const;

export interface CaptureQuality {
  readonly tier: Tier;
  /** 0..1 ambient lighting level. */
  readonly lightingLevel: number;
  /** 0..1 luma difference between the eyes. Higher means more uneven. */
  readonly lightingUneven: number;
  /** 0.55..1 face width as a proportion of frame width. */
  readonly faceRatio: number;
  /** Degrees. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /**
   * Whether the face-derived values above were actually measured.
   *
   * `camerakit` means framing and head pose came from real detection.
   * `declared` means they did not, and the numbers carry no information.
   *
   * This exists because the alternative is worse than useless. A capture path
   * without face detection has to put something in those fields, and a zero
   * reads to the grader as a perfectly square-on head at identical distance -
   * manufacturing the strongest possible evidence out of its absence. Recording
   * the provenance means unmeasured signals can be excluded and the resulting
   * comparison capped, which is the honest answer.
   */
  readonly source: 'camerakit' | 'declared';
}

export interface ScanForComparison {
  readonly id: string;
  readonly capturedAt: Date;
  readonly quality: CaptureQuality;
}

export type ConfidenceLabel =
  | 'comparable_capture'
  | 'directional_check'
  | 'treat_with_care'
  | 'not_enough_evidence';

export type SignalId =
  | 'lightingLevel'
  | 'lightingUneven'
  | 'faceRatio'
  | 'headAngle'
  | 'daysApart';

/**
 * `unmeasured` is not a degree of badness. It means the signal was never
 * observed, so it can neither support nor undermine the comparison, and its
 * absence caps how much confidence the whole thing can carry.
 */
export type SignalStatus = 'ok' | 'loose' | 'bad' | 'unmeasured';

export interface SignalReading {
  readonly id: SignalId;
  readonly status: SignalStatus;
  /** Observed difference, or day count for `daysApart`. */
  readonly value: number;
  readonly label: string;
}

export type ComparisonVerdict =
  | {
      readonly kind: 'refused';
      readonly reason: 'tier_mismatch';
      readonly detail: string;
    }
  | {
      readonly kind: 'insufficient';
      readonly label: 'not_enough_evidence';
      readonly detail: string;
    }
  | {
      readonly kind: 'labelled';
      readonly label: Exclude<ConfidenceLabel, 'not_enough_evidence'>;
      readonly signals: readonly SignalReading[];
      /** The signal that cost the most confidence, for the one-line rationale. */
      readonly weakest: SignalReading | null;
      readonly daysApart: number;
      readonly provisional: true;
    };

interface Band {
  readonly ok: number;
  readonly loose: number;
}

/** Maximum tolerated difference between two scans for each band. */
export const BANDS = {
  lightingLevel: { ok: 0.1, loose: 0.2 },
  lightingUneven: { ok: 0.05, loose: 0.1 },
  faceRatio: { ok: 0.05, loose: 0.1 },
  /** Largest single-axis head rotation difference, in degrees. */
  headAngle: { ok: 3, loose: 7 },
} as const satisfies Record<string, Band>;

/** Days between scans. Too close and no routine could have acted. */
export const DAYS_APART = {
  ok: { min: 7, max: 90 },
  loose: { min: 3, max: 180 },
} as const;

function gradeDelta(delta: number, band: Band): SignalStatus {
  const d = Math.abs(delta);
  if (d <= band.ok) return 'ok';
  if (d <= band.loose) return 'loose';
  return 'bad';
}

function gradeDaysApart(days: number): SignalStatus {
  if (days >= DAYS_APART.ok.min && days <= DAYS_APART.ok.max) return 'ok';
  if (days >= DAYS_APART.loose.min && days <= DAYS_APART.loose.max) return 'loose';
  return 'bad';
}

const DAY_MS = 86_400_000;

export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * Ranked for picking the single signal worth naming. `unmeasured` sits between
 * loose and bad: it is more worth telling someone about than a slightly
 * different reading, and less than a condition that definitely broke.
 */
const RANK: Record<SignalStatus, number> = { ok: 0, loose: 1, unmeasured: 2, bad: 3 };

/**
 * Decide whether two scans can be compared, and how confidently.
 *
 * Order matters. The tier gate runs before anything else because a mismatch is
 * a refusal with its own screen, not a low-confidence comparison.
 */
export function assessComparison(
  baseline: ScanForComparison | null,
  latest: ScanForComparison | null,
): ComparisonVerdict {
  if (!baseline || !latest || baseline.id === latest.id) {
    return {
      kind: 'insufficient',
      label: 'not_enough_evidence',
      detail: 'Two comparable check-ins are needed before anything can be compared.',
    };
  }

  if (baseline.quality.tier !== latest.quality.tier) {
    return {
      kind: 'refused',
      reason: 'tier_mismatch',
      detail:
        'High detail and standard detail are two different instruments. ' +
        'Subtracting one from the other would produce a number that means nothing.',
    };
  }

  const a = baseline.quality;
  const b = latest.quality;
  const days = daysBetween(baseline.capturedAt, latest.capturedAt);

  const headAngleDelta = Math.max(
    Math.abs(a.yaw - b.yaw),
    Math.abs(a.pitch - b.pitch),
    Math.abs(a.roll - b.roll),
  );

  // If either capture lacked face detection, the framing and pose numbers on
  // both sides are meaningless, so neither is graded.
  const faceMeasured = a.source === 'camerakit' && b.source === 'camerakit';

  const signals: SignalReading[] = [
    {
      id: 'lightingLevel',
      status: gradeDelta(a.lightingLevel - b.lightingLevel, BANDS.lightingLevel),
      value: Math.abs(a.lightingLevel - b.lightingLevel),
      label: 'Light level',
    },
    {
      id: 'lightingUneven',
      status: gradeDelta(a.lightingUneven - b.lightingUneven, BANDS.lightingUneven),
      value: Math.abs(a.lightingUneven - b.lightingUneven),
      label: 'Even light',
    },
    {
      id: 'faceRatio',
      status: faceMeasured
        ? gradeDelta(a.faceRatio - b.faceRatio, BANDS.faceRatio)
        : 'unmeasured',
      value: faceMeasured ? Math.abs(a.faceRatio - b.faceRatio) : 0,
      label: 'Distance from the camera',
    },
    {
      id: 'headAngle',
      status: faceMeasured ? gradeDelta(headAngleDelta, BANDS.headAngle) : 'unmeasured',
      value: faceMeasured ? headAngleDelta : 0,
      label: 'Head angle',
    },
    {
      id: 'daysApart',
      status: gradeDaysApart(days),
      value: days,
      label: 'Time between check-ins',
    },
  ];

  const worst = signals.reduce<SignalReading | null>((acc, s) => {
    if (s.status === 'ok') return acc;
    if (!acc) return s;
    return RANK[s.status] > RANK[acc.status] ? s : acc;
  }, null);

  const bad = signals.filter((s) => s.status === 'bad').length;
  const loose = signals.filter((s) => s.status === 'loose').length;
  const unmeasured = signals.filter((s) => s.status === 'unmeasured').length;

  let label: Exclude<ConfidenceLabel, 'not_enough_evidence'>;
  if (bad > 0) label = 'treat_with_care';
  else if (loose === 0) label = 'comparable_capture';
  else if (loose === 1) label = 'directional_check';
  else label = 'treat_with_care';

  /**
   * An unobserved signal caps the ceiling. "Comparable capture" is a claim that
   * everything lined up, and it cannot be made about conditions nobody checked -
   * the user was never framed or angled measurably, so the strongest honest
   * statement is that this points in a direction.
   */
  if (unmeasured > 0 && label === 'comparable_capture') {
    label = 'directional_check';
  }

  return {
    kind: 'labelled',
    label,
    signals,
    weakest: worst,
    daysApart: days,
    provisional: true,
  };
}

const LABEL_COPY: Record<Exclude<ConfidenceLabel, 'not_enough_evidence'>, string> = {
  comparable_capture: 'Comparable capture',
  directional_check: 'Use as a directional check',
  treat_with_care: 'Treat with care',
};

export function labelText(label: ConfidenceLabel): string {
  if (label === 'not_enough_evidence') return 'Not enough evidence';
  return LABEL_COPY[label];
}

/**
 * One sentence naming the weakest input. One rationale, never a list, so the
 * user is told the single thing that mattered most.
 */
export function rationale(verdict: ComparisonVerdict): string {
  if (verdict.kind === 'refused') return verdict.detail;
  if (verdict.kind === 'insufficient') return verdict.detail;
  if (!verdict.weakest) {
    return 'Same framing, even light, and both at the same detail level.';
  }
  const w = verdict.weakest;

  // Say plainly that something was not checked, rather than describing it as
  // though it had been and come out badly.
  if (w.status === 'unmeasured') {
    return w.id === 'faceRatio'
      ? 'This camera could not measure how much of the frame your face filled, so distance is unaccounted for.'
      : 'This camera could not measure your head angle, so a turn between the two is unaccounted for.';
  }

  switch (w.id) {
    case 'lightingLevel':
      return 'The light was brighter in one of these two check-ins.';
    case 'lightingUneven':
      return 'The light fell unevenly across your face in one of these.';
    case 'faceRatio':
      return 'You were closer to the camera in one of these.';
    case 'headAngle':
      return 'Your head was turned further in one of these.';
    case 'daysApart':
      return verdict.daysApart < DAYS_APART.loose.min
        ? 'These two check-ins are too close together for a routine to have acted.'
        : 'A long gap between these two makes the cause harder to attribute.';
  }
}
