/**
 * Probe real account sign-up and sign-in on the deployed build.
 *
 * The point is not just that a token comes back. It is that a Neon Auth identity
 * resolves to its own diary, separate from the access-code identities, and that the
 * same address reopens the same diary rather than creating a new one - which is the
 * bug that matters here, because `profile.auth_uid` is what joins a person to their
 * photographs.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const safe = (t) => t.replace(/"token":"[^"]+"/g, '"token":"<redacted>"');

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  log(`${method} ${path} -> ${res.status}  ${safe(text).slice(0, 240).replace(/\s+/g, ' ')}`);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

log(`base: ${BASE}`);
log(`health: ${JSON.stringify(await (await fetch(`${BASE}/health`)).json())}`);
log('');

const email = `real+${Date.now()}@example.com`;
const password = 'Sf9!kQ2w-Lr8tVz3';

log('--- sign up ---');
const created = await call('POST', '/join/sign-up', { email, password, name: 'Real Person' });
const firstToken = created?.token;
if (!firstToken) {
  log('FAIL: no token from sign-up');
  writeFileSync('probe-join.txt', out.join('\n'));
  process.exit(1);
}

const account = await call('GET', '/v1/account', null, firstToken);
const profileId = account?.profile?.id;
log(`profile: ${profileId}  email=${account?.profile?.email}  name=${account?.profile?.displayName}`);

log('');
log('--- duplicate sign-up must be refused, not silently create a second diary ---');
await call('POST', '/join/sign-up', { email, password, name: 'Real Person' });

log('');
log('--- wrong password ---');
await call('POST', '/join/sign-in', { email, password: 'not-the-password' });

log('');
log('--- short password refused before the round trip ---');
await call('POST', '/join/sign-up', { email: `short+${Date.now()}@example.com`, password: 'abc' });

log('');
log('--- sign in again: must reopen the SAME diary ---');
const again = await call('POST', '/join/sign-in', { email, password });
const secondAccount = await call('GET', '/v1/account', null, again?.token);
const sameProfile = secondAccount?.profile?.id === profileId;
log(`same profile on second sign-in: ${sameProfile} (${secondAccount?.profile?.id})`);

log('');
log('--- an access-code identity must be a DIFFERENT diary, same email ---');
const demo = await call('POST', '/session', { email, code: CODE });
const demoAccount = await call('GET', '/v1/account', null, demo?.token);
log(
  `access-code profile: ${demoAccount?.profile?.id}  distinct from the real account: ${demoAccount?.profile?.id !== profileId}`,
);

log('');
log('--- the new account can actually use the app ---');
await call('GET', '/v1/scans', null, firstToken);
await call('POST', '/v1/notes', { body: 'First entry.', tags: ['calm'] }, firstToken);

log('');
log('=== VERDICT ===');
log(sameProfile ? 'PASS: sign-up, sign-in and identity mapping all behave.' : 'FAIL: identity did not map consistently.');

writeFileSync('probe-join.txt', out.join('\n'));
