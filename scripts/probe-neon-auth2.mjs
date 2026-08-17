/**
 * Establish whether the trusted-origin list is the only thing standing in the way.
 *
 * The first probe showed Better Auth refuses a request with no Origin header at all.
 * `allow_localhost` is true on this branch and `trusted_origins` is empty, so if a
 * localhost Origin is accepted and our real origin is not, the mechanism works and
 * the single remaining blocker is one entry in a list - which needs the Neon console,
 * because configure_neon_auth returns 401 through the MCP.
 *
 * That distinction decides whether this is buildable at all or blocked on a console
 * action, and it is worth two minutes to know rather than assume.
 */

import { writeFileSync } from 'node:fs';

const BASE =
  'https://ep-wild-hall-ax3eyncw.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth';
const DEPLOYED = 'https://9l79mtej8j.execute-api.us-east-1.amazonaws.com';

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const safe = (t) =>
  t
    .replace(/"token":"[^"]+"/g, '"token":"<redacted>"')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>');

async function signUp(origin, label) {
  const email = `probe+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const res = await fetch(`${BASE}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password: 'Sf9!kQ2w-Lr8tVz3', name: 'Probe' }),
  });
  const text = await res.text();
  log(`${label}`);
  log(`  Origin: ${origin}`);
  log(`  -> ${res.status}  ${safe(text).slice(0, 300).replace(/\s+/g, ' ')}`);
  const cookies = res.headers.getSetCookie?.() ?? [];
  if (cookies.length) log(`  set-cookie: ${cookies.map((c) => c.split('=')[0]).join(', ')}`);
  return { status: res.status, text, cookies, email };
}

log(`auth base: ${BASE}`);
log('');

const local = await signUp('http://localhost:5173', 'A) localhost origin (allow_localhost is true)');
log('');
const deployed = await signUp(DEPLOYED, 'B) our deployed origin (not in trusted_origins)');

log('');
log('=== VERDICT ===');
if (local.status < 400 && deployed.status >= 400) {
  log('The mechanism works. The only blocker is that our origin is not trusted.');
  log('Fix: add it in the Neon console under Auth > trusted origins.');
} else if (local.status < 400 && deployed.status < 400) {
  log('Both accepted. No trusted-origin change needed at all.');
} else {
  log('Localhost was also refused, so something other than the origin list is wrong.');
}

// If either worked, carry on and find the JWT, because that is what our API must
// verify against the published JWKS.
const ok = deployed.status < 400 ? deployed : local.status < 400 ? local : null;
if (ok) {
  const origin = deployed.status < 400 ? DEPLOYED : 'http://localhost:5173';
  const cookie = ok.cookies.map((c) => c.split(';')[0]).join('; ');
  let bearer = null;
  try {
    bearer = JSON.parse(ok.text).token ?? null;
  } catch {
    /* ignore */
  }

  log('');
  log('--- fetching a JWT the JWKS can verify ---');
  const res = await fetch(`${BASE}/token`, {
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
  const text = await res.text();
  log(`GET /token -> ${res.status}  ${safe(text).slice(0, 200)}`);
  try {
    const jwt = JSON.parse(text).token;
    if (jwt) {
      const [h, p] = jwt.split('.');
      log(`  header: ${Buffer.from(h, 'base64url').toString()}`);
      log(`  claims: ${Buffer.from(p, 'base64url').toString().slice(0, 400)}`);
    }
  } catch {
    log('  no jwt in body');
  }
}

writeFileSync('probe-neon-auth2.txt', out.join('\n'));
