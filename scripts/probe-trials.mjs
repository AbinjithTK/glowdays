/**
 * Probe the shelf and trial endpoints the new screens are built on.
 *
 * Those screens went in without ever exercising their endpoints against the
 * deployed build, which is how a screen ships looking correct and failing on
 * first tap. Checks the create paths and, importantly, that the one-active-trial
 * constraint answers with a usable conflict rather than a 500.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const token = (
  await (
    await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `trials+${Date.now()}@example.com`, code: CODE }),
    })
  ).json()
).token;

const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  log(`${method} ${path} -> ${res.status}  ${text.slice(0, 260).replace(/\s+/g, ' ')}`);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Invented brand names only. Third-party trademarks appear across the design
// canvas and must not travel into a demo dataset.
const product = await call('POST', '/v1/products', {
  name: 'Quiet Morning Serum',
  brand: 'Fieldnote',
  kind: 'serum',
});
const productId = product?.product?.id;

await call('GET', '/v1/products');

if (productId) {
  const trial = await call('POST', '/v1/trials', {
    productId,
    predictedMetric: 'hydration',
    durationDays: 28,
  });
  const trialId = trial?.trial?.id;

  // The single-variable rule is a partial unique index in the database. It must
  // surface as a conflict a screen can explain, not an unhandled error.
  await call('POST', '/v1/trials', {
    productId,
    predictedMetric: 'radiance',
    durationDays: 28,
  });

  if (trialId) {
    await call('GET', `/v1/trials/${trialId}`);
    await call('PATCH', `/v1/trials/${trialId}`, { status: 'completed' });
  }
}

await call('POST', '/v1/notes', { body: 'Slept badly, skipped the serum.', tags: ['sleep'] });
await call('GET', '/v1/notes');

writeFileSync('probe-trials.txt', out.join('\n'));
