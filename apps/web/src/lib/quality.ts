/**
 * Capture quality, measured from the frame.
 *
 * The confidence engine grades five signals, and two of them can be computed
 * from pixels alone: how bright the frame is, and how unevenly the light falls
 * across it. The other three - how much of the frame the face fills, and the
 * head's rotation - need to know where the face is.
 *
 * The rule this file follows is that nothing is invented. Where a value can be
 * measured it is measured. Where it cannot, `source` comes back as `declared`
 * and the API caps the resulting comparison's confidence, rather than the app
 * passing a plausible-looking zero and letting the engine grade it as perfect
 * framing. A fabricated input to a confidence score is worse than no score.
 *
 * CameraKit replaces all of this and returns all five properly, which is why the
 * shape here matches what it provides.
 */

export interface MeasuredQuality {
  /** 0..1 mean relative luminance over the region a face should occupy. */
  readonly lightingLevel: number;
  /** 0..1 lateral luminance imbalance across that region. */
  readonly lightingUneven: number;
  /** 0.0..1 face width as a proportion of frame width. */
  readonly faceRatio: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  /**
   * `camerakit` only when every value above was measured. `declared` when the
   * face-derived ones were not, which the API treats as weaker evidence.
   */
  readonly source: 'camerakit' | 'declared';
  /** Which values were genuinely measured, for the diagnostics readout. */
  readonly measured: readonly ('lighting' | 'framing' | 'pose')[];
}

/**
 * Rec. 709 relative luminance, on sRGB values.
 *
 * Deliberately not the mean of R, G and B. That treats a saturated red cheek as
 * being as bright as neutral skin at the same luminance, which would make
 * lighting readings depend on skin tone - the exact bias this product cannot
 * afford, since it compares the same person over time and across the population.
 */
function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Mean luminance of a rectangle, sampled on a stride.
 *
 * Every fourth pixel on both axes is a sixteenth of the work and the difference
 * in the mean is far below the thresholds the confidence bands use, so full
 * sampling would cost frame rate for no change in the answer.
 */
function meanLuma(
  data: Uint8ClampedArray,
  frameWidth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let total = 0;
  let count = 0;
  const stride = 4;
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const i = (y * frameWidth + x) * 4;
      total += luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

/**
 * The oval guide occupies the middle of the frame and the user is asked to fill
 * it, so this is where a face should be. Measuring the whole frame instead would
 * let a bright window behind someone read as good lighting on their face.
 */
const FACE_REGION = { x: 0.22, y: 0.16, w: 0.56, h: 0.62 } as const;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function faceRegionRect(width: number, height: number): Rect {
  return {
    x0: Math.floor(width * FACE_REGION.x),
    y0: Math.floor(height * FACE_REGION.y),
    x1: Math.floor(width * (FACE_REGION.x + FACE_REGION.w)),
    y1: Math.floor(height * (FACE_REGION.y + FACE_REGION.h)),
  };
}

export interface LightingReading {
  readonly level: number;
  readonly uneven: number;
}

export function measureLighting(frame: ImageData): LightingReading {
  const { width, height, data } = frame;
  const r = faceRegionRect(width, height);
  const midX = Math.floor((r.x0 + r.x1) / 2);

  const level = meanLuma(data, width, r.x0, r.y0, r.x1, r.y1);
  const left = meanLuma(data, width, r.x0, r.y0, midX, r.y1);
  const right = meanLuma(data, width, midX, r.y0, r.x1, r.y1);

  return {
    level: Math.min(1, Math.max(0, level)),
    // The provider defines unevenness as the luminance difference between the
    // eyes. This is the same idea measured across the whole face region, so it
    // detects the case that matters - light from one side - without claiming to
    // be the identical statistic.
    uneven: Math.min(1, Math.abs(left - right)),
  };
}

/**
 * The browser's Shape Detection API, when it exists.
 *
 * Available on some Chromium builds and usually behind a flag, so it is treated
 * as a bonus rather than a dependency. It gives a bounding box and no pose, so
 * even when present it can only satisfy the framing signal.
 */
interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}
interface FaceDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedFace[]>;
}

function faceDetector(): FaceDetectorLike | null {
  const ctor = (globalThis as { FaceDetector?: new (opts?: unknown) => FaceDetectorLike })
    .FaceDetector;
  if (!ctor) return null;
  try {
    return new ctor({ fastMode: true, maxDetectedFaces: 1 });
  } catch {
    return null;
  }
}

export async function measureQuality(frame: ImageData): Promise<MeasuredQuality> {
  const lighting = measureLighting(frame);
  const measured: ('lighting' | 'framing' | 'pose')[] = ['lighting'];

  let faceRatio = 0;
  const detector = faceDetector();
  if (detector) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.getContext('2d')?.putImageData(frame, 0, 0);
      const faces = await detector.detect(canvas);
      const first = faces[0];
      if (first) {
        faceRatio = Math.min(1, first.boundingBox.width / frame.width);
        measured.push('framing');
      }
    } catch {
      // Detection is optional. A failure means one fewer measured signal.
    }
  }

  return {
    lightingLevel: lighting.level,
    lightingUneven: lighting.uneven,
    faceRatio,
    // Not measured. Reported as zero and marked declared, which is what stops
    // the API from reading them as a perfectly square-on head.
    yaw: 0,
    pitch: 0,
    roll: 0,
    // Every signal has to be measured to claim the stronger source. Framing
    // alone is not enough, because pose changes a reading on its own.
    source: measured.length === 3 ? 'camerakit' : 'declared',
    measured,
  };
}

/** Provider minimums, mirrored here so the UI can explain before uploading. */
export const MIN_SHORT_SIDE = { hd: 1080, sd: 480 } as const;

export function tierFor(shortSidePx: number): 'hd' | 'sd' | null {
  if (shortSidePx >= MIN_SHORT_SIDE.hd) return 'hd';
  if (shortSidePx >= MIN_SHORT_SIDE.sd) return 'sd';
  return null;
}

/** Plain-language verdict for the diagnostics readout. */
export function tierExplanation(shortSidePx: number): string {
  const tier = tierFor(shortSidePx);
  if (tier === 'hd') return 'High detail is available on this camera.';
  if (tier === 'sd') {
    return `This camera gives ${shortSidePx}px on the short side. High detail needs 1080, so check-ins here are standard detail, and are only ever compared with other standard-detail check-ins.`;
  }
  return `This camera gives ${shortSidePx}px on the short side, below the 480 the analyser needs.`;
}
