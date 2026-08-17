/**
 * Development-only routes.
 *
 * Every handler here checks the mode itself rather than relying on the mount
 * being conditional. A route that is only safe because of where it was mounted
 * is one refactor away from being reachable in production.
 *
 * Config already refuses AUTH_MODE=dev in production, so the token endpoint has
 * two independent locks.
 */

import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { mintDevToken } from '../auth/verify.js';
import { db } from '../db/client.js';
import { scan } from '../db/schema.js';
import { config, describeConfig } from '../env.js';
import { currentProfileId, requireAuth, type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';
import { blobsFor, maskPng } from '../dev/png.js';

export const devRoute = new Hono<AppEnv>();

/**
 * Three independent locks, because the previous single one failed open.
 *
 * These endpoints were reachable with no credentials whatsoever, guarded only by
 * `NODE_ENV !== 'production'`. NODE_ENV defaults to `development`, so a task
 * definition that omitted it exposed an endpoint that mints a valid session for
 * any account. A control that depends on a variable being present, and defaults
 * to permissive when it is absent, is not a control.
 *
 * Now: an explicit opt-in that defaults to false, plus the NODE_ENV check, plus
 * config refusing the flag in production outright. Any one of the three is
 * enough to keep this closed.
 */
function assertDev(): void {
  const c = config();
  if (!c.ENABLE_DEV_ROUTES || c.NODE_ENV === 'production') {
    throw new AppError('not_found', 'Not available');
  }
}

/**
 * Mint a local session. This is also how test credentials reach a judge without
 * standing up email delivery first - a real risk, since SES starts sandboxed
 * and an unverified sender means a reviewer cannot complete sign-up at all.
 */
devRoute.post('/token', async (c) => {
  assertDev();
  if (config().AUTH_MODE !== 'dev') {
    throw new AppError('not_found', 'Not available');
  }

  const input = z
    .object({
      authUid: z.string().trim().min(1).max(64).default('local-user'),
      email: z.string().email().default('local@example.test'),
      name: z.string().trim().max(80).optional(),
    })
    .parse(await c.req.json().catch(() => ({})));

  const token = await mintDevToken({
    authUid: input.authUid,
    email: input.email,
    ...(input.name ? { name: input.name } : {}),
  });
  return c.json({ token, tokenType: 'Bearer' });
});

/** Redacted config, to answer "why is it in fixture mode" without guessing. */
devRoute.get('/config', (c) => {
  assertDev();
  return c.json(describeConfig());
});

/**
 * Move a check-in's capture time backwards.
 *
 * The real API refuses to backdate a photograph, and should: a measurement
 * cannot be claimed for a day it was not taken, and letting a client choose the
 * date would let it choose which trial window claims the scan. But the
 * confidence engine only produces a comparison for check-ins 3 to 180 days
 * apart, so without this there is no way to see a real comparison on the day you
 * install the app - every pair would come back as "too close together".
 *
 * So it lives here, behind the same production guard as the rest of this file,
 * rather than as a flag on the real endpoint where it could be reached by
 * accident. It also keeps the database owned by one process: the alternative was
 * a script opening the same embedded data directory the server already holds.
 */
devRoute.post('/backdate', requireAuth, async (c) => {
  assertDev();
  const profileId = currentProfileId(c);

  const input = z
    .object({
      scanId: z.string().uuid(),
      days: z.number().int().min(1).max(365),
    })
    .parse(await c.req.json().catch(() => ({})));

  const updated = await db()
    .update(scan)
    .set({ capturedAt: sql`${scan.capturedAt} - ${`${input.days} days`}::interval` })
    // Scoped to the caller's own scans. Every other write in the API is; this
    // one was not, and took a bare UUID from anyone who asked.
    .where(and(eq(scan.id, input.scanId), eq(scan.profileId, profileId)))
    .returning({ id: scan.id, capturedAt: scan.capturedAt });

  const row = updated[0];
  if (!row) throw new AppError('not_found', 'No such check-in');
  return c.json({ scanId: row.id, capturedAt: row.capturedAt, movedBackDays: input.days });
});

/**
 * Stand-in mask images for fixture mode.
 *
 * These exist so the mask pipeline runs end to end locally: the fixture hands
 * back a URL, the analysis service copies the bytes into our storage inside the
 * two-hour window it would have in production, and the client reads them
 * through a signed URL. A pipeline that only ever runs against the live API is
 * a pipeline nobody has tested.
 */
const MASK_COLOURS: Record<string, readonly [number, number, number]> = {
  hd_acne: [201, 74, 84],
  hd_redness: [190, 78, 88],
  hd_pore: [122, 106, 148],
  hd_wrinkle: [140, 118, 92],
  hd_texture: [116, 122, 140],
  hd_oiliness: [188, 158, 88],
  hd_age_spot: [150, 112, 78],
  hd_moisture: [92, 132, 152],
  hd_radiance: [176, 152, 96],
};

devRoute.get('/fixture-mask', (c) => {
  assertDev();
  if (config().YOUCAM_MODE !== 'fixture') {
    throw new AppError('not_found', 'Not available');
  }

  const action = (c.req.query('action') ?? 'hd_texture').slice(0, 40);
  const region = (c.req.query('region') ?? 'whole').slice(0, 24);
  if (!/^[a-z0-9_]+$/.test(action) || !/^[a-z0-9_]+$/.test(region)) {
    throw new AppError('invalid_request', 'Bad mask request');
  }

  const width = 720;
  const height = 960;
  const png = maskPng({
    width,
    height,
    colour: MASK_COLOURS[action] ?? [124, 111, 107],
    blobs: blobsFor(action, region, width, height),
  });

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.byteLength),
      'Cache-Control': 'no-store',
    },
  });
});
