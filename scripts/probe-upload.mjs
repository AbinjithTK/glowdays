/**
 * Probe the deployed check-in upload.
 *
 * Exists because the browser symptom ("Saving…" forever) is compatible with
 * three different causes that need different fixes: multipart corrupted through
 * API Gateway, a payload size limit, or the request never arriving. Guessing
 * between them costs a deploy cycle each. This asks the deployed endpoint
 * directly, with the same content type the browser sends, at two sizes.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
function log(line) {
  out.push(line);
  console.log(line);
}

/** A syntactically valid JPEG of a given rough size. Content is irrelevant here;
 *  the transport is what is under test. */
function fakeJpeg(bytes) {
  const buf = Buffer.alloc(bytes, 0x5a);
  // SOI + APP0 so anything sniffing the magic number is satisfied.
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buf, 0);
  Buffer.from([0xff, 0xd9]).copy(buf, bytes - 2);
  return buf;
}

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

async function timed(label, fn) {
  const started = Date.now();
  try {
    const res = await fn();
    const text = await res.text();
    log(
      `${label}: ${res.status} in ${Date.now() - started}ms  ${text.slice(0, 400).replace(/\s+/g, ' ')}`,
    );
    return { status: res.status, text };
  } catch (err) {
    log(`${label}: THREW after ${Date.now() - started}ms  ${err?.message ?? err}`);
    return { status: 0, text: '' };
  }
}

// ------------------------------------------------------------------ health

log(`base: ${BASE}`);
await timed('GET /health', () => fetch(`${BASE}/health`));
await timed('GET /ready', () => fetch(`${BASE}/ready`));

// ----------------------------------------------------------------- session

const session = await timed('POST /session', () =>
  fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'probe@example.com', code: CODE }),
  }),
);

let token = null;
try {
  token = JSON.parse(session.text).token;
} catch {
  /* reported below */
}
if (!token) {
  log('no token, cannot probe the upload');
  writeFileSync('probe-upload.txt', out.join('\n'));
  process.exit(1);
}
log(`token: ${token.slice(0, 16)}… (${token.length} chars)`);

// ------------------------------------------------------------------ upload

/** Multipart exactly as the browser builds it, via FormData + fetch. */
async function upload(label, bytes) {
  const form = new FormData();
  form.set('image', new Blob([fakeJpeg(bytes)], { type: 'image/jpeg' }), 'check-in.jpg');
  form.set('meta', META);
  return timed(`POST /v1/scans (${(bytes / 1024).toFixed(0)} KB)  ${label}`, () =>
    fetch(`${BASE}/v1/scans`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    }),
  );
}

// Small: does multipart survive the gateway at all.
await upload('small', 40 * 1024);
// Typical phone photo: does the payload limit bite. Lambda's synchronous request
// limit is 6 MB and API Gateway base64-encodes binary, inflating by a third.
await upload('phone-sized', 3 * 1024 * 1024);
await upload('large', 5 * 1024 * 1024);

writeFileSync('probe-upload.txt', out.join('\n'));
