/**
 * Reads image dimensions from the file header.
 *
 * The tier decision depends on the short side being at least 1080 pixels, and
 * the tier decides whether two scans may be compared at all. If the client
 * reported that number we would be trusting a browser to tell us how much to
 * trust its own photo. So it is measured here, from the bytes, before anything
 * is sent to the provider.
 *
 * This also catches a mislabelled content type - a PNG sent as image/jpeg -
 * which the provider would reject after we had already paid for the call.
 */

export type ImageFormat = 'jpeg' | 'png';

export interface ImageInfo {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly shortSidePx: number;
  readonly contentType: string;
  readonly extension: string;
}

export class UnreadableImage extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableImage';
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, i) => b[i] === byte);
}

function readPng(b: Uint8Array): { width: number; height: number } {
  // IHDR is always the first chunk: 8 signature + 4 length + 4 type, then
  // width and height as big-endian 32-bit at offsets 16 and 20.
  if (b.length < 24) throw new UnreadableImage('PNG header truncated');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Start-of-frame markers. Baseline, progressive, and the arithmetic variants. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpeg(b: Uint8Array): { width: number; height: number } {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new UnreadableImage('Not a JPEG');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 2;

  while (offset < b.length - 1) {
    if (b[offset] !== 0xff) {
      offset += 1; // Skip fill bytes rather than giving up.
      continue;
    }
    const marker = b[offset + 1];
    if (marker === undefined) break;

    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI or start of scan

    const length = view.getUint16(offset + 2);
    if (length < 2) throw new UnreadableImage('JPEG segment length invalid');

    if (SOF_MARKERS.has(marker)) {
      if (offset + 9 > b.length) throw new UnreadableImage('JPEG frame header truncated');
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new UnreadableImage('No JPEG frame header found');
}

export function readImageInfo(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 24) throw new UnreadableImage('File is too small to be an image');

  if (isPng(bytes)) {
    const { width, height } = readPng(bytes);
    assertSane(width, height);
    return {
      format: 'png',
      width,
      height,
      shortSidePx: Math.min(width, height),
      contentType: 'image/png',
      extension: 'png',
    };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const { width, height } = readJpeg(bytes);
    assertSane(width, height);
    return {
      format: 'jpeg',
      width,
      height,
      shortSidePx: Math.min(width, height),
      contentType: 'image/jpeg',
      extension: 'jpg',
    };
  }

  throw new UnreadableImage('Only JPEG and PNG are accepted');
}

function assertSane(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 16 ||
    height < 16 ||
    width > 20_000 ||
    height > 20_000
  ) {
    throw new UnreadableImage('Image dimensions are out of range');
  }
}

/** Provider minimums. Below the SD floor nothing can be analysed. */
export const MIN_SHORT_SIDE = { hd: 1080, sd: 480 } as const;

export function tierForShortSide(shortSidePx: number): 'hd' | 'sd' | null {
  if (shortSidePx >= MIN_SHORT_SIDE.hd) return 'hd';
  if (shortSidePx >= MIN_SHORT_SIDE.sd) return 'sd';
  return null;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
