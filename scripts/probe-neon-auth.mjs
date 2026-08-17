/**
 * Discover the Neon Auth (Better Auth) endpoint shapes before building on them.
 *
 * Two things need establishing, and guessing either would cost a deploy cycle:
 *
 *  1. Whether server-to-server calls are accepted. `trusted_origins` is empty on
 *     this branch and configure_neon_auth returns 401 through the MCP, so a browser
 *     calling the auth service directly from our deployed origin will very likely
 *     be refused by Better Auth's CSRF check, which validates the Origin header when
 *     one is present. A request from our Lambda sends no Origin at all. If that is
 *     accepted, the right design is our API acting as the client and the browser
 *     staying same-origin - which is better anyway: no CORS, no third-party origin
 *     in the browser, and one place that mints the token our own middleware trusts.
 *
 *  2. What a successful sign-in actually returns, and how to get a JWT that the
 *     published JWKS can verify. Better Auth is session-cookie first; the JWT is a
 *     separate endpoint.
 */

import { writeFileSync } from 'node:fs';

const BASE =
  'https://ep-wild-hall-ax3eyncw.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth';

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

/** Redact anything that looks like a credential before it reaches a log file. */
function safe(text) {
  return text
    .replace(/"token":"[^"]+"/g, '"token":"<redacted>"')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/"password":"[^"]+"/g, '"password":"<redacted>"');
}

async function call(method, path, body, headers = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    log(`${method} ${path} -> ${res.status}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) {
      log(`  set-cookie: ${setCookie.map((c) => c.split('=')[0]).join(', ')}`);
    }
    log(`  body: ${safe(text).slice(0, 500).replace(/\s+/g, ' ')}`);
    return { status: res.status, text, cookies: setCookie };
  } catch (err) {
    log(`${method} ${path} -> THREW ${err?.message}`);
    return { status: 0, text: '', cookies: [] };
  }
}

log(`base: ${BASE}`);

// ------------------------------------------------------------------- jwks

const jwks = await call('GET', '/.well-known/jwks.json');
try {
  const keys = JSON.parse(jwks.text).keys ?? [];
  log(`  jwks keys: ${keys.length}, alg=${keys.map((k) => k.alg ?? k.kty).join(',')}`);
} catch {
  log('  jwks unparseable');
}

// -------------------------------------------------------------- sign up

const email = `neon+${Date.now()}@example.com`;
const password = 'Sf9!kQ2w-Lr8tVz3';

log('');
log('--- sign up, server to server, no Origin header ---');
const signUp = await call('POST', '/sign-up/email', {
  email,
  password,
  name: 'Probe User',
});

// ------------------------------------------------------------- sign in

log('');
log('--- sign in ---');
const signIn = await call('POST', '/sign-in/email', { email, password });

// Better Auth returns a session token in the body and/or a cookie. Both paths are
// checked because which one arrives decides how our API forwards it.
let bearer = null;
let cookie = null;
try {
  const parsed = JSON.parse(signIn.text);
  bearer = parsed.token ?? parsed.session?.token ?? null;
} catch {
  /* reported above */
}
if (signIn.cookies.length) cookie = signIn.cookies.map((c) => c.split(';')[0]).join('; ');
log(`  body token present: ${Boolean(bearer)}   cookie present: ${Boolean(cookie)}`);

// ---------------------------------------------------------------- token

// The JWKS exists, so there is a JWT somewhere. Better Auth's jwt plugin exposes it
// at /token, authenticated by the session.
log('');
log('--- getting a JWT that the JWKS can verify ---');
for (const [label, headers] of [
  ['with cookie', cookie ? { Cookie: cookie } : null],
  ['with bearer', bearer ? { Authorization: `Bearer ${bearer}` } : null],
]) {
  if (!headers) {
    log(`/token ${label}: skipped, nothing to send`);
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const tok = await call('GET', '/token', null, headers);
  if (tok.status === 200) {
    try {
      const jwt = JSON.parse(tok.text).token;
      if (jwt) {
        const [h, p] = jwt.split('.');
        log(`  header: ${Buffer.from(h, 'base64url').toString()}`);
        log(`  claims: ${Buffer.from(p, 'base64url').toString().slice(0, 300)}`);
      }
    } catch {
      log('  token body unparseable');
    }
    break;
  }
}

// --------------------------------------------------------------- session

log('');
log('--- session lookup, which is how our API would resolve a caller ---');
if (cookie) await call('GET', '/get-session', null, { Cookie: cookie });

writeFileSync('probe-neon-auth.txt', out.join('\n'));
