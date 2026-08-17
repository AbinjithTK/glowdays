/**
 * Scan lifecycle. The one place a check-in moves from a photo to a set of
 * numbers.
 *
 * Order of operations, and why:
 *
 *  1. Bytes land in our storage first, and the scan row is created before the
 *     provider is contacted. If the provider call fails the photo is still
 *     here, so "your check-in is safe, the analysis failed" is true rather than
 *     reassuring nonsense.
 *
 *  2. Consent is a row, checked here, not a checkbox trusted on the client.
 *     No consent timestamp means the analysis call is refused. This is a
 *     biometric-adjacent upload; the gate belongs on the server.
 *
 *  3. Local pre-flight checks run before any unit is spent. The provider
 *     documents a hard rule that the face must exceed 60% of image width, and
 *     rejecting that here costs nothing while letting the provider reject it
 *     costs a unit and returns a worse message.
 *
 *  4. Masks are copied into our storage the moment a task succeeds. The
 *     provider's URLs live two hours. Fetching them when someone opens the
 *     viewer works in a demo and fails a week later.
 *
 * Completion uses polling on read. Webhooks are the provider's documented
 * preference and the right answer for production; this is the fallback, chosen
 * because it needs no public callback URL and no queue.
 */

import { randomUUID } from 'node:crypto';

import { SUMMARY_REGION, type Tier } from '@glowdays/core';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { captureQuality, scan, scanMask, scanMetric } from '../db/schema.js';
import { AppError } from '../http/problem.js';
import {
  MAX_IMAGE_BYTES,
  readImageInfo,
  tierForShortSide,
  UnreadableImage,
} from '../media/dimensions.js';
import { scanImageKey, scanMaskKey } from '../storage/index.js';
import { storage } from '../storage/factory.js';
import { youcam } from '../youcam/client.js';
import { presentError, YouCamError } from '../youcam/errors.js';
import { parseAnalysis } from '../youcam/parse.js';

/** Bumped whenever the consent wording changes. Stored on every scan. */
export const CONSENT_POLICY_VERSION = '2026-08-08.1';

/**
 * The provider's own hard constraint. Guidance targets 60-80%; below 60% is a
 * documented rejection, so it is enforced before spending a unit.
 */
const MIN_FACE_RATIO = 0.6;

/**
 * Whether this capture's framing may be judged at all.
 *
 * Extracted and exported so the rule can be tested directly. It is one boolean,
 * but getting it wrong took the whole product down: enforcing the framing minimum
 * against an unmeasured value refused every check-in from any browser without a
 * face detector, which is most of them.
 */
export function enforcesFraming(metrics: {
  readonly source: 'camerakit' | 'declared';
  readonly measured?: readonly ('lighting' | 'framing' | 'pose')[];
}): boolean {
  // An explicit list wins, including when it is empty - that is the client
  // stating positively that it measured nothing.
  if (metrics.measured) return metrics.measured.includes('framing');
  // No list: fall back to the coarser signal. `camerakit` means every group was
  // measured, so framing was among them.
  return metrics.source === 'camerakit';
}

export interface CaptureMetrics {
  readonly lightingLevel: number;
  readonly lightingUneven: number;
  readonly faceRatio: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly preset: string;
  readonly source: 'camerakit' | 'declared';
  /**
   * Which signals the client genuinely measured, when it says.
   *
   * `source` alone is too coarse to gate on: it only reports `camerakit` when all
   * three groups were measured, so a browser that can measure framing but not
   * pose still reports `declared`, and gating on that would discard a real
   * measurement. Omitted by older clients, in which case `source` is the fallback.
   */
  readonly measured?: readonly ('lighting' | 'framing' | 'pose')[];
  readonly declaredLight?: string;
}

export interface CreateScanInput {
  readonly profileId: string;
  readonly capturedAt: Date;
  readonly bytes: Uint8Array;
  readonly metrics: CaptureMetrics;
}

export interface ScanSummary {
  readonly id: string;
  readonly status: string;
  readonly tier: Tier;
  readonly capturedAt: Date;
  readonly consentRequired: boolean;
}

// ------------------------------------------------------------------- create

export async function createScan(input: CreateScanInput): Promise<ScanSummary> {
  if (input.bytes.byteLength === 0) {
    throw new AppError('invalid_request', 'That upload was empty');
  }
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError('invalid_request', 'That photo is larger than 10 MB', {
      detail: 'Images are compressed before upload. This one arrived above the provider limit.',
    });
  }

  let info;
  try {
    info = readImageInfo(input.bytes);
  } catch (err) {
    if (err instanceof UnreadableImage) {
      throw new AppError('invalid_request', 'That file could not be read as an image', {
        detail: err.message,
      });
    }
    throw err;
  }

  const tier = tierForShortSide(info.shortSidePx);
  if (!tier) {
    throw new AppError('invalid_request', 'That photo is too small to analyse', {
      detail:
        'The short side needs at least 480 pixels, and 1080 for high detail. ' +
        'Your camera may be capturing at a lower resolution than its preview suggests.',
      extra: { shortSidePx: info.shortSidePx },
    });
  }

  /**
   * Pre-flight framing check - but only when framing was actually measured.
   *
   * This gate used to read `faceRatio <= MIN_FACE_RATIO` unconditionally, and
   * that made the app unusable on most phones. `faceRatio` can only be measured
   * where the browser exposes a face detector, which is a flagged Chromium
   * feature and absent from iOS Safari entirely. Everywhere else the client sends
   * 0 as a placeholder and marks the capture `declared` - and 0 is below the
   * threshold, so every single check-in was refused with "Move a little closer".
   *
   * That message is worse than a generic failure. It is confidently wrong: it
   * names a cause that was never observed, and asks for a correction that cannot
   * change the number, because the number is not coming from the camera. Someone
   * following the instruction gets the same refusal from two inches away.
   *
   * The rule is the one the confidence engine already follows: an unmeasured
   * signal is not evidence. Where framing is measured, the provider's documented
   * 60% minimum is enforced here and a unit is saved. Where it is not, the scan is
   * admitted, the comparison it feeds is already capped at a directional check,
   * and if the face really is too small the provider says so itself - that
   * response is mapped to this same wording with `retake: true`, so the user
   * still gets the right guidance, just from something that actually looked.
   */
  if (enforcesFraming(input.metrics) && input.metrics.faceRatio <= MIN_FACE_RATIO) {
    const presented = presentError('error_src_face_too_small');
    throw new AppError('invalid_request', presented.title, {
      detail: presented.detail,
      extra: { retake: true, faceRatio: input.metrics.faceRatio },
    });
  }

  const scanId = randomUUID();
  const key = scanImageKey(input.profileId, scanId, info.extension);

  // Storage before database. A stored object with no row is a harmless orphan
  // the deletion sweep will collect; a row pointing at nothing is a broken
  // check-in the user can see.
  await storage().put(key, input.bytes, info.contentType);

  const database = db();
  await database.transaction(async (tx) => {
    await tx.insert(scan).values({
      id: scanId,
      profileId: input.profileId,
      capturedAt: input.capturedAt,
      tier,
      status: 'draft',
      imageKey: key,
    });
    await tx.insert(captureQuality).values({
      scanId,
      source: input.metrics.source,
      lightingLevel: input.metrics.lightingLevel,
      lightingUneven: input.metrics.lightingUneven,
      faceRatio: input.metrics.faceRatio,
      yaw: input.metrics.yaw,
      pitch: input.metrics.pitch,
      roll: input.metrics.roll,
      preset: input.metrics.preset,
      shortSidePx: info.shortSidePx,
      declaredLight: input.metrics.declaredLight ?? null,
    });
  });

  return {
    id: scanId,
    status: 'draft',
    tier,
    capturedAt: input.capturedAt,
    consentRequired: true,
  };
}

// ------------------------------------------------------------------ consent

export async function recordConsent(profileId: string, scanId: string): Promise<void> {
  const database = db();
  const updated = await database
    .update(scan)
    .set({ consentAt: new Date(), consentPolicyVersion: CONSENT_POLICY_VERSION })
    .where(and(eq(scan.id, scanId), eq(scan.profileId, profileId)))
    .returning({ id: scan.id });
  if (!updated[0]) throw new AppError('not_found', 'No such check-in');
}

// ------------------------------------------------------------------ analyse

export async function startAnalysis(profileId: string, scanId: string): Promise<ScanSummary> {
  const database = db();
  const row = await loadScan(profileId, scanId);

  if (!row.consentAt) {
    throw new AppError('consent_required', 'Analysis needs your consent first', {
      detail:
        'Your photo stays here until you agree to it being sent for analysis. ' +
        'The provider keeps uploads for 30 days.',
    });
  }
  if (row.status === 'queued' || row.status === 'running') {
    return toSummary(row);
  }
  if (row.status === 'succeeded') {
    return toSummary(row);
  }
  if (!row.imageKey) {
    throw new AppError('conflict', 'This check-in has no photo');
  }

  const object = await storage().get(row.imageKey);
  const client = youcam();

  try {
    await database.update(scan).set({ status: 'uploading', errorCode: null }).where(eq(scan.id, scanId));

    const { fileId } = await client.uploadImage({
      bytes: object.bytes,
      contentType: object.contentType,
      fileName: `scan.${object.contentType === 'image/png' ? 'png' : 'jpg'}`,
    });

    const quality = await loadQuality(scanId);
    const { taskId } = await client.createSkinAnalysisTask({
      fileId,
      tier: row.tier,
      fromCameraKit: quality?.source === 'camerakit',
    });

    await database
      .update(scan)
      .set({ status: 'running', youcamFileId: fileId, youcamTaskId: taskId })
      .where(eq(scan.id, scanId));

    return { ...toSummary(row), status: 'running' };
  } catch (err) {
    const code = err instanceof YouCamError ? err.code : 'unknown_internal_error';
    await database.update(scan).set({ status: 'failed', errorCode: code }).where(eq(scan.id, scanId));
    const presented = presentError(code);
    throw new AppError('analysis_failed', presented.title, {
      detail: presented.detail,
      extra: { retake: presented.retake, ours: presented.ours, providerCode: code },
    });
  }
}

/**
 * Advance a running task. Called on read rather than on a timer, so a client
 * that closes the app and returns later still gets its result.
 */
export async function refreshAnalysis(profileId: string, scanId: string): Promise<ScanSummary> {
  const row = await loadScan(profileId, scanId);
  if (row.status !== 'running' && row.status !== 'queued') return toSummary(row);
  if (!row.youcamTaskId) return toSummary(row);

  const database = db();
  const result = await youcam().getTask(row.youcamTaskId);

  if (result.status === 'running') return toSummary(row);

  if (result.status === 'error') {
    await database
      .update(scan)
      .set({ status: 'failed', errorCode: result.code })
      .where(eq(scan.id, scanId));
    return { ...toSummary(row), status: 'failed' };
  }

  await persistResults({
    profileId,
    scanId,
    tier: row.tier,
    payload: result.payload,
  });

  return { ...toSummary(row), status: 'succeeded' };
}

// ------------------------------------------------------------------ persist

async function persistResults(input: {
  profileId: string;
  scanId: string;
  tier: Tier;
  payload: unknown;
}): Promise<void> {
  const parsed = parseAnalysis(input.payload, input.tier);

  if (parsed.unmapped.length > 0) {
    // Loud, because it means the provider returned a shape we do not read and
    // scores are being dropped. Not fatal: what we did resolve is still saved.
    console.warn(
      `[youcam] ${parsed.unmapped.length} scored node(s) unmapped for scan ${input.scanId}:`,
      parsed.unmapped.slice(0, 20).join(', '),
    );
  }
  if (parsed.metrics.length === 0) {
    throw new AppError('analysis_failed', 'The analysis returned no readings', {
      detail: 'Your photo is saved. Try running it again.',
      extra: { ours: true },
    });
  }

  const database = db();
  await database.transaction(async (tx) => {
    // Re-running an analysis replaces its readings rather than accumulating.
    await tx.delete(scanMetric).where(eq(scanMetric.scanId, input.scanId));
    await tx.insert(scanMetric).values(
      parsed.metrics.map((m) => ({
        scanId: input.scanId,
        metric: m.metric,
        region: m.region,
        rawScore: m.rawScore,
        uiScore: m.uiScore,
        categoryValue: m.categoryValue,
      })),
    );
    await tx
      .update(scan)
      .set({
        status: 'succeeded',
        errorCode: null,
        overallScore: parsed.overallScore,
        skinAge: parsed.skinAge,
      })
      .where(eq(scan.id, input.scanId));
  });

  // Masks last and outside the transaction. A failed copy must not lose the
  // scores, and the scan is already usable without a mask overlay.
  await copyMasks({
    profileId: input.profileId,
    scanId: input.scanId,
    masks: parsed.metrics
      .filter((m): m is typeof m & { maskUrl: string } => typeof m.maskUrl === 'string')
      .map((m) => ({ metric: m.metric, region: m.region, url: m.maskUrl })),
  });
}

async function copyMasks(input: {
  profileId: string;
  scanId: string;
  masks: readonly { metric: string; region: string; url: string }[];
}): Promise<void> {
  if (input.masks.length === 0) return;
  const store = storage();
  const database = db();

  // Small concurrency. The provider rate limit is shared with analysis calls.
  const queue = [...input.masks];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      try {
        const res = await fetch(next.url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0) continue;
        const key = scanMaskKey(input.profileId, input.scanId, next.metric, next.region);
        await store.put(key, bytes, 'image/png');
        await database
          .insert(scanMask)
          .values({
            scanId: input.scanId,
            metric: next.metric,
            region: next.region,
            storageKey: key,
          })
          .onConflictDoUpdate({
            target: [scanMask.scanId, scanMask.metric, scanMask.region],
            set: { storageKey: key, copiedAt: new Date() },
          });
      } catch (err) {
        // A missing overlay degrades one view. It is not worth failing a scan.
        console.warn(
          `[youcam] mask copy failed for ${next.metric}/${next.region}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  });
  await Promise.all(workers);
}

// -------------------------------------------------------------------- reads

type ScanRow = {
  id: string;
  profileId: string;
  capturedAt: Date;
  tier: Tier;
  status: string;
  imageKey: string | null;
  youcamFileId: string | null;
  youcamTaskId: string | null;
  consentAt: Date | null;
  errorCode: string | null;
};

export async function loadScan(profileId: string, scanId: string): Promise<ScanRow> {
  const rows = await db()
    .select()
    .from(scan)
    .where(and(eq(scan.id, scanId), eq(scan.profileId, profileId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', 'No such check-in');
  return row as ScanRow;
}

async function loadQuality(scanId: string) {
  const rows = await db()
    .select()
    .from(captureQuality)
    .where(eq(captureQuality.scanId, scanId))
    .limit(1);
  return rows[0] ?? null;
}

function toSummary(row: ScanRow): ScanSummary {
  return {
    id: row.id,
    status: row.status,
    tier: row.tier,
    capturedAt: row.capturedAt,
    consentRequired: row.consentAt === null,
  };
}

/** The eight surfaced rows for a scan, plus everything stored behind them. */
export async function scanReadings(scanId: string) {
  const rows = await db().select().from(scanMetric).where(eq(scanMetric.scanId, scanId));
  return rows;
}

export async function scanMasksFor(scanId: string) {
  return db().select().from(scanMask).where(eq(scanMask.scanId, scanId));
}

export { SUMMARY_REGION };
