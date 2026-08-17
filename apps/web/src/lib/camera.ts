/**
 * Camera access.
 *
 * The single most important thing this file does is report the resolution the
 * device actually delivered, rather than the one we asked for. Browsers treat
 * resolution constraints as a preference and silently give you something else,
 * and the number decides which analysis tier is reachable: the provider needs
 * 1080px on the short side for high detail, 480px for standard. A scan
 * mislabelled as high detail would later be compared against a real high-detail
 * scan, and the confidence engine has no way to detect that.
 *
 * So `open()` returns what was granted, and the caller is expected to show it.
 */

export type CameraFailure =
  | 'insecure_context'
  | 'unsupported'
  | 'permission_denied'
  | 'no_camera'
  | 'in_use'
  | 'unknown';

export class CameraError extends Error {
  readonly reason: CameraFailure;
  /** True when the user could plausibly fix it and try again. */
  readonly recoverable: boolean;

  constructor(reason: CameraFailure, message: string, recoverable = true) {
    super(message);
    this.name = 'CameraError';
    this.reason = reason;
    this.recoverable = recoverable;
  }
}

export interface CameraSession {
  readonly stream: MediaStream;
  /** What the device actually granted, not what was requested. */
  readonly width: number;
  readonly height: number;
  readonly shortSidePx: number;
  readonly deviceLabel: string;
  /** Highest short side the hardware claims it can do, when it says. */
  readonly maxShortSidePx: number | null;
  stop(): void;
}

/**
 * getUserMedia does not exist outside a secure context, and the failure mode is
 * confusing: `navigator.mediaDevices` is simply undefined, so naive code throws
 * a TypeError about reading a property rather than saying the page needs HTTPS.
 * Checked first so the message can be accurate.
 */
export function cameraAvailability(): { ok: true } | { ok: false; reason: CameraFailure } {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!window.isSecureContext) return { ok: false, reason: 'insecure_context' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

function classify(err: unknown): CameraError {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'permission_denied',
        'Camera access was declined. You can allow it and try again, or pick a photo you already have.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no_camera', 'No usable camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError(
        'in_use',
        'The camera is busy. Close anything else using it and try again.',
      );
    default:
      return new CameraError('unknown', 'The camera could not be started.');
  }
}

/**
 * Ask for the front camera at the highest resolution it will give.
 *
 * `ideal` rather than `min` deliberately. A hard minimum makes the whole request
 * fail on a device that cannot reach 1080, which would leave someone with no
 * camera at all rather than a standard-detail check-in - and a standard-detail
 * measurement is a real measurement, just a different instrument.
 */
export async function open(): Promise<CameraSession> {
  const availability = cameraAvailability();
  if (!availability.ok) {
    const message =
      availability.reason === 'insecure_context'
        ? 'The camera is only available over a secure connection. Open this page on https.'
        : 'This browser does not support camera capture.';
    throw new CameraError(availability.reason, message, false);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        // Portrait target. Phones usually report a landscape-native sensor, so
        // the short side is what these end up governing either way.
        width: { ideal: 1440 },
        height: { ideal: 1920 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  } catch (err) {
    throw classify(err);
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError('no_camera', 'The camera started but produced no video.');
  }

  const settings = track.getSettings();
  const width = settings.width ?? 0;
  const height = settings.height ?? 0;

  // Capabilities are advisory and not every browser implements them, so this is
  // reported as "claims" rather than treated as fact.
  let maxShortSidePx: number | null = null;
  try {
    const caps = track.getCapabilities?.();
    if (caps?.width?.max && caps.height?.max) {
      maxShortSidePx = Math.min(caps.width.max, caps.height.max);
    }
  } catch {
    maxShortSidePx = null;
  }

  return {
    stream,
    width,
    height,
    shortSidePx: Math.min(width, height),
    deviceLabel: track.label || 'front camera',
    maxShortSidePx,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

export interface Capture {
  readonly blob: Blob;
  /** Dimensions of the image actually encoded, which may be smaller than the
   *  frame the camera produced. See UPLOAD_BUDGET_BYTES. */
  readonly width: number;
  readonly height: number;
  readonly shortSidePx: number;
  /** The frame the camera gave, before any downscale. Kept for the readout. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** True when the frame had to be reduced to fit the upload budget. */
  readonly downscaled: boolean;
  readonly bytes: number;
  /** The frame, for computing quality without re-reading the video element. */
  readonly bitmap: ImageData;
}

/**
 * The largest image this transport will carry.
 *
 * Measured, not assumed. The deployed API sits behind an API Gateway HTTP API in
 * front of Lambda, and Lambda's synchronous request payload limit is 6 MB for the
 * whole event - including the body after API Gateway has base64-encoded it, which
 * inflates binary by a third. Probing the deployed endpoint put the real ceiling
 * between 4.25 MB and 4.5 MB of raw image: 4.25 was delivered to the handler,
 * 4.5 came back 413 from the gateway before our code ran.
 *
 * A 413 from the gateway is the worst possible failure here, because it never
 * reaches Lambda, so nothing appears in our logs, and the browser is left holding
 * a request that was refused mid-flight. 3.5 MB leaves room for the meta field
 * and the multipart boundaries, which count toward the same limit.
 *
 * The honest alternative is a presigned direct-to-S3 upload, which has no such
 * ceiling. That is the right answer for large images and is noted in the
 * deployment notes; it is not a change to make hours before a deadline.
 */
export const UPLOAD_BUDGET_BYTES = 3.5 * 1024 * 1024;

/**
 * Encode ladder, in order of preference.
 *
 * Resolution is defended before quality, and the 1080 rungs come before any
 * smaller ones, because 1080 on the short side is the provider's threshold for
 * high-detail analysis. Dropping to 720 to save bytes would silently move a
 * check-in into the standard-detail tier, and the comparison engine refuses to
 * compare across tiers - so a byte-saving decision here would show up much later
 * as "these two check-ins cannot be compared", with nothing to explain why.
 *
 * `null` means "whatever the camera gave", never upscaled.
 */
const ENCODE_LADDER: readonly { shortSide: number | null; quality: number }[] = [
  { shortSide: null, quality: 0.92 },
  { shortSide: null, quality: 0.85 },
  { shortSide: 1080, quality: 0.9 },
  { shortSide: 1080, quality: 0.8 },
  { shortSide: 1080, quality: 0.7 },
  // Below the high-detail threshold. Reached only when 1080 cannot be made to
  // fit at all, and the Review screen says so before anything is sent.
  { shortSide: 720, quality: 0.85 },
  { shortSide: 480, quality: 0.8 },
];

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** Draw `source` scaled so its short side is `shortSide`. Aspect preserved. */
function scaled(source: HTMLCanvasElement, shortSide: number): HTMLCanvasElement {
  const factor = shortSide / Math.min(source.width, source.height);
  const out = document.createElement('canvas');
  out.width = Math.round(source.width * factor);
  out.height = Math.round(source.height * factor);
  const ctx = out.getContext('2d');
  if (ctx) {
    // Default smoothing on a large downscale produces aliasing that reads as
    // skin texture, which is the one thing being measured here.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
  }
  return out;
}

/**
 * Grab a frame and encode the largest version of it that will actually arrive.
 *
 * Uses `videoWidth`/`videoHeight`, which is the decoded frame size, not the CSS
 * size of the element. Drawing at the element's rendered size would hand the
 * provider a downscaled image and quietly drop the tier from high to standard.
 */
export async function capture(video: HTMLVideoElement): Promise<Capture> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new CameraError('unknown', 'The camera has not produced a frame yet.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CameraError('unsupported', 'This browser cannot read a camera frame.');

  // The preview is mirrored so it behaves like a mirror, but the saved frame
  // must not be: a flipped image would make every left/right reading, including
  // the cheek regions the provider scores separately, wrong.
  ctx.drawImage(video, 0, 0, width, height);

  // Quality is measured on the full frame regardless of what gets uploaded.
  // Both signals it computes - mean luminance and lateral imbalance - are
  // scale-invariant, so this costs nothing and uses the best data available.
  const bitmap = ctx.getImageData(0, 0, width, height);

  let best: { blob: Blob; canvas: HTMLCanvasElement } | null = null;

  for (const rung of ENCODE_LADDER) {
    const target =
      rung.shortSide === null || rung.shortSide >= Math.min(width, height)
        ? canvas
        : scaled(canvas, rung.shortSide);

    // eslint-disable-next-line no-await-in-loop
    const blob = await toBlob(target, rung.quality);
    if (!blob) continue;

    // Remember the first success at any size, so a frame that cannot be made to
    // fit still produces something rather than nothing - the API will refuse it
    // with a message, which beats an exception with none.
    best ??= { blob, canvas: target };
    if (blob.size <= UPLOAD_BUDGET_BYTES) {
      best = { blob, canvas: target };
      break;
    }
  }

  if (!best) throw new CameraError('unknown', 'The frame could not be encoded.');

  return {
    blob: best.blob,
    width: best.canvas.width,
    height: best.canvas.height,
    // The encoded short side, not the captured one. This is the number the
    // server will independently measure from the bytes, so the Review screen
    // must reason about the same value or it would promise a tier we are not
    // about to send.
    shortSidePx: Math.min(best.canvas.width, best.canvas.height),
    sourceWidth: width,
    sourceHeight: height,
    downscaled: best.canvas !== canvas,
    bytes: best.blob.size,
    bitmap,
  };
}
