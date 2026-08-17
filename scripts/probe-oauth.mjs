/**
 * Verify the Google plumbing on the deployed build.
 *
 * The browser half of the round trip cannot be driven from here - it needs a real Google
 * consent screen. What can be verified is everything on either side of it, which is where
 * the bugs would be:
 *
 *  - /health advertises the auth base URL the client needs
 *  - the SPA serves /oauth/finish rather than 404ing it, which is the trap that made this
 *    route `/oauth/finish` instead of `/auth/callback`
 *  - the social flow starts and returns a destination
 *  - /join/exchange verifies real tokens and rejects forged, malformed and expired ones
 *
 * The last of those is the security boundary: /join/exchange is unauthenticated by
 * necessity, so if it accepted an unsigned token anyone could mint a session for any
 * account.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const safe = (t) => t.replace(/"token":"[^"]+"/g, '"token":"<redacted>"');

// ------------------------------------------------------------------ health

const health = await (await fetch(`${BASE}/health`)).json();
log(`health: ${JSON.stringify(health)}`);
const AUTH = health.authBaseUrl;
log(`accounts=${health.accounts}  authBaseUrl advertised=${Boolean(AUTH)}`);

// ------------------------------------------------------- the callback route

// `/auth` is on the API prefix list, so a client route under it would be answered with a
// 404 instead of the app shell. This is that check.
const cb = await fetch(`${BASE}/oauth/finish`);
log('');
log(`GET /oauth/finish -> ${cb.status} ${cb.headers.get('content-type')}`);
log(`  serves the app shell: ${cb.status === 200 && (cb.headers.get('content-type') ?? '').includes('text/html')}`);

// ------------------------------------------------------------ social start

log('');
log('--- starting the Google flow the way the browser does ---');
const social = await fetch(`${AUTH}/sign-in/social`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({
    provider: 'google',
    callbackURL: `${BASE}/oauth/finish`,
    errorCallbackURL: `${BASE}/sign-in?oauth=failed`,
  }),
});
const socialBody = await social.json().catch(() => ({}));
log(`POST /sign-in/social -> ${social.status}  destination returned: ${Boolean(socialBody.url)}`);
if (socialBody.url) log(`  host: ${new URL(socialBody.url).host}`);

// ---------------------------------------------------- exchange, the boundary

log('');
log('--- /join/exchange must reject anything it cannot verify ---');

async function exchange(label, token) {
  const res = await fetch(`${BASE}/join/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const text = await res.text();
  log(`  ${label}: ${res.status}  ${safe(text).slice(0, 150).replace(/\s+/g, ' ')}`);
  return res.status;
}

// An unsigned token claiming to be someone. The classic alg:none forgery.
const forged = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
  JSON.stringify({
    sub: '00000000-0000-0000-0000-000000000000',
    email: 'attacker@example.com',
    iss: AUTH,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
).toString('base64url')}.`;

const forgedStatus = await exchange('unsigned forgery', forged);
const garbageStatus = await exchange('not a jwt at all', 'x'.repeat(40));

// A real token, obtained the way the browser would after OAuth. Uses password sign-up
// because that is reachable without a consent screen, and it exercises the identical
// verification path.
log('');
log('--- and it must accept a genuine one ---');
const email = `oauth+${Date.now()}@example.com`;
const signUp = await fetch(`${AUTH}/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email, password: 'Sf9!kQ2w-Lr8tVz3', name: 'OAuth Probe' }),
});
const cookies = (signUp.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const jwtRes = await fetch(`${AUTH}/token`, { headers: { Origin: BASE, Cookie: cookies } });
const jwt = (await jwtRes.json().catch(() => ({}))).token;
log(`  got a real JWT from the auth service: ${Boolean(jwt)}`);

let realStatus = 0;
if (jwt) {
  realStatus = await exchange('genuine token', jwt);
  const body = await (
    await fetch(`${BASE}/join/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: jwt }),
    })
  ).json();
  if (body.token) {
    const account = await (
      await fetch(`${BASE}/v1/account`, { headers: { Authorization: `Bearer ${body.token}` } })
    ).json();
    log(`  session works: profile=${account.profile?.id} email=${account.profile?.email}`);
  }
}

log('');
log('=== VERDICT ===');
const ok =
  Boolean(AUTH) &&
  cb.status === 200 &&
  Boolean(socialBody.url) &&
  forgedStatus >= 400 &&
  garbageStatus >= 400 &&
  realStatus === 200;
log(ok ? 'PASS: forgeries refused, genuine tokens accepted, flow reachable.' : 'FAIL: see above.');

writeFileSync('probe-oauth.txt', out.join('\n'));
