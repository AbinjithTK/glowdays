/**
 * Error responses.
 *
 * One shape for every failure, so the client has one branch to write. Follows
 * RFC 9457 problem details loosely: `type`, `title`, `status`, `detail`.
 *
 * `AppError` carries a machine-readable `code`. The client switches on that,
 * never on the prose, so copy can change without breaking behaviour.
 *
 * Unexpected errors return a generic body. Stack traces and driver messages
 * stay in the log: a Postgres error string can name columns and constraints,
 * and there is no reason to hand that to the internet.
 */

import type { Context } from 'hono';

export type ErrorCode =
  | 'unauthorised'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'conflict'
  | 'consent_required'
  | 'tier_mismatch'
  | 'analysis_failed'
  | 'rate_limited'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  unauthorised: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  consent_required: 428,
  tier_mismatch: 422,
  analysis_failed: 502,
  rate_limited: 429,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail: string;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { detail?: string; extra?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = opts?.detail ?? message;
    this.extra = opts?.extra ?? {};
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export interface ProblemBody {
  readonly code: ErrorCode;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly [key: string]: unknown;
}

export function problemBody(err: AppError): ProblemBody {
  return {
    code: err.code,
    title: err.message,
    status: err.status,
    detail: err.detail,
    ...err.extra,
  };
}

/** Hono `onError` handler. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof AppError) {
    return c.json(problemBody(err), err.status as 400);
  }
  // Log the real cause, return nothing that describes our internals.
  console.error('[unhandled]', err.name, err.message, err.stack);
  return c.json(
    {
      code: 'internal' satisfies ErrorCode,
      title: 'Something went wrong on our side',
      status: 500,
      detail: 'The request was not completed. Nothing was charged and nothing was lost.',
    },
    500,
  );
}

/** Paths that belong to the API. Anything else is the single-page app. */
const API_PREFIXES = ['/v1', '/auth', '/dev', '/media', '/health', '/ready'];

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * A missing API route returns JSON. Anything else is a client-side route and has
 * to reach the app shell, or a refresh on /what-changed would 404 instead of
 * loading the app and routing itself.
 */
export function notFound(c: Context): Response {
  const { pathname } = new URL(c.req.url);
  if (!isApiPath(pathname)) {
    // Handled by the static handler in server.ts, which is registered later.
    return c.text('Not found', 404);
  }
  return c.json(
    {
      code: 'not_found' satisfies ErrorCode,
      title: 'No such endpoint',
      status: 404,
      detail: `${c.req.method} ${pathname} is not a route on this API.`,
    },
    404,
  );
}
