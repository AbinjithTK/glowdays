/**
 * Deterministic stand-in for a provider response.
 *
 * This deliberately emits the documented JSON *shape*, nesting and all, rather
 * than a pre-parsed object. If it returned tidy internal structures the parser
 * would never be exercised until the first live call, which is exactly when a
 * shape mistake is most expensive.
 *
 * Two properties matter:
 *
 *  - Deterministic from the task id, so a demo replays identically and a
 *    hot reload does not change the numbers under you.
 *  - `all.score` is computed over all sixteen metrics, not over the eight the
 *    UI shows. That mirrors the real API, which computes the overall figure
 *    independently. It means the displayed overall will not equal the mean of
 *    the visible rows, and the app must show the provider's number rather than
 *    deriving one - a mismatch we already shipped once in the prototype.
 */

import {
  METRICS,
  metricsForSet,
  type ConcernSet,
  type MetricDef,
  type Tier,
} from '@glowdays/core';

/** FNV-1a. Small, stable, and no dependency. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic value in [0,1) from a seed pair. */
function unit(seed: string, salt: string): number {
  return hash(`${seed}::${salt}`) / 0x100000000;
}

/** Mid-range starting points. Nothing here is a claim about real skin. */
const BASE: Record<string, number> = {
  hydration: 51,
  radiance: 44,
  redness: 62,
  pore: 49,
  oiliness: 57,
  acne: 71,
  texture: 55,
  wrinkles: 66,
  ageSpot: 64,
  darkCircle: 53,
  eyeBag: 58,
  droopyUpperEyelid: 70,
  droopyLowerEyelid: 72,
  firmness: 61,
  tearTrough: 59,
};

const SKIN_TYPES = [
  'Normal',
  'Oily',
  'Dry',
  'Combination',
  'Redness',
  'Dry & Redness',
  'Oily & Redness',
  'Combination & Redness',
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number): number {
  return Math.min(99, Math.max(1, n));
}

function scoreFor(seed: string, def: MetricDef, region: string): number {
  const base = BASE[def.id] ?? 60;
  // +/- 6 around the base, plus a small per-region offset.
  const drift = (unit(seed, `${def.id}:${region}`) - 0.5) * 12;
  const regional = region === 'whole' ? 0 : (unit(seed, `r:${def.id}:${region}`) - 0.5) * 8;
  return round2(clamp(base + drift + regional));
}

/**
 * The provider adjusts ui_score upward for user comfort. Reproduced here so
 * that anything comparing ui_score by mistake produces visibly wrong numbers
 * in development rather than plausible ones.
 */
function uiScore(raw: number): number {
  return Math.min(100, Math.round(raw + 6 + (100 - raw) * 0.08));
}

function maskUrl(base: string, action: string, region: string): string {
  const q = new URLSearchParams({ action, region });
  return `${base}/dev/fixture-mask?${q.toString()}`;
}

export interface FixtureOptions {
  /** Absolute base for generated mask URLs. */
  readonly publicBase?: string;
  /** Match the breadth a live call at this setting would return. */
  readonly concernSet?: ConcernSet;
}

export function fixtureAnalysis(taskId: string, tier: Tier, opts: FixtureOptions = {}): unknown {
  const base = opts.publicBase ?? `http://localhost:${process.env['PORT'] ?? 8787}`;
  const output: unknown[] = [];

  for (const def of metricsForSet(opts.concernSet ?? 'all')) {
    const action = def.action[tier];
    const regions = def.regions[tier];

    if (def.kind === 'categorical') {
      const zones = regions ?? ['whole'];
      output.push({
        type: action,
        subcategories: zones.map((zone) => ({
          type: zone,
          skin_type:
            SKIN_TYPES[Math.floor(unit(taskId, `${action}:${zone}`) * SKIN_TYPES.length)] ??
            'Normal',
        })),
      });
      continue;
    }

    const whole = scoreFor(taskId, def, 'whole');

    const entry: Record<string, unknown> = {
      type: action,
      raw_score: whole,
      ui_score: uiScore(whole),
      output_mask_name: `${action}_output.png`,
      mask_urls: [maskUrl(base, action, 'whole')],
    };

    // Regional metrics nest their parts. `whole` is computed independently by
    // the provider, so it is not the mean of the parts here either.
    const parts = (regions ?? []).filter((r) => r !== 'whole');
    if (parts.length > 0) {
      entry['subcategories'] = parts.map((region) => {
        const raw = scoreFor(taskId, def, region);
        return {
          type: region,
          raw_score: raw,
          ui_score: uiScore(raw),
          output_mask_name: `${action}_output_${region}.png`,
          mask_urls: [maskUrl(base, action, region)],
        };
      });
    }

    output.push(entry);
  }

  /**
   * The overall figure is computed across all sixteen metrics, whatever subset
   * was requested.
   *
   * This mirrors the real API, which derives `all.score` independently rather
   * than averaging the concerns you asked for. It matters: when this was
   * computed from the returned subset instead, requesting eight concerns made
   * the overall exactly the mean of the eight visible rows - which is the one
   * thing the UI must never imply, and is the bug that put a headline delta 1.8
   * times its own metrics on screen in the prototype.
   */
  const allWhole = METRICS.filter((m) => m.kind === 'score').map((def) =>
    scoreFor(taskId, def, 'whole'),
  );
  const mean = allWhole.reduce((a, b) => a + b, 0) / allWhole.length;

  return {
    task_status: 'success',
    results: { output },
    all: { score: round2(mean) },
    skin_age: 24 + Math.floor(unit(taskId, 'age') * 14),
  };
}
