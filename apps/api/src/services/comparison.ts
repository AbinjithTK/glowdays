/**
 * Comparisons.
 *
 * This is the product. Everything else is a diary; this is the part that claims
 * something, so it is the part most able to mislead.
 *
 * Four rules are enforced here rather than in the UI:
 *
 *  1. The confidence verdict is computed before any delta. If two scans cannot
 *     be compared, no numbers are produced at all - not greyed out, not shown
 *     with a warning. There is nothing to grey out.
 *
 *  2. Only `raw_score` is differenced. `ui_score` is adjusted upward by the
 *     provider to read more favourably, so comparing it would manufacture
 *     improvement.
 *
 *  3. Only the `whole` region is compared across scans. The provider computes
 *     whole independently of its parts, so it is the one figure that stays
 *     consistent between two calls. Regional readings are returned for a single
 *     scan's detail view, not for movement.
 *
 *  4. The overall figure is the provider's, carried through untouched. It will
 *     not equal the mean of the eight visible rows, and displaying a recomputed
 *     mean next to eight rows that produce a different one is how the prototype
 *     ended up with a headline delta 1.8 times what its metrics supported.
 */

import {
  assessComparison,
  labelText,
  rationale,
  SUMMARY_REGION,
  SURFACED_METRICS,
  type ComparisonVerdict,
  type MetricId,
  type ScanForComparison,
  type Tier,
} from '@glowdays/core';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import { captureQuality, scan, scanMetric } from '../db/schema.js';
import { AppError } from '../http/problem.js';

export interface MetricMovement {
  readonly metric: MetricId;
  readonly label: string;
  readonly baseline: number | null;
  readonly latest: number | null;
  readonly delta: number | null;
}

export type ComparisonResponse =
  | {
      readonly outcome: 'refused';
      readonly reason: string;
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly outcome: 'insufficient';
      readonly title: string;
      readonly detail: string;
    }
  | {
      readonly outcome: 'comparison';
      readonly label: string;
      readonly labelId: string;
      readonly rationale: string;
      readonly provisional: true;
      readonly daysApart: number;
      readonly signals: readonly {
        id: string;
        label: string;
        status: string;
        value: number;
      }[];
      readonly baselineScanId: string;
      readonly latestScanId: string;
      readonly tier: Tier;
      /** The provider's overall figure for each scan, carried through as-is. */
      readonly overall: {
        readonly baseline: number | null;
        readonly latest: number | null;
        readonly delta: number | null;
      };
      readonly movements: readonly MetricMovement[];
    };

interface LoadedScan extends ScanForComparison {
  readonly tier: Tier;
  readonly overallScore: number | null;
}

async function loadForComparison(profileId: string, scanIds: string[]): Promise<LoadedScan[]> {
  const rows = await db()
    .select({
      id: scan.id,
      capturedAt: scan.capturedAt,
      tier: scan.tier,
      status: scan.status,
      overallScore: scan.overallScore,
      lightingLevel: captureQuality.lightingLevel,
      lightingUneven: captureQuality.lightingUneven,
      faceRatio: captureQuality.faceRatio,
      yaw: captureQuality.yaw,
      pitch: captureQuality.pitch,
      roll: captureQuality.roll,
      // Carried through because it decides whether framing and pose are graded
      // at all. Dropping it here would silently restore the old behaviour of
      // treating an unmeasured head angle as a perfect one.
      source: captureQuality.source,
    })
    .from(scan)
    .innerJoin(captureQuality, eq(captureQuality.scanId, scan.id))
    .where(and(eq(scan.profileId, profileId), inArray(scan.id, scanIds)));

  return rows
    .filter((r) => r.status === 'succeeded')
    .map((r) => ({
      id: r.id,
      capturedAt: r.capturedAt,
      tier: r.tier,
      overallScore: r.overallScore,
      quality: {
        tier: r.tier,
        lightingLevel: r.lightingLevel,
        lightingUneven: r.lightingUneven,
        faceRatio: r.faceRatio,
        yaw: r.yaw,
        pitch: r.pitch,
        roll: r.roll,
        source: r.source,
      },
    }));
}

/** The two most recent successful scans, oldest first. */
export async function latestPair(profileId: string): Promise<[LoadedScan, LoadedScan] | null> {
  const rows = await db()
    .select({ id: scan.id })
    .from(scan)
    .where(and(eq(scan.profileId, profileId), eq(scan.status, 'succeeded')))
    .orderBy(desc(scan.capturedAt))
    .limit(2);
  if (rows.length < 2) return null;
  const ids = rows.map((r) => r.id);
  const loaded = await loadForComparison(profileId, ids);
  if (loaded.length < 2) return null;
  const sorted = [...loaded].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second) return null;
  return [first, second];
}

async function wholeRegionScores(scanId: string): Promise<Map<MetricId, number>> {
  const rows = await db()
    .select({ metric: scanMetric.metric, rawScore: scanMetric.rawScore })
    .from(scanMetric)
    .where(and(eq(scanMetric.scanId, scanId), eq(scanMetric.region, SUMMARY_REGION)));

  const map = new Map<MetricId, number>();
  for (const row of rows) {
    if (row.rawScore === null) continue;
    map.set(row.metric as MetricId, row.rawScore);
  }
  return map;
}

function describe(verdict: ComparisonVerdict): ComparisonResponse | null {
  if (verdict.kind === 'refused') {
    return {
      outcome: 'refused',
      reason: verdict.reason,
      title: 'These two cannot be compared',
      detail: verdict.detail,
    };
  }
  if (verdict.kind === 'insufficient') {
    return {
      outcome: 'insufficient',
      title: 'Not enough evidence yet',
      detail: verdict.detail,
    };
  }
  return null;
}

export async function compareScans(
  profileId: string,
  baselineId: string,
  latestId: string,
): Promise<ComparisonResponse> {
  const loaded = await loadForComparison(profileId, [baselineId, latestId]);
  const baseline = loaded.find((s) => s.id === baselineId) ?? null;
  const latest = loaded.find((s) => s.id === latestId) ?? null;

  if (!baseline || !latest) {
    // Either it is not theirs, or it has no readings yet. Both are the same
    // answer from outside: there is nothing here to compare.
    throw new AppError('not_found', 'Those two check-ins are not both ready');
  }

  return buildComparison(baseline, latest);
}

export async function compareLatest(profileId: string): Promise<ComparisonResponse> {
  const pair = await latestPair(profileId);
  if (!pair) {
    return {
      outcome: 'insufficient',
      title: 'Not enough evidence yet',
      detail: 'Two completed check-ins are needed before anything can be compared.',
    };
  }
  return buildComparison(pair[0], pair[1]);
}

async function buildComparison(
  baseline: LoadedScan,
  latest: LoadedScan,
): Promise<ComparisonResponse> {
  const verdict = assessComparison(baseline, latest);
  const early = describe(verdict);
  if (early) return early;
  if (verdict.kind !== 'labelled') {
    throw new AppError('internal', 'Unexpected comparison verdict');
  }

  const [before, after] = await Promise.all([
    wholeRegionScores(baseline.id),
    wholeRegionScores(latest.id),
  ]);

  const movements: MetricMovement[] = SURFACED_METRICS.map((def) => {
    const b = before.get(def.id) ?? null;
    const a = after.get(def.id) ?? null;
    return {
      metric: def.id,
      label: def.label,
      baseline: b,
      latest: a,
      delta: b !== null && a !== null ? round1(a - b) : null,
    };
  });

  // Largest absolute movement first. A decline that big matters as much as a
  // rise that big, and sorting by signed value would bury it.
  movements.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));

  const overallDelta =
    baseline.overallScore !== null && latest.overallScore !== null
      ? round1(latest.overallScore - baseline.overallScore)
      : null;

  return {
    outcome: 'comparison',
    label: labelText(verdict.label),
    labelId: verdict.label,
    rationale: rationale(verdict),
    provisional: true,
    daysApart: verdict.daysApart,
    signals: verdict.signals.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      value: round2(s.value),
    })),
    baselineScanId: baseline.id,
    latestScanId: latest.id,
    tier: latest.tier,
    overall: {
      baseline: baseline.overallScore,
      latest: latest.overallScore,
      delta: overallDelta,
    },
    movements,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
