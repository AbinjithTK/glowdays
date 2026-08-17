/**
 * Metric registry.
 *
 * Every fact here is taken from the YouCam AI Skin Analysis v2.1 documentation.
 * See docs/YOUCAM_API_REFERENCE.md. Two asymmetries in the provider's API are
 * encoded deliberately because they are easy to get wrong:
 *
 *  1. HD and SD action names are not a simple prefix swap. Dark circle is
 *     `hd_dark_circle` in HD but `dark_circle_v2` in SD.
 *  2. Regions exist only in HD. `hd_pore` returns four areas and `hd_wrinkle`
 *     returns seven, but the SD equivalents return a single value each.
 *
 * Higher is always a better condition, for every score metric, including acne
 * and redness. The UI legend depends on this being true everywhere.
 */

export type Tier = 'hd' | 'sd';

/** Higher raw_score always means a better skin condition. Provider-wide. */
export const HIGHER_IS_BETTER = true as const;

export type MetricId =
  | 'hydration'
  | 'radiance'
  | 'redness'
  | 'pore'
  | 'oiliness'
  | 'acne'
  | 'texture'
  | 'wrinkles'
  | 'ageSpot'
  | 'darkCircle'
  | 'eyeBag'
  | 'droopyUpperEyelid'
  | 'droopyLowerEyelid'
  | 'firmness'
  | 'tearTrough'
  | 'skinType';

export type MetricKind = 'score' | 'categorical';

export interface MetricDef {
  readonly id: MetricId;
  /** User-facing label. Deliberately not always the provider's word. */
  readonly label: string;
  /** Provider `dst_actions` value, per tier. */
  readonly action: { readonly hd: string; readonly sd: string };
  /** Subcategories returned per tier. `null` means a single value. */
  readonly regions: {
    readonly hd: readonly string[] | null;
    readonly sd: readonly string[] | null;
  };
  readonly kind: MetricKind;
  /** Shown in the v1 UI. Unsurfaced metrics are still requested and stored. */
  readonly surfaced: boolean;
}

const PORE_REGIONS = ['forehead', 'nose', 'cheek', 'whole'] as const;
const WRINKLE_REGIONS = [
  'forehead',
  'glabellar',
  'crowfeet',
  'periocular',
  'nasolabial',
  'marionette',
  'whole',
] as const;
const ZONE_REGIONS = ['whole', 't_zone', 'u_zone'] as const;

export const METRICS: readonly MetricDef[] = [
  // ---- the eight the UI shows ----
  {
    id: 'hydration',
    label: 'Hydration',
    action: { hd: 'hd_moisture', sd: 'moisture' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'radiance',
    label: 'Radiance',
    action: { hd: 'hd_radiance', sd: 'radiance' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'redness',
    label: 'Redness',
    action: { hd: 'hd_redness', sd: 'redness' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'pore',
    label: 'Pore appearance',
    action: { hd: 'hd_pore', sd: 'pore' },
    regions: { hd: PORE_REGIONS, sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'oiliness',
    label: 'Oiliness',
    action: { hd: 'hd_oiliness', sd: 'oiliness' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'acne',
    label: 'Acne',
    action: { hd: 'hd_acne', sd: 'acne' },
    regions: { hd: ['whole'], sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'texture',
    label: 'Texture',
    action: { hd: 'hd_texture', sd: 'texture' },
    regions: { hd: ['whole'], sd: null },
    kind: 'score',
    surfaced: true,
  },
  {
    id: 'wrinkles',
    label: 'Wrinkles',
    action: { hd: 'hd_wrinkle', sd: 'wrinkle' },
    regions: { hd: WRINKLE_REGIONS, sd: null },
    kind: 'score',
    surfaced: true,
  },

  // ---- requested and stored, not shown in v1 ----
  {
    id: 'ageSpot',
    label: 'Age spots',
    action: { hd: 'hd_age_spot', sd: 'age_spot' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'darkCircle',
    label: 'Dark circles',
    // Naming asymmetry in the provider API. Not a prefix swap.
    action: { hd: 'hd_dark_circle', sd: 'dark_circle_v2' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'eyeBag',
    label: 'Eye bags',
    action: { hd: 'hd_eye_bag', sd: 'eye_bag' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'droopyUpperEyelid',
    label: 'Upper eyelid',
    action: { hd: 'hd_droopy_upper_eyelid', sd: 'droopy_upper_eyelid' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'droopyLowerEyelid',
    label: 'Lower eyelid',
    action: { hd: 'hd_droopy_lower_eyelid', sd: 'droopy_lower_eyelid' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'firmness',
    label: 'Firmness',
    action: { hd: 'hd_firmness', sd: 'firmness' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },
  {
    id: 'tearTrough',
    label: 'Tear trough',
    action: { hd: 'hd_tear_trough', sd: 'tear_trough' },
    regions: { hd: null, sd: null },
    kind: 'score',
    surfaced: false,
  },

  // ---- categorical, cannot be differenced, has no home in a comparison UI ----
  {
    id: 'skinType',
    label: 'Skin type',
    action: { hd: 'hd_skin_type', sd: 'skin_type' },
    regions: { hd: ZONE_REGIONS, sd: ZONE_REGIONS },
    kind: 'categorical',
    surfaced: false,
  },
] as const;

const BY_ID = new Map<MetricId, MetricDef>(METRICS.map((m) => [m.id, m]));

export function metric(id: MetricId): MetricDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown metric: ${id}`);
  return found;
}

/** The eight shown in the v1 UI, in registry order. */
export const SURFACED_METRICS: readonly MetricDef[] = METRICS.filter((m) => m.surfaced);

/** Numeric metrics only. `skinType` is excluded because it cannot be compared. */
export const SCORE_METRICS: readonly MetricDef[] = METRICS.filter((m) => m.kind === 'score');

/**
 * How many concerns to request.
 *
 * `surfaced` asks for the eight the UI shows. `all` asks for all sixteen.
 */
export type ConcernSet = 'surfaced' | 'all';

/**
 * Unit cost, from the provider's own pricing endpoint, verified 14 Aug 2026.
 *
 * This corrects a decision that was documented here on a false premise. The
 * previous comment claimed "a single call costs the same regardless" and
 * requested all sixteen metrics on that basis. Billing is banded by concern
 * count, so sixteen HD concerns cost 22 units where eight cost 16 - a 37%
 * premium for eight metrics no screen displays.
 *
 * On the 1,000-unit free allocation that is 45 scans against 62.
 */
export const CONCERN_COST = {
  hd: { 4: 12, 8: 16, 12: 20, 16: 22 },
  sd: { 4: 9, 8: 12, 12: 14, 16: 16 },
} as const;

/**
 * The counter-argument, which is real: a photograph cannot be re-analysed later.
 * The provider deletes the upload after 30 days, and the user may delete theirs
 * sooner, so a metric not requested now is a metric that can never be recovered
 * for that day.
 *
 * That is a genuine trade and it is why this is configurable rather than
 * decided here. `surfaced` is the default because stretching a finite allocation
 * across more check-ins is worth more to this product than eight unsurfaced
 * metrics: the whole thesis rests on having enough scans to compare, and a
 * comparison needs two.
 */
export function actionsForTier(tier: Tier, set: ConcernSet = 'surfaced'): string[] {
  const chosen = set === 'all' ? METRICS : METRICS.filter((m) => m.surfaced);
  return chosen.map((m) => m.action[tier]);
}

/** Metric definitions for a concern set, so a fixture can mirror a real call. */
export function metricsForSet(set: ConcernSet): readonly MetricDef[] {
  return set === 'all' ? METRICS : SURFACED_METRICS;
}

/** What one analysis will cost, so it can be logged and budgeted. */
export function estimateUnits(tier: Tier, set: ConcernSet = 'surfaced'): number {
  const count = actionsForTier(tier, set).length;
  const band = count <= 4 ? 4 : count <= 8 ? 8 : count <= 12 ? 12 : 16;
  return CONCERN_COST[tier][band as 4 | 8 | 12 | 16];
}

/** Subcategories the provider returns for this metric at this tier. */
export function regionsFor(id: MetricId, tier: Tier): readonly string[] | null {
  return metric(id).regions[tier];
}

/**
 * The region a summary row should display. The provider computes `whole`
 * independently rather than averaging the parts, so it is the only region
 * that stays comparable across scans.
 */
export const SUMMARY_REGION = 'whole' as const;
