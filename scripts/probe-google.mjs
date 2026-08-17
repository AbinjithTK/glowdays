/**
 * Establish whether Google sign-in can actually be wired up, before building a button.
 *
 * The obstacle is not Google. Google is already enabled on this branch in Neon's
 * shared mode, so there are no client credentials to obtain. The obstacle is the
 * boundary: after the OAuth round trip the Better Auth session cookie is set on
 * `*.neonauth.<region>.aws.neon.tech`, which is a different site from the app. Our
 * server cannot read it, and the browser can only use it against the auth host.
 *
 * The way across is for the browser to call the auth service's `/token` endpoint with
 * credentials included, get the short-lived EdDSA JWT, and hand that to our API, which
 * verifies it against the published JWKS and mints a normal session. That only works
 * if the auth service returns permissive CORS headers for our origin, including
 * `Access-Control-Allow-Credentials`. Without it, a cross-site cookie fetch is refused
 * by the browser and no amount of application code fixes it.
 *
 * So: read the actual headers. Two checks, and both must pass.
 */

import { writeFileSync } from 'node:fs';

const AUTH = 'https://ep-wild-hall-ax3eyncw.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth';
const ORIGIN = 'https://9l79mtej8j.execute-api.us-east-1.amazonaws.com';

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

function cors(res) {
  return {
    allowOrigin: res.headers.get('access-control-allow-origin'),
    allowCredentials: res.headers.get('access-control-allow-credentials'),
    allowHeaders: res.headers.get('access-control-allow-headers'),
    allowMethods: res.headers.get('access-control-allow-methods'),
  };
}

// ------------------------------------------------------- 1. preflight /token

log('--- OPTIONS preflight for GET /token from our origin ---');
const pre = await fetch(`${AUTH}/token`, {
  method: 'OPTIONS',
  headers: {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'content-type',
  },
});
log(`  status: ${pre.status}`);
log(`  ${JSON.stringify(cors(pre), null, 0)}`);

// ------------------------------------------------------ 2. actual GET /token

// Unauthenticated, so a 401 is expected. What matters is whether the CORS headers
// come back at all, because a browser reads those before it reads the status.
log('');
log('--- GET /token from our origin, unauthenticated ---');
const get = await fetch(`${AUTH}/token`, { headers: { Origin: ORIGIN } });
log(`  status: ${get.status}`);
log(`  ${JSON.stringify(cors(get), null, 0)}`);

// ------------------------------------------------- 3. the social sign-in shape

log('');
log('--- POST /sign-in/social, to learn what it returns ---');
const social = await fetch(`${AUTH}/sign-in/social`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify({
    provider: 'google',
    callbackURL: `${ORIGIN}/auth/callback`,
    errorCallbackURL: `${ORIGIN}/sign-in?oauth=failed`,
  }),
});
const socialText = await social.text();
log(`  status: ${social.status}`);
log(`  ${JSON.stringify(cors(social), null, 0)}`);
// The URL points at Google and carries no secret of ours, so it is safe to show
// enough of it to confirm the provider and the redirect target.
try {
  const parsed = JSON.parse(socialText);
  if (parsed.url) {
    const u = new URL(parsed.url);
    log(`  redirect host: ${u.host}${u.pathname}`);
    log(`  redirect_uri:  ${u.searchParams.get('redirect_uri')}`);
    log(`  client_id set: ${Boolean(u.searchParams.get('client_id'))}`);
  } else {
    log(`  body: ${socialText.slice(0, 300)}`);
  }
} catch {
  log(`  body: ${socialText.slice(0, 300)}`);
}

// ---------------------------------------------------------------- verdict

log('');
log('=== VERDICT ===');
const preOk = pre.status < 400 && cors(pre).allowOrigin !== null;
const credOk = cors(pre).allowCredentials === 'true' || cors(get).allowCredentials === 'true';
if (preOk && credOk) {
  log('Viable: the browser can fetch /token cross-site with the session cookie.');
} else if (!cors(pre).allowOrigin && !cors(get).allowOrigin) {
  log('NOT viable via the browser: no CORS headers for our origin.');
  log('The cookie is on the auth host and cannot be read cross-site.');
} else {
  log('Partially permitted: CORS present but credentials not allowed.');
  log(`  allow-credentials preflight=${cors(pre).allowCredentials} get=${cors(get).allowCredentials}`);
}

writeFileSync('probe-google.txt', out.join('\n'));
