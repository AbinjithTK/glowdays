/**
 * Prepare a picked image for upload.
 *
 * A photo chosen from a phone's library is routinely 4-8 MB, and the deployed API
 * sits behind an API Gateway HTTP API whose body ceiling is around 4.25 MB - Lambda's
 * 6 MB synchronous limit after base64 inflation. Over that, the gateway answers 413
 * before our code runs and nothing appears in our logs. So this is not an
 * optimisation; without it a library photo simply fails.
 *
 * Diary photos get a smaller budget and a smaller maximum edge than check-in
 * photos, and that difference is deliberate. A check-in is an instrument: its short
 * side decides the analysis tier, so resolution is defended to the last byte. This
 * is a memento that is never measured and never analysed, so 1600px on the long
 * edge is generous and the bytes are better spent on being fast to upload over
 * mobile data.
 */

/** Comfortably inside the gateway ceiling, with room for the multipart envelope. */
const BUDGET_BYTES = 2.5 * 1024 * 1024;
const MAX_EDGE = 1600;

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

async function decode(file: File): Promise<{ width: number; height: number; draw: CanvasImageSource }> {
  // createImageBitmap honours EXIF orientation on modern browsers, which an
  // <img> in a canvas does not - without it, photos taken in portrait on a phone
  // arrive sideways.
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height, draw: bitmap };
    } catch {
      // Fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new PhotoError('That image could not be opened.'));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, draw: image };
  } finally {
    // Revoked after decoding; the canvas holds the pixels from here.
    URL.revokeObjectURL(url);
  }
}

export interface PreparedPhoto {
  readonly blob: Blob;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoError('That file is not an image.');
  }

  const { width, height, draw } = await decode(file);
  if (!width || !height) throw new PhotoError('That image has no dimensions.');

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('This browser cannot process images.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(draw, 0, 0, canvas.width, canvas.height);

  // Quality ladder rather than a single guess. A flat 0.9 is far too large for a
  // detailed photo and wastefully small for a plain one.
  let blob: Blob | null = null;
  for (const quality of [0.88, 0.8, 0.7, 0.6]) {
    // eslint-disable-next-line no-await-in-loop
    blob = await toBlob(canvas, quality);
    if (blob && blob.size <= BUDGET_BYTES) break;
  }
  if (!blob) throw new PhotoError('That image could not be prepared.');

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  };
}
