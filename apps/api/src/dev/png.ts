/**
 * A minimal PNG writer, used only to generate fixture masks in development.
 *
 * Writing 60 lines of PNG encoding beats adding an image dependency for a
 * development-only feature. The point is that the whole mask pipeline - the
 * provider hands back a URL, we copy the bytes into our own storage inside the
 * two-hour window, the client reads them through a signed URL - runs locally
 * without spending API units. A pipeline that only ever runs in production is
 * a pipeline nobody has tested.
 */

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface Blob2D {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

/**
 * A transparent RGBA PNG with soft coloured blobs, matching how the real masks
 * are meant to be used: alpha-composited over the original photograph.
 */
export function maskPng(opts: {
  width: number;
  height: number;
  colour: readonly [number, number, number];
  blobs: readonly Blob2D[];
}): Uint8Array {
  const { width, height, colour, blobs } = opts;
  const [r, g, b] = colour;

  // One filter byte per row, then RGBA per pixel.
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      let alpha = 0;
      for (const blob of blobs) {
        const dx = x - blob.cx;
        const dy = y - blob.cy;
        const d = Math.sqrt(dx * dx + dy * dy) / blob.radius;
        if (d < 1) {
          // Smooth falloff so the composite does not show hard circles.
          const a = Math.round(210 * (1 - d) ** 1.6);
          if (a > alpha) alpha = a;
        }
      }
      const p = rowStart + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** Deterministic blob layout per metric region, so masks look plausible. */
export function blobsFor(action: string, region: string, width: number, height: number): Blob2D[] {
  const zones: Record<string, { x: number; y: number; spread: number }> = {
    forehead: { x: 0.5, y: 0.22, spread: 0.18 },
    glabellar: { x: 0.5, y: 0.36, spread: 0.07 },
    nose: { x: 0.5, y: 0.5, spread: 0.09 },
    cheek: { x: 0.28, y: 0.55, spread: 0.14 },
    crowfeet: { x: 0.24, y: 0.42, spread: 0.08 },
    periocular: { x: 0.35, y: 0.4, spread: 0.1 },
    nasolabial: { x: 0.36, y: 0.63, spread: 0.09 },
    marionette: { x: 0.36, y: 0.74, spread: 0.08 },
    whole: { x: 0.5, y: 0.5, spread: 0.34 },
  };
  const zone = zones[region] ?? zones['whole'] ?? { x: 0.5, y: 0.5, spread: 0.3 };

  let seed = 0x811c9dc5;
  for (const ch of `${action}:${region}`) {
    seed ^= ch.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const count = region === 'whole' ? 14 : 7;
  const blobs: Blob2D[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = next() * Math.PI * 2;
    const dist = Math.sqrt(next()) * zone.spread;
    blobs.push({
      cx: (zone.x + Math.cos(angle) * dist) * width,
      cy: (zone.y + Math.sin(angle) * dist) * height,
      radius: (0.012 + next() * 0.03) * width,
    });
    // Mirror the lateral zones so a single-sided layout does not look wrong.
    if (zone.x < 0.45) {
      const last = blobs[blobs.length - 1];
      if (last) blobs.push({ ...last, cx: width - last.cx });
    }
  }
  return blobs;
}
