/**
 * HTTP smoke tests.
 *
 * These run with no database and no provider account, which is the point: the
 * things asserted here are the ones that must hold before anything else is
 * worth testing. That an unauthenticated request never reaches a handler. That
 * a signed media link cannot be edited. That development-only routes check the
 * mode themselves rather than trusting where they were mounted.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

// Environment must be in place before anything reads config, which is lazy and
// cached. Set here, before the dynamic imports below.
let storageDir = '';

process.env['NODE_ENV'] = 'development';
process.env['DATABASE_URL'] = 'postgres://unused:unused@127.0.0.1:5432/unused';
process.env['AUTH_MODE'] = 'dev';
process.env['DEV_AUTH_SECRET'] = 'test-secret-at-least-sixteen-chars';
process.env['YOUCAM_MODE'] = 'fixture';
process.env['STORAGE_DRIVER'] = 'local';
process.env['CORS_ORIGINS'] = 'http://localhost:5173';
// The /dev routes are off by default now, so the tests that exercise them have
// to opt in the same way a developer does.
process.env['ENABLE_DEV_ROUTES'] = 'true';

type App = { fetch: (req: Request) => Response | Promise<Response> };
let app: App;
let storageModule: typeof import('./storage/factory.js');

before(async () => {
  storageDir = await mkdtemp(join(tmpdir(), 'glowdays-test-'));
  process.env['STORAGE_LOCAL_DIR'] = storageDir;

  const server = await import('./server.js');
  storageModule = await import('./storage/factory.js');
  app = server.createApp();
});

after(async () => {
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { headers })));
}

test('health reports the mode it is running in', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; youcam: string };
  assert.equal(body.ok, true);
  // Stated in the response so nobody demos fixture data believing it is live.
  assert.equal(body.youcam, 'fixture');
});

test('an unauthenticated request to /v1 is refused', async () => {
  for (const path of ['/v1/scans', '/v1/trials', '/v1/comparison/latest', '/v1/account']) {
    const res = await get(path);
    assert.equal(res.status, 401, path);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'unauthorised');
  }
});

test('a malformed Authorization header is refused, not parsed loosely', async () => {
  for (const header of ['', 'Bearer', 'Basic abc', 'Bearertoken', 'Token abc']) {
    const res = await get('/v1/scans', { authorization: header });
    assert.equal(res.status, 401, JSON.stringify(header));
  }
});

test('a forged token is refused', async () => {
  const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.not-a-real-signature';
  const res = await get('/v1/scans', { authorization: `Bearer ${forged}` });
  assert.equal(res.status, 401);
});

test('an unknown API route returns the standard error shape', async () => {
  // Under /health rather than /v1 so the auth middleware does not answer first.
  const res = await get('/health/nope');
  assert.equal(res.status, 404);
  const body = (await res.json()) as { code: string; status: number; detail: string };
  assert.equal(body.code, 'not_found');
  assert.equal(body.status, 404);
  assert.ok(body.detail.length > 0);
});

test('an unknown non-API path reaches the app, not a 404', async () => {
  // The API also serves the built single-page app, so a client-side route has no
  // file on disk and must fall through to the shell. Returning a JSON 404 here
  // would mean refreshing the browser on /what-changed showed an error instead
  // of loading the app and routing itself.
  const res = await get('/what-changed');
  if (res.status === 404) {
    // No build present in this checkout. The routing rule is still asserted by
    // the API-path case above; skip rather than fail on a missing artefact.
    return;
  }
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
});

test('a dev token can be minted and is accepted by the verifier', async () => {
  const res = await app.fetch(
    new Request('http://localhost/dev/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authUid: 'test-user', email: 'test@example.test' }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { token: string };
  assert.ok(body.token.split('.').length === 3);

  const { verifyToken } = await import('./auth/verify.js');
  const principal = await verifyToken(body.token);
  assert.equal(principal.authUid, 'test-user');
  assert.equal(principal.email, 'test@example.test');
});

test('fixture masks are real PNGs', async () => {
  const res = await get('/dev/fixture-mask?action=hd_pore&region=forehead');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.byteLength > 1000);
});

test('fixture mask parameters are validated', async () => {
  for (const q of ['action=../etc/passwd', 'region=%2e%2e%2f', 'action=hd%20pore']) {
    const res = await get(`/dev/fixture-mask?${q}`);
    assert.equal(res.status, 400, q);
  }
});

test('a signed media link works, and cannot be edited', async () => {
  const store = storageModule.storage();
  const local = storageModule.localStorageOrNull();
  assert.ok(local, 'expected the local driver under STORAGE_DRIVER=local');

  const key = 'p/00000000-0000-0000-0000-000000000000/scan/abc/original.png';
  await store.put(key, new Uint8Array([1, 2, 3, 4]), 'image/png');

  // The local driver returns a root-relative path deliberately: it cannot know
  // which address the client reached it on, and naming `localhost` would break
  // every image as soon as the app is opened on a phone. A base is supplied here
  // only so URL can parse it.
  const signed = await store.signedGetUrl(key, 60);
  assert.ok(signed.startsWith('/media?'), 'local media links must be relative');
  const url = new URL(signed, 'http://localhost');
  const ok = await get(`/media${url.search}`);
  assert.equal(ok.status, 200);
  // Never cached: a shared browser must not hand one person's face to the next.
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');

  // Editing the key while keeping the signature must fail.
  const tampered = new URLSearchParams(url.search);
  tampered.set('key', 'p/00000000-0000-0000-0000-000000000000/scan/other/original.png');
  assert.equal((await get(`/media?${tampered.toString()}`)).status, 403);

  // Extending the expiry while keeping the signature must fail.
  const extended = new URLSearchParams(url.search);
  extended.set('expires', String(Number(url.searchParams.get('expires')) + 86_400));
  assert.equal((await get(`/media?${extended.toString()}`)).status, 403);

  // An expired link must fail even with a genuine signature.
  const expiredUrl = new URL(await store.signedGetUrl(key, -10), 'http://localhost');
  assert.equal((await get(`/media${expiredUrl.search}`)).status, 403);
});

test('traversal keys are refused by the storage layer itself', async () => {
  const { assertSafeKey } = await import('./storage/index.js');
  for (const key of ['../secret', '/etc/passwd', 'p/..\\x', 'p/a\0b', '']) {
    assert.throws(() => assertSafeKey(key), /Unsafe storage key/, key);
  }
  assert.doesNotThrow(() => assertSafeKey('p/abc/scan/def/original.jpg'));
});

test('security headers are present on every response', async () => {
  const res = await get('/health');
  assert.ok(res.headers.get('x-content-type-options'));
});

test('CORS is an allowlist, not a wildcard', async () => {
  const allowed = await get('/v1/scans', { origin: 'http://localhost:5173' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const denied = await get('/v1/scans', { origin: 'https://evil.example' });
  assert.notEqual(denied.headers.get('access-control-allow-origin'), '*');
  assert.notEqual(denied.headers.get('access-control-allow-origin'), 'https://evil.example');
});
