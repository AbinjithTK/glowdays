/**
 * End-to-end smoke test, over HTTP, against a running server.
 *
 * This is the thing that proves the pipeline rather than its parts. The unit
 * tests cover the parser, the confidence bands and the image headers in
 * isolation; none of them prove that a photograph goes in one end and a labelled
 * comparison comes out the other.
 *
 * It asserts rather than prints. A smoke script that only logs is a script
 * nobody notices has broken.
 *
 * One deliberate cheat, and it is confined to this file: after the first scan is
 * analysed, its `captured_at` is moved back three weeks by writing straight to
 * the database. The API refuses to backdate a photograph - a measurement cannot
 * be claimed for a day it was not taken, and allowing it would let a client
 * choose which trial window claims a scan. But without two scans separated in
 * time there is nothing for the confidence engine to grade, so the demo would
 * only ever show the "too close together" refusal.
 *
 * Run the server first, then: pnpm --filter @glowdays/api smoke
 */

import assert from 'node:assert/strict';

import { estimateUnits, metricsForSet } from '@glowdays/core';

import { maskPng } from '../dev/png.js';
import { config } from '../env.js';

const BASE = `http://localhost:${config().PORT}`;

let token = '';
const pass: string[] = [];

function ok(label: string): void {
  pass.push(label);
  console.log(`  ok  ${label}`);
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.form
      ? { body: init.form }
      : init.body !== undefined
        ? { body: JSON.stringify(init.body) }
        : {}),
  });

  const text = await res.text();
  const payload: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return payload as T;
}

/**
 * A portrait image comfortably over the 1080px short side that high detail
 * needs, so the tier is decided as `hd` from the bytes.
 */
function photo(): Blob {
  const bytes = maskPng({
    width: 1080,
    height: 1440,
    colour: [120, 100, 96],
    blobs: [{ cx: 540, cy: 700, radius: 420 }],
  });
  return new Blob([bytes], { type: 'image/png' });
}

async function createAnalysedScan(label: string): Promise<string> {
  const form = new FormData();
  form.set('image', photo(), 'check-in.png');
  form.set(
    'meta',
    JSON.stringify({
      source: 'camerakit',
      preset: 'MODERATE',
      // Inside every band, so capture quality is not what limits confidence.
      lightingLevel: 0.78,
      lightingUneven: 0.04,
      faceRatio: 0.72,
      yaw: 1.0,
      pitch: -0.5,
      roll: 0.4,
    }),
  );

  const created = await call<{
    scan: { id: string; tier: string; status: string; consentRequired: boolean };
    consent: { providerRetentionDays: number };
  }>('/v1/scans', { method: 'POST', form });

  assert.equal(created.scan.tier, 'hd', `${label}: a 1080px short side must be high detail`);
  assert.equal(created.scan.consentRequired, true, `${label}: consent must be required`);
  // The corrected retention figure. The prototype said 24 hours on five screens.
  assert.equal(created.consent.providerRetentionDays, 30);

  const id = created.scan.id;

  // Analysis before consent must be refused by the server, not just hidden in
  // the client. This is the gate that matters most on a biometric upload.
  await assert.rejects(
    () => call(`/v1/scans/${id}/analyse`, { method: 'POST' }),
    /428/,
    `${label}: analysis without consent must be refused`,
  );

  await call(`/v1/scans/${id}/consent`, { method: 'POST', body: { agree: true } });
  await call(`/v1/scans/${id}/analyse`, { method: 'POST' });

  // Completion is advanced by reading, so poll the detail endpoint.
  // The type argument is explicit. Left to inference, it would be widened by the
  // nullable assignment target and every read inside the loop would be nullable.
  interface Detail {
    scan: { status: string; overallScore: number | null; skinAge: number | null };
    readings: { metric: string; region: string; rawScore: number | null }[];
    masks: { metric: string; region: string; url: string }[];
    photoUrl: string | null;
  }

  let detail: Detail | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const next = await call<Detail>(`/v1/scans/${id}`);
    detail = next;
    if (next.scan.status === 'succeeded' || next.scan.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Narrowing onto a fresh const rather than the loop variable, which TypeScript
  // will not treat as settled after reassignment.
  const finished = detail;
  assert.ok(finished, `${label}: no detail returned`);
  assert.equal(finished.scan.status, 'succeeded', `${label}: analysis did not succeed`);

  // All four pore regions, not one. This is the mistake the design shipped.
  const pore = finished.readings.filter((r) => r.metric === 'pore');
  assert.equal(pore.length, 4, `${label}: expected 4 pore regions, got ${pore.length}`);
  const wrinkles = finished.readings.filter((r) => r.metric === 'wrinkles');
  assert.equal(wrinkles.length, 7, `${label}: expected 7 wrinkle regions`);

  // Breadth must match the configured concern set, not a hard-coded number.
  // Billing is banded by concern count, so this setting is what decides whether
  // the free allocation buys 45 scans or 62, and a test that asserted 16
  // regardless would have hidden the setting having no effect.
  const expectedMetrics = metricsForSet(config().YOUCAM_CONCERN_SET).length;
  const distinct = new Set(finished.readings.map((r) => r.metric));
  assert.equal(
    distinct.size,
    expectedMetrics,
    `${label}: expected ${expectedMetrics} metrics for the '${config().YOUCAM_CONCERN_SET}' set, got ${distinct.size}`,
  );

  assert.equal(typeof finished.scan.overallScore, 'number', `${label}: no provider overall score`);
  assert.ok(finished.photoUrl, `${label}: no signed photo url`);
  assert.ok(finished.masks.length > 0, `${label}: no masks copied into our storage`);

  // Masks must be readable through our own signed link, not the provider's.
  // The local driver returns a path so the client can resolve it against
  // whichever address it reached the API on, so join it here.
  const first = finished.masks[0];
  assert.ok(first);
  const maskRes = await fetch(first.url.startsWith('/') ? `${BASE}${first.url}` : first.url);
  assert.equal(maskRes.status, 200, `${label}: mask link did not resolve`);
  const maskBytes = new Uint8Array(await maskRes.arrayBuffer());
  assert.deepEqual(
    [...maskBytes.slice(0, 4)],
    [0x89, 0x50, 0x4e, 0x47],
    `${label}: mask is not a PNG`,
  );

  ok(
    `${label}: captured, consented, analysed, ${expectedMetrics} metrics and ` +
      `${finished.masks.length} masks stored ` +
      `(~${estimateUnits('hd', config().YOUCAM_CONCERN_SET)} units per scan when live)`,
  );
  return id;
}

/**
 * Wait for the server rather than failing on the first refused connection.
 * Building before this runs touches dist, which restarts the file watcher, so a
 * single attempt races the restart and reports a transport error for what is
 * really a half-second gap.
 */
async function waitForServer(timeoutMs = 20_000): Promise<{ ok: boolean; youcam: string }> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    try {
      return await call<{ ok: boolean; youcam: string }>('/health');
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      if (Date.now() > deadline) {
        throw new Error(`server not reachable at ${BASE} after ${timeoutMs}ms: ${last}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nGlowdays smoke test against ${BASE}\n`);

  const health = await waitForServer();
  assert.equal(health.ok, true);
  ok(`server healthy, YouCam in ${health.youcam} mode`);

  // A fresh identity per run. Reusing one meant the second run tripped over its
  // own active trial from the first: the one-trial-per-person rule is enforced
  // in the database, so leftover state made a correct constraint look like a
  // broken test. The account is deleted at the end.
  const runId = Date.now().toString(36);
  const email = `smoke-${runId}@example.test`;

  const minted = await call<{ token: string }>('/dev/token', {
    method: 'POST',
    body: { authUid: `smoke:${runId}`, email },
  });
  token = minted.token;
  ok('dev token minted and accepted');

  const account = await call<{
    profile: { email: string };
    privacy: { providerRetentionDays: number };
  }>('/v1/account');
  assert.equal(account.profile.email, email);
  assert.equal(account.privacy.providerRetentionDays, 30);
  ok('profile created on first authenticated request');

  // ---- first check-in, then moved back three weeks. See the note at the top.
  const baselineId = await createAnalysedScan('baseline');

  await call('/dev/backdate', { method: 'POST', body: { scanId: baselineId, days: 21 } });
  ok('baseline backdated 21 days via the dev-only route (the real API refuses backdating)');

  const latestId = await createAnalysedScan('follow-up');

  // ---- the comparison, which is the whole product
  const comparison = await call<{
    outcome: string;
    label?: string;
    daysApart?: number;
    provisional?: boolean;
    movements?: { metric: string; delta: number | null }[];
    overall?: { baseline: number | null; latest: number | null; delta: number | null };
  }>('/v1/comparison/latest');

  assert.equal(comparison.outcome, 'comparison', 'expected a labelled comparison');
  assert.equal(comparison.daysApart, 21);
  assert.equal(comparison.provisional, true, 'confidence must be declared provisional');
  assert.ok(comparison.label, 'no confidence label');
  assert.equal(comparison.movements?.length, 8, 'expected the 8 surfaced metrics');
  ok(`comparison returned "${comparison.label}" over ${comparison.daysApart} days`);

  // The provider computes the overall figure independently, so it must not
  // equal the mean of the eight visible rows. Asserting this stops a future
  // refactor from "helpfully" recomputing it - the exact bug that put a headline
  // delta 1.8x its own metrics on screen in the prototype.
  const movements = comparison.movements ?? [];
  const meanDelta =
    movements.reduce((sum, m) => sum + (m.delta ?? 0), 0) / Math.max(movements.length, 1);
  assert.notEqual(
    Math.round((comparison.overall?.delta ?? 0) * 10),
    Math.round(meanDelta * 10),
    'the overall delta must be the provider figure, not the mean of the rows',
  );
  ok('overall figure is the provider value, not a recomputed mean');

  // ---- a comparison the engine must refuse
  const explicit = await call<{ outcome: string }>(
    `/v1/comparison?baseline=${baselineId}&latest=${baselineId}`,
  );
  assert.equal(explicit.outcome, 'insufficient', 'a scan compared with itself must be refused');
  ok('a scan compared with itself is refused, not answered with zeroes');

  // ---- trial kind is derived, not declared
  const product = await call<{ product: { id: string } }>('/v1/products', {
    method: 'POST',
    body: { name: 'Test Serum', brand: 'Invented Brand', kind: 'serum' },
  });

  const exploratory = await call<{
    trial: { kind: string };
    pooling: { poolable: boolean };
  }>('/v1/trials', {
    method: 'POST',
    body: {
      productId: product.product.id,
      predictedMetric: 'radiance',
      durationDays: 56,
      // Claiming a baseline that already has scores is what makes it
      // exploratory. The client never gets to assert the kind.
      baselineScanId: baselineId,
    },
  });
  assert.equal(exploratory.trial.kind, 'exploratory');
  assert.equal(exploratory.pooling.poolable, false);
  ok('a trial claiming an existing baseline is recorded exploratory and excluded from pooling');

  // ---- one active trial at a time, enforced in the database
  const second = await call<{ product: { id: string } }>('/v1/products', {
    method: 'POST',
    body: { name: 'Second Product', kind: 'moisturiser' },
  });
  await assert.rejects(
    () =>
      call('/v1/trials', {
        method: 'POST',
        body: {
          productId: second.product.id,
          predictedMetric: 'hydration',
          durationDays: 28,
        },
      }),
    /409/,
    'a second active trial must be refused',
  );
  ok('a second concurrent trial is refused by the database, not by client logic');

  // ---- deletion says what it can and cannot reach
  const removed = await call<{ deleted: boolean; note: string }>(`/v1/scans/${latestId}`, {
    method: 'DELETE',
  });
  assert.equal(removed.deleted, true);
  assert.match(removed.note, /30 days/, 'deletion must state the provider retention period');
  ok('deleting a check-in states plainly what the provider still holds');

  // ---- account deletion, which also cleans up after this run
  const closed = await call<{ deleted: boolean; objectsRemoved: number; note: string }>(
    '/v1/account',
    { method: 'DELETE' },
  );
  assert.equal(closed.deleted, true);
  assert.match(closed.note, /30 days/, 'account deletion must state provider retention');

  // The token is still valid at the identity provider, so the tombstone is what
  // stops it silently creating a fresh profile and making deletion look failed.
  await assert.rejects(
    () => call('/v1/account'),
    /403/,
    'a token for a deleted account must be refused, not given a new profile',
  );
  ok('account deleted, and its still-valid token cannot resurrect it');

  console.log(`\n${pass.length} checks passed\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
