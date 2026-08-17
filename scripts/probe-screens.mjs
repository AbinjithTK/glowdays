/**
 * Probe every endpoint the app calls on load.
 *
 * The reported symptom is that signing in leaves you on the sign-in page but a
 * refresh gets you in. App.tsx drops to the sign-in routes when the /v1/account
 * query errors, so a failing account call would produce exactly that - and would
 * also explain why a reload appears to work, if the failure is intermittent. This
 * asks each endpoint directly rather than inferring it from the UI.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const email = `screens+${Date.now()}@example.com`;
const token = (
  await (
    await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: CODE }),
    })
  ).json()
).token;
log(`signed in as a brand new account: ${email}`);

const auth = { Authorization: `Bearer ${token}` };

async function get(path) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { headers: auth });
    const text = await res.text();
    log(`GET ${path} -> ${res.status} in ${Date.now() - started}ms  ${text.slice(0, 220).replace(/\s+/g, ' ')}`);
    return res.status;
  } catch (err) {
    log(`GET ${path} -> THREW ${err?.message}`);
    return 0;
  }
}

// First contact. This is the call that creates the profile row, and the one the
// route guard depends on.
log('--- first load, cold profile ---');
await get('/v1/account');

log('--- the rest of what a signed-in app asks for ---');
for (const p of [
  '/v1/scans',
  '/v1/comparison/latest',
  '/v1/trials',
  '/v1/products',
  '/v1/notes',
]) {
  // eslint-disable-next-line no-await-in-loop
  await get(p);
}

// The race a fresh sign-in can create: the guard's query and an invalidation
// refetch both arriving before the profile row exists.
log('--- two concurrent first-contact account calls on another new account ---');
const email2 = `screens+race${Date.now()}@example.com`;
const token2 = (
  await (
    await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email2, code: CODE }),
    })
  ).json()
).token;
const both = await Promise.all(
  [1, 2].map(async (n) => {
    const res = await fetch(`${BASE}/v1/account`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    return `call ${n} -> ${res.status} ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`;
  }),
);
both.forEach((l) => log(l));

writeFileSync('probe-screens.txt', out.join('\n'));
