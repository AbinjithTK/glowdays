/**
 * Check-in routes.
 *
 * `GET /scans/:id` advances a running provider task as a side effect of being
 * read. That is unusual for a GET, and deliberate: it means a client that was
 * closed mid-analysis gets its result by simply opening the screen again, with
 * no queue, no worker and no callback URL. A webhook is the provider's
 * documented preference and the right production answer; this is the fallback
 * that works from a laptop.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import { captureQuality, scan } from '../db/schema.js';
import { config } from '../env.js';
import { currentProfileId, type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';
import { MAX_IMAGE_BYTES } from '../media/dimensions.js';
import {
  CONSENT_POLICY_VERSION,
  createScan,
  loadScan,
  recordConsent,
  refreshAnalysis,
  scanMasksFor,
  scanReadings,
  startAnalysis,
} from '../services/analysis.js';
import { storage } from '../storage/factory.js';
import { presentError } from '../youcam/errors.js';

const CaptureMeta = z.object({
  /** ISO timestamp from the device. Never accepted for a future moment. */
  capturedAt: z.string().datetime().optional(),
  source: z.enum(['camerakit', 'declared']).default('camerakit'),
  preset: z.enum(['STRICT', 'MODERATE', 'RELAXED']).default('MODERATE'),
  lightingLevel: z.number().min(0).max(1),
  lightingUneven: z.number().min(0).max(1),
  faceRatio: z.number().min(0).max(1),
  yaw: z.number().min(-90).max(90),
  pitch: z.number().min(-90).max(90),
  roll: z.number().min(-90).max(90),
  /**
   * Which of the three signal groups were genuinely measured. Optional, because
   * a client that does not say leaves `source` as the coarser fallback.
   */
  measured: z.array(z.enum(['lighting', 'framing', 'pose'])).optional(),
  /** Colour commentary only. Never an input to confidence. */
  declaredLight: z.string().max(40).optional(),
});

export const scansRoute = new Hono<AppEnv>();

// ------------------------------------------------------------------- create

scansRoute.post('/', async (c) => {
  const profileId = currentProfileId(c);
  const body = await c.req.parseBody();

  const file = body['image'];
  if (!(file instanceof File)) {
    throw new AppError('invalid_request', 'No photo was attached', {
      detail: 'Send the photo as multipart form data under the field name "image".',
    });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError('invalid_request', 'That photo is larger than 10 MB');
  }

  const rawMeta = body['meta'];
  if (typeof rawMeta !== 'string') {
    throw new AppError('invalid_request', 'Capture measurements are missing', {
      detail: 'A check-in without measured capture conditions could not be given a confidence label.',
    });
  }

  let meta: z.infer<typeof CaptureMeta>;
  try {
    meta = CaptureMeta.parse(JSON.parse(rawMeta));
  } catch (err) {
    throw new AppError('invalid_request', 'Capture measurements were not readable', {
      detail: err instanceof Error ? err.message : 'Malformed meta field.',
    });
  }

  // A photo may never be backdated. Notes may; a photo carries a measurement,
  // and letting the client choose when it happened would let it choose which
  // trial window claims it.
  const claimed = meta.capturedAt ? new Date(meta.capturedAt) : new Date();
  const now = Date.now();
  const capturedAt =
    Number.isFinite(claimed.getTime()) && Math.abs(claimed.getTime() - now) < 10 * 60 * 1000
      ? claimed
      : new Date(now);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const created = await createScan({
    profileId,
    capturedAt,
    bytes,
    metrics: {
      lightingLevel: meta.lightingLevel,
      lightingUneven: meta.lightingUneven,
      faceRatio: meta.faceRatio,
      yaw: meta.yaw,
      pitch: meta.pitch,
      roll: meta.roll,
      preset: meta.preset,
      source: meta.source,
      ...(meta.measured ? { measured: meta.measured } : {}),
      ...(meta.declaredLight ? { declaredLight: meta.declaredLight } : {}),
    },
  });

  return c.json(
    {
      scan: created,
      consent: {
        required: true,
        policyVersion: CONSENT_POLICY_VERSION,
        /**
         * The corrected retention figure. The prototype said 24 hours on five
         * screens, which understated the provider's own stated period by 30x
         * inside a consent flow.
         */
        providerRetentionDays: 30,
      },
    },
    201,
  );
});

// --------------------------------------------------------------------- list

scansRoute.get('/', async (c) => {
  const profileId = currentProfileId(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);

  const rows = await db()
    .select({
      id: scan.id,
      capturedAt: scan.capturedAt,
      tier: scan.tier,
      status: scan.status,
      overallScore: scan.overallScore,
      errorCode: scan.errorCode,
    })
    .from(scan)
    .where(eq(scan.profileId, profileId))
    .orderBy(desc(scan.capturedAt))
    .limit(limit);

  return c.json({
    scans: rows.map((r) => ({
      ...r,
      error: r.errorCode ? presentError(r.errorCode) : null,
    })),
  });
});

// ------------------------------------------------------------------ consent

scansRoute.post('/:id/consent', async (c) => {
  const profileId = currentProfileId(c);
  const agreed = await c.req.json().catch(() => ({}));
  if (agreed?.agree !== true) {
    throw new AppError('invalid_request', 'Consent was not given', {
      detail: 'Send { "agree": true } to confirm.',
    });
  }
  await recordConsent(profileId, c.req.param('id'));
  return c.json({ consented: true, policyVersion: CONSENT_POLICY_VERSION });
});

// ------------------------------------------------------------------ analyse

scansRoute.post('/:id/analyse', async (c) => {
  const profileId = currentProfileId(c);
  const summary = await startAnalysis(profileId, c.req.param('id'));
  return c.json({ scan: summary });
});

// ---------------------------------------------------------------- read one

scansRoute.get('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const scanId = c.req.param('id');

  // Advance the provider task if one is in flight. See the note at the top.
  await refreshAnalysis(profileId, scanId);

  const row = await loadScan(profileId, scanId);
  const [readings, masks, quality] = await Promise.all([
    scanReadings(scanId),
    scanMasksFor(scanId),
    db().select().from(captureQuality).where(eq(captureQuality.scanId, scanId)).limit(1),
  ]);

  const ttl = config().SIGNED_URL_TTL_SECONDS;
  const store = storage();

  const photoUrl = row.imageKey ? await store.signedGetUrl(row.imageKey, ttl) : null;
  const maskUrls = await Promise.all(
    masks.map(async (m) => ({
      metric: m.metric,
      region: m.region,
      url: await store.signedGetUrl(m.storageKey, ttl),
    })),
  );

  const scanRow = await db()
    .select({ overallScore: scan.overallScore, skinAge: scan.skinAge })
    .from(scan)
    .where(and(eq(scan.id, scanId), eq(scan.profileId, profileId)))
    .limit(1);

  return c.json({
    scan: {
      id: row.id,
      capturedAt: row.capturedAt,
      tier: row.tier,
      status: row.status,
      consentRequired: row.consentAt === null,
      overallScore: scanRow[0]?.overallScore ?? null,
      skinAge: scanRow[0]?.skinAge ?? null,
    },
    error: row.errorCode ? presentError(row.errorCode) : null,
    quality: quality[0] ?? null,
    photoUrl,
    // Every reading, regions included. The client decides what to surface; the
    // API does not hide the three pore regions the design once dropped.
    readings: readings.map((r) => ({
      metric: r.metric,
      region: r.region,
      rawScore: r.rawScore,
      categoryValue: r.categoryValue,
    })),
    masks: maskUrls,
    signedUrlTtlSeconds: ttl,
  });
});

// ------------------------------------------------------------------- delete

scansRoute.delete('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const scanId = c.req.param('id');
  const row = await loadScan(profileId, scanId);

  // Rows cascade. The stored objects do not, so they go first.
  const masks = await scanMasksFor(scanId);
  const store = storage();
  await Promise.all([
    ...(row.imageKey ? [store.remove(row.imageKey)] : []),
    ...masks.map((m) => store.remove(m.storageKey)),
  ]);
  await db().delete(scan).where(and(eq(scan.id, scanId), eq(scan.profileId, profileId)));

  return c.json({
    deleted: true,
    /**
     * Said plainly because the prototype did not. Deleting here does not reach
     * into the provider, which holds uploads for 30 days on its own schedule.
     */
    note:
      'The photo and its readings are gone from Glowdays. The analysis provider ' +
      'removes its own copy within 30 days of upload, on its own schedule.',
  });
});
