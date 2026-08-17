/**
 * End-to-end probe of the deployed check-in pipeline.
 *
 * Walks the exact sequence the Capture screen walks: create, consent, analyse,
 * then poll. The image is a structurally valid 1080x1440 JPEG with no face in it,
 * which is deliberate - there is no face photograph in this repository to test
 * with, and this still exercises every part we are responsible for:
 *
 *   - multipart transport through API Gateway at a realistic size
 *   - the header-based dimension read and the tier decision
 *   - the S3 write and the database row
 *   - the consent gate, which must refuse analysis with 428 until it is given
 *   - the live provider call, and whether its refusal is presented as something
 *     a person could act on rather than a raw provider code
 *
 * The provider rejecting a faceless image is a pass, not a failure. What would be
 * a failure is a hang, a 500, or an error with no usable message.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

/**
 * A baseline JPEG skeleton: SOI, JFIF, quantisation table, SOF0 declaring the
 * dimensions, Huffman table, start of scan, padding, EOI. Enough that a header
 * reader measures it correctly and a decoder will treat it as a JPEG.
 */
function jpegOfSize(width, height, totalBytes) {
  const parts = [];
  parts.push(Buffer.from([0xff, 0xd8])); // SOI
  parts.push(
    Buffer.concat([
      Buffer.from([0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('JFIF\0', 'latin1'),
      Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    ]),
  ); // APP0
  parts.push(
    Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 0x10)]),
  ); // DQT
  const sof = Buffer.alloc(13);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2); // length
  sof.writeUInt8(8, 4); // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.writeUInt8(1, 9); // one component
  sof.writeUInt8(1, 10);
  sof.writeUInt8(0x11, 11);
  sof.writeUInt8(0, 12);
  parts.push(sof); // SOF0
  parts.push(
    Buffer.concat([Buffer.from([0xff, 0xc4, 0x00, 0x1f, 0x00]), Buffer.alloc(28, 0x00)]),
  ); // DHT
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])); // SOS

  const head = Buffer.concat(parts);
  const padding = Math.max(0, totalBytes - head.length - 2);
  // 0x00 padding cannot be mistaken for a marker.
  return Buffer.concat([head, Buffer.alloc(padding, 0x00), Buffer.from([0xff, 0xd9])]);
}

async function json(label, res) {
  const text = await res.text();
  log(`${label}: ${res.status}  ${text.slice(0, 500).replace(/\s+/g, ' ')}`);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

log(`base: ${BASE}`);

// ----------------------------------------------------------------- session

const token = (
  await (
    await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@example.com', code: CODE }),
    })
  ).json()
).token;
log(`signed in, token ${token.length} chars`);

const auth = { Authorization: `Bearer ${token}` };

// ------------------------------------------------------------------ create

// 1080 on the short side: the high-detail threshold. 600 KB is what a real
// camera frame of this size encodes to at quality 0.9.
const image = jpegOfSize(1080, 1440, 600 * 1024);
log(`image: 1080x1440, ${(image.length / 1024).toFixed(0)} KB`);

const form = new FormData();
form.set('image', new Blob([image], { type: 'image/jpeg' }), 'check-in.jpg');
form.set(
  'meta',
  JSON.stringify({
    source: 'declared',
    preset: 'MODERATE',
    lightingLevel: 0.62,
    lightingUneven: 0.08,
    // Exactly what an ordinary phone browser reports: lighting measured from the
    // pixels, framing and pose not measurable, so faceRatio is a placeholder.
    // This is the combination that used to be refused outright.
    faceRatio: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    measured: ['lighting'],
  }),
);

const created = await json(
  'POST /v1/scans',
  await fetch(`${BASE}/v1/scans`, { method: 'POST', headers: auth, body: form }),
);
const scanId = created?.scan?.id;
if (!scanId) {
  log('FAIL: no scan id returned');
  writeFileSync('probe-e2e.txt', out.join('\n'));
  process.exit(1);
}
log(`scan ${scanId}, tier ${created.scan.tier}, status ${created.scan.status}`);

// ------------------------------------------------- consent gate, before consent

// Must be refused. If this returns anything but 428 the gate is not a gate.
const gated = await json(
  'POST /analyse before consent (expect 428)',
  await fetch(`${BASE}/v1/scans/${scanId}/analyse`, { method: 'POST', headers: auth }),
);
log(gated?.status === 428 || gated?.code === 'consent_required' ? 'gate holds' : 'GATE FAILED');

// ----------------------------------------------------------------- consent

await json(
  'POST /consent',
  await fetch(`${BASE}/v1/scans/${scanId}/consent`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agree: true }),
  }),
);

// ----------------------------------------------------------------- analyse

await json(
  'POST /analyse',
  await fetch(`${BASE}/v1/scans/${scanId}/analyse`, { method: 'POST', headers: auth }),
);

// -------------------------------------------------------------------- poll

for (let i = 0; i < 20; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const detail = await (await fetch(`${BASE}/v1/scans/${scanId}`, { headers: auth })).json();
  const s = detail.scan?.status;
  log(
    `poll ${i}: status=${s} overall=${detail.scan?.overallScore ?? '-'} readings=${detail.readings?.length ?? 0} masks=${detail.masks?.length ?? 0}` +
      (detail.error ? `  error="${detail.error.title}" retake=${detail.error.retake} ours=${detail.error.ours}` : ''),
  );
  if (s === 'succeeded' || s === 'failed') break;
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, 2000));
}

writeFileSync('probe-e2e.txt', out.join('\n'));
