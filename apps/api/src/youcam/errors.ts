/**
 * Provider error codes, mapped to something a person can act on.
 *
 * Two decisions are encoded here.
 *
 * First, every code carries `retake`: whether the fix is to take another photo.
 * A face that was too small is the user's next action; an inference failure is
 * ours. Showing "try again" for our failure teaches people to distrust the app.
 *
 * Second, the message never blames. "Your face was too small" reads as a
 * personal failing for something that is a framing instruction.
 */

export type YouCamErrorCode =
  // skin-analysis specific
  | 'error_below_min_image_size'
  | 'error_exceed_max_image_size'
  | 'error_src_face_too_small'
  | 'error_src_face_out_of_bound'
  | 'error_lighting_dark'
  // platform wide
  | 'exceed_max_filesize'
  | 'invalid_parameter'
  | 'error_download_image'
  | 'error_decode_image'
  | 'error_nsfw_content_detected'
  | 'error_no_face'
  | 'error_pose'
  | 'error_face_parsing'
  | 'error_inference'
  | 'error_upload'
  | 'error_multiple_people'
  | 'error_large_face_angle'
  | 'error_unsupport_ratio'
  | 'unknown_internal_error';

export interface ErrorPresentation {
  /** Sentence case, no full stop. Used as a heading. */
  readonly title: string;
  /** One or two sentences saying what to do next. */
  readonly detail: string;
  /** True when another photo would plausibly succeed. */
  readonly retake: boolean;
  /** True when the cause is on our side, not the user's. */
  readonly ours: boolean;
}

const MAP: Record<YouCamErrorCode, ErrorPresentation> = {
  error_below_min_image_size: {
    title: 'That photo is too small to read',
    detail:
      'High detail needs at least 1080 pixels on the short side. Your camera may be set to a lower resolution.',
    retake: true,
    ours: false,
  },
  error_exceed_max_image_size: {
    title: 'That photo is larger than the analyser accepts',
    detail: 'Take another one and it will be resized before it is sent.',
    retake: true,
    ours: true,
  },
  error_src_face_too_small: {
    title: 'Move a little closer',
    detail:
      'Your face needs to fill more than 60% of the frame width. The guide oval shows the target.',
    retake: true,
    ours: false,
  },
  error_src_face_out_of_bound: {
    title: 'Part of your face was outside the frame',
    detail: 'Centre yourself inside the guide oval and take it again.',
    retake: true,
    ours: false,
  },
  error_lighting_dark: {
    title: 'Too dark to measure',
    detail:
      'Face a window or a lamp. Even light matters more than bright light, and this reading would not be comparable.',
    retake: true,
    ours: false,
  },
  exceed_max_filesize: {
    title: 'That file is too large',
    detail: 'Images must be under 10 MB. Take another one and it will be compressed first.',
    retake: true,
    ours: true,
  },
  invalid_parameter: {
    title: 'We sent that request wrongly',
    detail: 'This is our bug, not your photo. Nothing was charged to your account.',
    retake: false,
    ours: true,
  },
  error_download_image: {
    title: 'The analyser could not read the upload',
    detail: 'The photo is still saved here. Try running the analysis again.',
    retake: false,
    ours: true,
  },
  error_decode_image: {
    title: 'That image could not be opened',
    detail: 'The file may have been damaged during upload. Taking it again usually fixes it.',
    retake: true,
    ours: true,
  },
  error_nsfw_content_detected: {
    title: 'That photo was rejected',
    detail: 'The analyser only accepts a clear photo of a face.',
    retake: true,
    ours: false,
  },
  error_no_face: {
    title: 'No face found in that photo',
    detail: 'Look straight at the camera with your whole face inside the guide oval.',
    retake: true,
    ours: false,
  },
  error_pose: {
    title: 'Your head was turned too far',
    detail: 'Face the camera straight on. Angle changes alone can move a score.',
    retake: true,
    ours: false,
  },
  error_face_parsing: {
    title: 'Your face could not be mapped',
    detail:
      'Hair, glasses or a mask covering part of the face will do this. Clear the face and try again.',
    retake: true,
    ours: false,
  },
  error_inference: {
    title: 'The analysis failed part way through',
    detail: 'Your photo is saved. Running it again is usually enough.',
    retake: false,
    ours: true,
  },
  error_upload: {
    title: 'The upload did not finish',
    detail: 'Check your connection and try again. Nothing was analysed.',
    retake: false,
    ours: true,
  },
  error_multiple_people: {
    title: 'More than one face in the frame',
    detail: 'The analyser needs a single face. Move so that only you are in shot.',
    retake: true,
    ours: false,
  },
  error_large_face_angle: {
    title: 'Your head was tilted too far',
    detail: 'Keep your head level and look straight ahead.',
    retake: true,
    ours: false,
  },
  error_unsupport_ratio: {
    title: 'That image shape is not supported',
    detail: 'Portrait orientation works best. Take another with the phone upright.',
    retake: true,
    ours: false,
  },
  unknown_internal_error: {
    title: 'The analyser had a problem',
    detail: 'Your photo is saved here and nothing was lost. Try again in a moment.',
    retake: false,
    ours: true,
  },
};

const FALLBACK: ErrorPresentation = {
  title: 'The analysis did not complete',
  detail: 'Your photo is saved here. Try again in a moment.',
  retake: false,
  ours: true,
};

export function presentError(code: string | null | undefined): ErrorPresentation {
  if (!code) return FALLBACK;
  return MAP[code as YouCamErrorCode] ?? FALLBACK;
}

/** Thrown by the client. Carries the provider code so the route can map it. */
export class YouCamError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(code: string, message: string, opts?: { httpStatus?: number; retryable?: boolean }) {
    super(message);
    this.name = 'YouCamError';
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? null;
    this.retryable = opts?.retryable ?? false;
  }
}
