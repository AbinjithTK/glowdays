/**
 * Seed a realistic diary for the account the web app signs into.
 *
 * Without this the app opens on the empty state and there is nothing to click:
 * the camera screen is not built yet, so "Capture baseline" is a dead end and
 * none of the screens that matter - the comparison, the confidence label, the
 * refusal - can be reached at all.
 *
 * Everything goes through the public API, so this seeds the same way a person
 * would. The one exception is the dev-only backdate route, because the real API
 * refuses to date a photograph in the past and the confidence engine needs the
 * two check-ins to be weeks apart before it will produce a comparison.
 *
 * Run the server first, then: pnpm --filter @glowdays/api seed
 */

import { maskPng } from '../dev/png.js';
import { config } from '../env.js';

const BASE = `http://localhost:${config().PORT}`;

/** Must match what the web sign-in screen sends, or this seeds a different diary. */
const EMAIL = 'abin@example.com';
const AUTH_UID = `dev:${EMAIL}`;

let token = '';

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
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * Distinct images per check-in, so the two scans do not produce identical
 * fixture scores. The fixture is seeded from the task id, which is derived from
 * the upload, and byte-identical uploads would give a comparison where every
 * metric moved exactly zero.
 */
function photo(seed: number): Blob {
  const bytes = maskPng({
    width: 1080,
    height: 1440,
    colour: [120, 100, 96],
    blobs: [
      { cx: 540, cy: 700, radius: 400 },
      { cx: 400 + seed * 17, cy: 600 + seed * 11, radius: 120 },
    ],
  });
  return new Blob([bytes], { type: 'image/png' });
}

interface Conditions {
  lightingLevel: number;
  lightingUneven: number;
  faceRatio: number;
  yaw: number;
  pitch: number;
  roll: number;
  declaredLight?: string;
}

async function checkIn(seed: number, conditions: Conditions): Promise<string> {
  const form = new FormData();
  form.set('image', photo(seed), 'check-in.png');
  form.set('meta', JSON.stringify({ source: 'camerakit', preset: 'MODERATE', ...conditions }));

  const created = await call<{ scan: { id: string } }>('/v1/scans', { method: 'POST', form });
  const id = created.scan.id;

  await call(`/v1/scans/${id}/consent`, { method: 'POST', body: { agree: true } });
  await call(`/v1/scans/${id}/analyse`, { method: 'POST' });

  for (let i = 0; i < 40; i += 1) {
    const detail = await call<{ scan: { status: string } }>(`/v1/scans/${id}`);
    if (detail.scan.status === 'succeeded') return id;
    if (detail.scan.status === 'failed') throw new Error(`check-in ${seed} failed to analyse`);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`check-in ${seed} did not finish in time`);
}

async function main(): Promise<void> {
  console.log(`\nSeeding ${EMAIL} at ${BASE}\n`);

  const minted = await call<{ token: string }>('/dev/token', {
    method: 'POST',
    body: { authUid: AUTH_UID, email: EMAIL, name: 'Abin' },
  });
  token = minted.token;

  const existing = await call<{ scans: { id: string }[] }>('/v1/scans');
  if (existing.scans.length > 0) {
    console.log(`Already has ${existing.scans.length} check-in(s). Nothing to do.`);
    console.log('Delete .pgdata and re-run the migration to start clean.\n');
    return;
  }

  // Baseline: good conditions, moved back three weeks.
  const baseline = await checkIn(1, {
    lightingLevel: 0.78,
    lightingUneven: 0.04,
    faceRatio: 0.72,
    yaw: 1.0,
    pitch: -0.5,
    roll: 0.4,
    declaredLight: 'daylight',
  });
  await call('/dev/backdate', { method: 'POST', body: { scanId: baseline, days: 21 } });
  console.log('  baseline captured and dated 21 days ago');

  // Follow-up: conditions close enough that the pair reads as comparable.
  await checkIn(2, {
    lightingLevel: 0.75,
    lightingUneven: 0.06,
    faceRatio: 0.7,
    yaw: 1.4,
    pitch: -1.0,
    roll: 0.9,
    declaredLight: 'daylight',
  });
  console.log('  follow-up captured today');

  // A pre-registered trial: no baseline is claimed, so the server records it as
  // poolable. Created after the scans only because the product needs an id.
  const product = await call<{ product: { id: string } }>('/v1/products', {
    method: 'POST',
    body: { name: 'Ceramide Repair Lotion', brand: 'Northwind Skin', kind: 'moisturiser' },
  });
  const trial = await call<{ trial: { id: string; kind: string } }>('/v1/trials', {
    method: 'POST',
    body: {
      productId: product.product.id,
      predictedMetric: 'hydration',
      durationDays: 56,
      cadenceDays: 14,
    },
  });
  console.log(`  trial started, recorded as ${trial.trial.kind}`);

  // Two more products on the shelf, one of them not in any trial.
  await call('/v1/products', {
    method: 'POST',
    body: { name: 'Gentle Foaming Cleanser', brand: 'Northwind Skin', kind: 'cleanser' },
  });
  await call('/v1/products', {
    method: 'POST',
    body: { name: 'Niacinamide 10% Serum', brand: 'Plainwell', kind: 'serum' },
  });

  await call('/v1/notes', {
    method: 'POST',
    body: {
      body: 'Less tightness after cleansing. Still dry along the jaw in the morning.',
      tags: ['Less tightness'],
    },
  });

  const comparison = await call<{ outcome: string; label?: string; daysApart?: number }>(
    '/v1/comparison/latest',
  );

  console.log(`\nSeeded. Comparison reads "${comparison.label}" over ${comparison.daysApart} days.`);
  console.log(`Open http://localhost:5173 and sign in as ${EMAIL}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('\nSeed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
