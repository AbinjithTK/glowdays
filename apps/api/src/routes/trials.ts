/**
 * Trial routes.
 *
 * The interesting decision: `kind` is derived on the server, never sent by the
 * client.
 *
 * A trial is `pre_registered` when the metric was named before its baseline
 * existed, and `exploratory` when the user picked a metric after seeing scores.
 * That distinction decides whether the trial may ever feed pooled evidence,
 * because choosing the lowest metric and watching it rise measures regression
 * to the mean: an unusually low reading is unusual partly by chance, and the
 * chance part does not repeat. Any product looks effective under that design.
 *
 * So the flag is inferred from behaviour rather than asked for. Claiming an
 * existing scan as the baseline means the number was already on screen, which
 * is exactly the case that cannot be pooled. Starting with no baseline means
 * the prediction came first.
 *
 * The honest limit: someone could scan, look, discard the trial, and start a
 * "pre-registered" one tomorrow without claiming yesterday's scan. Nothing here
 * catches that. It is recorded as a known gap rather than papered over, because
 * a flag that pretends to more rigour than it has is worse than one that does
 * not.
 *
 * Exploratory trials run identically. They are labelled, not restricted.
 */

import { SCORE_METRICS, type MetricId } from '@glowdays/core';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.js';
import { product, scan, trial } from '../db/schema.js';
import { currentProfileId, type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';
import { compareScans } from '../services/comparison.js';

const METRIC_IDS = SCORE_METRICS.map((m) => m.id) as [MetricId, ...MetricId[]];

const CreateTrial = z.object({
  productId: z.string().uuid(),
  predictedMetric: z.enum(METRIC_IDS),
  /** 7 to 90 days. Outside that band a comparison is refused anyway. */
  durationDays: z.number().int().min(7).max(90),
  cadenceDays: z.number().int().min(1).max(30).default(14),
  /**
   * The scan this trial starts from. Its presence is what makes the trial
   * exploratory - see the note at the top of this file.
   */
  baselineScanId: z.string().uuid().optional(),
});

export const trialsRoute = new Hono<AppEnv>();

trialsRoute.post('/', async (c) => {
  const profileId = currentProfileId(c);
  const input = CreateTrial.parse(await c.req.json().catch(() => ({})));
  const database = db();

  const owned = await database
    .select({ id: product.id })
    .from(product)
    .where(and(eq(product.id, input.productId), eq(product.profileId, profileId)))
    .limit(1);
  if (!owned[0]) throw new AppError('not_found', 'No such product');

  let startsAt = new Date();
  let kind: 'pre_registered' | 'exploratory' = 'pre_registered';

  if (input.baselineScanId) {
    const baseline = await database
      .select({ capturedAt: scan.capturedAt, status: scan.status })
      .from(scan)
      .where(and(eq(scan.id, input.baselineScanId), eq(scan.profileId, profileId)))
      .limit(1);
    const row = baseline[0];
    if (!row) throw new AppError('not_found', 'No such check-in');
    if (row.status !== 'succeeded') {
      throw new AppError('conflict', 'That check-in has no readings yet');
    }
    startsAt = row.capturedAt;
    kind = 'exploratory';
  }

  const endsAt = new Date(startsAt.getTime() + input.durationDays * 86_400_000);

  try {
    const inserted = await database
      .insert(trial)
      .values({
        profileId,
        productId: input.productId,
        predictedMetric: input.predictedMetric,
        kind,
        status: 'active',
        startsAt,
        endsAt,
        cadenceDays: input.cadenceDays,
        lockedAt: new Date(),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new AppError('internal', 'Trial was not created');
    return c.json({ trial: row, pooling: poolingNote(kind) }, 201);
  } catch (err) {
    // The partial unique index refuses a second active trial. Overlapping
    // trials are confounded by definition, so this is a real conflict.
    if (isUniqueViolation(err)) {
      throw new AppError('conflict', 'A trial is already running', {
        detail:
          'Two products running at once cannot be told apart. Finish or stop the current one first.',
      });
    }
    throw err;
  }
});

trialsRoute.get('/', async (c) => {
  const profileId = currentProfileId(c);
  const includeArchived = c.req.query('archived') === 'true';

  const rows = await db()
    .select({
      id: trial.id,
      predictedMetric: trial.predictedMetric,
      kind: trial.kind,
      status: trial.status,
      startsAt: trial.startsAt,
      endsAt: trial.endsAt,
      cadenceDays: trial.cadenceDays,
      singleVariable: trial.singleVariable,
      productName: product.name,
      productBrand: product.brand,
    })
    .from(trial)
    .innerJoin(product, eq(product.id, trial.productId))
    .where(eq(trial.profileId, profileId))
    .orderBy(desc(trial.startsAt));

  // Archived trials stay reachable. The prototype's Trials screen had no route
  // to them at all, which made archiving indistinguishable from deleting.
  const visible = includeArchived ? rows : rows.filter((r) => r.status !== 'archived');
  return c.json({
    trials: visible.map((r) => ({ ...r, pooling: poolingNote(r.kind) })),
    archivedCount: rows.filter((r) => r.status === 'archived').length,
  });
});

/** Scans that fall inside the window. A trial claims them; it does not own them. */
trialsRoute.get('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const trialId = c.req.param('id');

  const rows = await db()
    .select()
    .from(trial)
    .where(and(eq(trial.id, trialId), eq(trial.profileId, profileId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', 'No such trial');

  const claimed = await db()
    .select({
      id: scan.id,
      capturedAt: scan.capturedAt,
      status: scan.status,
      tier: scan.tier,
      overallScore: scan.overallScore,
    })
    .from(scan)
    .where(eq(scan.profileId, profileId))
    .orderBy(scan.capturedAt);

  const inWindow = claimed.filter(
    (s) =>
      s.status === 'succeeded' &&
      s.capturedAt >= row.startsAt &&
      s.capturedAt <= row.endsAt,
  );

  let comparison = null;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (first && last && first.id !== last.id) {
    comparison = await compareScans(profileId, first.id, last.id);
  }

  return c.json({
    trial: row,
    pooling: poolingNote(row.kind),
    checkIns: inWindow,
    comparison,
  });
});

const UpdateStatus = z.object({
  status: z.enum(['completed', 'stopped', 'archived', 'active']),
});

trialsRoute.patch('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const { status } = UpdateStatus.parse(await c.req.json().catch(() => ({})));

  try {
    const updated = await db()
      .update(trial)
      .set({ status })
      .where(and(eq(trial.id, c.req.param('id')), eq(trial.profileId, profileId)))
      .returning();
    const row = updated[0];
    if (!row) throw new AppError('not_found', 'No such trial');
    // Every status change returns the trial, so the client can render a real
    // confirmation instead of guessing that the tap worked.
    return c.json({ trial: row, confirmed: status });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('conflict', 'Another trial is already running', {
        detail: 'Stop the active trial before restoring this one.',
      });
    }
    throw err;
  }
});

function poolingNote(kind: string): { poolable: boolean; reason: string } {
  return kind === 'pre_registered'
    ? {
        poolable: true,
        reason:
          'You named the metric before the first check-in, so this trial can be counted ' +
          'alongside others.',
      }
    : {
        poolable: false,
        reason:
          'You chose this metric after seeing your scores. A low reading tends to rise on ' +
          'its own, so this trial is kept out of any pooled evidence.',
      };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}
