/**
 * Find the real upload ceiling.
 *
 * 3 MB reached the handler and 5 MB was refused by API Gateway with a 413, so the
 * limit sits between. Worth measuring rather than reading off a docs page,
 * because the client's size budget is derived from it and the failure is silent
 * from the browser's side.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const res = await fetch(`${BASE}/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'probe@example.com', code: CODE }),
});
const token = (await res.json()).token;

const META = JSON.stringify({
  source: 'declared',
  preset: 'MODERATE',
  lightingLevel: 0.6,
  lightingUneven: 0.1,
  faceRatio: 0.4,
  yaw: 0,
  pitch: 0,
  roll: 0,
});

async function attempt(bytes) {
  const buf = Buffer.alloc(bytes, 0x5a);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buf, 0);
  const form = new FormData();
  form.set('image', new Blob([buf], { type: 'image/jpeg' }), 'c.jpg');
  form.set('meta', META);
  try {
    const r = await fetch(`${BASE}/v1/scans`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    // 400 means our handler ran: the transport delivered it. 413 means the
    // gateway refused it before Lambda.
    const label = r.status === 413 ? 'REFUSED by gateway' : 'delivered to handler';
    log(`${(bytes / 1024 / 1024).toFixed(2)} MB raw -> ${r.status} ${label}`);
    return r.status !== 413;
  } catch (err) {
    log(`${(bytes / 1024 / 1024).toFixed(2)} MB raw -> threw: ${err?.message}`);
    return false;
  }
}

for (const mb of [3.5, 4, 4.25, 4.5, 4.75]) {
  // eslint-disable-next-line no-await-in-loop
  await attempt(Math.round(mb * 1024 * 1024));
}

writeFileSync('probe-limit.txt', out.join('\n'));
