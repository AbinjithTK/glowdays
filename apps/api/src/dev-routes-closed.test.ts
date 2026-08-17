/**
 * The dev routes must be closed unless explicitly opened.
 *
 * This exists because they were not. `/dev/token`, `/dev/backdate` and
 * `/dev/config` all answered 200 with no credentials of any kind, guarded only
 * by `NODE_ENV !== 'production'` - and NODE_ENV defaults to `development`, so a
 * deployment that omitted one environment variable exposed an endpoint that
 * mints a valid session for an arbitrary account.
 *
 * A fix without a test is a fix that comes back. This file runs in its own
 * process with the flag absent, which is the state a real deployment would be
 * in, and asserts every one of those endpoints is unreachable.
 *
 * Note what is deliberately NOT set below: ENABLE_DEV_ROUTES. Its absence is the
 * subject of the test.
 */

import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env['NODE_ENV'] = 'development';
process.env['DATABASE_URL'] = 'postgres://unused:unused@127.0.0.1:5432/unused';
process.env['AUTH_MODE'] = 'dev';
process.env['DEV_AUTH_SECRET'] = 'test-secret-at-least-sixteen-chars';
process.env['YOUCAM_MODE'] = 'fixture';
process.env['STORAGE_DRIVER'] = 'local';
process.env['CORS_ORIGINS'] = 'http://localhost:5173';
delete process.env['ENABLE_DEV_ROUTES'];

type App = { fetch: (req: Request) => Response | Promise<Response> };
let app: App;

before(async () => {
  const server = await import('./server.js');
  app = server.createApp();
});

function send(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        ...(body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      }),
    ),
  );
}

test('every /dev endpoint is unreachable without the explicit flag', async () => {
  const cases: [string, string, unknown?][] = [
    ['/dev/token', 'POST', { authUid: 'attacker', email: 'attacker@example.test' }],
    ['/dev/config', 'GET'],
    [
      '/dev/backdate',
      'POST',
      { scanId: '00000000-0000-0000-0000-000000000000', days: 30 },
    ],
    ['/dev/fixture-mask?action=hd_pore&region=whole', 'GET'],
  ];

  for (const [path, method, body] of cases) {
    const res = await send(path, method, body);
    assert.equal(res.status, 404, `${method} ${path} must be 404, got ${res.status}`);
  }
});

test('no token can be minted, so no session can be forged', async () => {
  const res = await send('/dev/token', 'POST', {
    authUid: 'dev:victim@example.com',
    email: 'victim@example.com',
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as Record<string, unknown>;
  // And nothing that looks like a credential comes back in the error body.
  assert.equal(body['token'], undefined);
});

test('CORS does not widen to private addresses without the flag', async () => {
  // With the flag set, a phone on the LAN is allowed so the camera can be
  // tested. Without it, that must not happen - the previous version keyed this
  // on NODE_ENV, so a deployment missing that variable relaxed its own policy.
  const res = await app.fetch(
    new Request('http://localhost/v1/scans', {
      headers: { origin: 'http://192.168.1.50:5173' },
    }),
  );
  assert.notEqual(res.headers.get('access-control-allow-origin'), 'http://192.168.1.50:5173');
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
});

test('the configured origin still works, so the fix is not just breaking CORS', async () => {
  const res = await app.fetch(
    new Request('http://localhost/v1/scans', {
      headers: { origin: 'http://localhost:5173' },
    }),
  );
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('liveness still answers, and readiness is a separate endpoint', async () => {
  const live = await send('/health');
  assert.equal(live.status, 200);

  // Readiness queries the database. There is none here, so it must report 503
  // rather than claiming healthy - which is what the single old check did.
  const ready = await send('/ready');
  assert.equal(ready.status, 503);
  const body = (await ready.json()) as { ready: boolean; reason: string };
  assert.equal(body.ready, false);
  assert.equal(body.reason, 'database_unreachable');
});
