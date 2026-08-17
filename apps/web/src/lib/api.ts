/**
 * API client.
 *
 * One place that knows the wire format, so a route change is one edit. Three
 * things it does deliberately:
 *
 *  - It surfaces the server's `code`, not its prose. Screens branch on
 *    `consent_required` or `tier_mismatch`; they never match on a message.
 *  - It carries `retake` through from provider errors, because "take another
 *    photo" and "this one is on us" are different screens and guessing wrong
 *    teaches people to distrust the app.
 *  - The token lives in memory with a sessionStorage copy, never localStorage.
 *    This app holds photographs of faces; a token that survives until someone
 *    clears their browser is a longer window than it needs.
 */

/**
 * Where the API lives. Same origin by default.
 *
 * An earlier version guessed `${protocol}//${hostname}:8787`, which breaks in
 * both directions that matter. Through an HTTPS tunnel it produces a port that
 * is not tunnelled; on a phone over plain HTTP it produced a working API call
 * but no camera, because getUserMedia requires a secure context and simply does
 * not exist on an insecure origin.
 *
 * Same-origin plus a dev-server proxy solves the lot: one address to tunnel, no
 * CORS in the request path, and the same topology as deployment. `VITE_API_BASE`
 * remains an override for the case where the API really is on another domain.
 */
function resolveBase(): string {
  const configured = import.meta.env['VITE_API_BASE'] as string | undefined;
  return configured ? configured.replace(/\/+$/, '') : '';
}

const BASE: string = resolveBase();

/** Exposed so an error message can name the address that failed. */
export function apiBase(): string {
  return BASE;
}

/**
 * Resolve a photo or mask URL for use in an `<img>`.
 *
 * The two storage drivers return different things and both are correct. S3
 * presigns an absolute URL against the bucket. The local driver returns a path,
 * because it cannot know which address the client reached it on - and guessing
 * `localhost` would break every image the moment the app is opened on a phone.
 */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${BASE}${url}` : url;
}

const TOKEN_KEY = 'glowdays.token';

let token: string | null = null;

/**
 * The token is observable, because the route guard depends on it.
 *
 * It used to be a bare module variable that the guard read during render. Writing
 * to a module variable does not tell React anything, so signing in set the token
 * and then relied on the subsequent `navigate` call to trigger the re-render that
 * would notice it. Any failure between those two steps left the app authenticated
 * in memory and still rendering the sign-in screen - which is exactly the reported
 * symptom, including the part where a reload fixes it, because a reload re-reads
 * the token during the first render.
 *
 * Making it a subscribable store means the guard reacts to the token itself
 * rather than to a navigation that happens to follow it.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToken(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, next);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing can refuse storage. In-memory is enough for the session.
  }
  listeners.forEach((l) => l());
}

export function loadToken(): string | null {
  if (token) return token;
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}

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
  | 'internal'
  | 'network';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  /** True when another photo would plausibly succeed. */
  readonly retake: boolean;
  /** True when the provider or we failed, rather than the photo. */
  readonly ours: boolean;

  constructor(init: {
    code: ErrorCode;
    status: number;
    title: string;
    detail: string;
    retake?: boolean;
    ours?: boolean;
  }) {
    super(init.title);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.detail = init.detail;
    this.retake = init.retake ?? false;
    this.ours = init.ours ?? false;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Multipart bodies bypass JSON encoding. */
  form?: FormData;
  signal?: AbortSignal;
  /** Overrides DEFAULT_TIMEOUT_MS. Uploads need longer. */
  timeoutMs?: number;
}

/**
 * Every request gets a deadline.
 *
 * Not defensive garnish. `fetch` has no default timeout, so any request that is
 * accepted and then never answered leaves its promise pending forever - and a
 * pending promise in a mutation means a button that says "Saving…" until the page
 * is reloaded, with no error, no retry and nothing on screen to explain it. That
 * is precisely the failure this app hit on a phone. A deadline converts an
 * invisible hang into a message someone can act on.
 */
const DEFAULT_TIMEOUT_MS = 20_000;
/** Uploads carry megabytes over mobile data, so they get considerably longer. */
const UPLOAD_TIMEOUT_MS = 90_000;

/** Combine our deadline with any caller-supplied signal. */
function deadline(ms: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!external) return timeout;
  // AbortSignal.any is recent; fall back to the deadline alone rather than
  // failing outright on an older browser.
  return AbortSignal.any?.([timeout, external]) ?? timeout;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const auth = loadToken();
  if (auth) headers['Authorization'] = `Bearer ${auth}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const limitMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.form
        ? { body: options.form }
        : options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      signal: deadline(limitMs, options.signal),
    });
  } catch (err) {
    // A timeout and an unreachable host are different problems with different
    // remedies, and they arrive here indistinguishably unless the reason is read.
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    if (timedOut) {
      throw new ApiError({
        code: 'network',
        status: 0,
        title: 'That took too long and was stopped',
        detail:
          `No answer within ${Math.round(limitMs / 1000)} seconds. Nothing was lost. ` +
          'On a slow connection a second attempt often works.',
        ours: true,
      });
    }
    // A blocked cross-origin request and a genuinely offline device both arrive
    // here as the same thrown TypeError - the browser deliberately does not say
    // which. Naming the address makes the difference diagnosable instead of
    // sending someone to check their wifi when the real cause is an origin the
    // API has not been told to allow.
    throw new ApiError({
      code: 'network',
      status: 0,
      title: 'Could not reach the API',
      detail: `Nothing was lost. No response from ${BASE || 'this address'}. The API may not be running.`,
      ours: true,
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const body = (payload ?? {}) as Record<string, unknown>;

    /**
     * Some failures never reach our code and so carry none of our error shape.
     *
     * A 413 is the one that matters: API Gateway refuses an oversized body before
     * Lambda is invoked, answers with its own `{"message":"Request Entity Too
     * Large"}`, and writes nothing to our logs. Falling through to the generic
     * branch produced "Something went wrong. The request did not complete." for
     * what is actually a specific, fixable condition.
     */
    if (res.status === 413) {
      throw new ApiError({
        code: 'invalid_request',
        status: 413,
        title: 'That photo was too large to send',
        detail:
          'The upload limit is around 4 MB. Nothing was lost - take the photo again and ' +
          'it will be reduced to fit before sending.',
        retake: true,
      });
    }
    // A gateway that is up but has no healthy function behind it, likewise.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      if (typeof body['code'] !== 'string') {
        throw new ApiError({
          code: 'internal',
          status: res.status,
          title: 'The server did not answer properly',
          detail: 'Nothing was lost. This is on our side. Trying again usually works.',
          ours: true,
        });
      }
    }

    throw new ApiError({
      code: (typeof body['code'] === 'string' ? body['code'] : 'internal') as ErrorCode,
      status: res.status,
      title: typeof body['title'] === 'string' ? body['title'] : 'Something went wrong',
      detail: typeof body['detail'] === 'string' ? body['detail'] : 'The request did not complete.',
      ...(typeof body['retake'] === 'boolean' ? { retake: body['retake'] } : {}),
      ...(typeof body['ours'] === 'boolean' ? { ours: body['ours'] } : {}),
    });
  }

  return payload as T;
}

// ------------------------------------------------------------------- shapes

export type Tier = 'hd' | 'sd';

export interface ScanSummary {
  id: string;
  status: 'draft' | 'uploading' | 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';
  tier: Tier;
  capturedAt: string;
  consentRequired: boolean;
  overallScore?: number | null;
  errorCode?: string | null;
  error?: ProviderError | null;
}

export interface ProviderError {
  title: string;
  detail: string;
  retake: boolean;
  ours: boolean;
}

export interface Reading {
  metric: string;
  region: string;
  rawScore: number | null;
  categoryValue: string | null;
}

export interface ScanDetail {
  scan: {
    id: string;
    capturedAt: string;
    tier: Tier;
    status: ScanSummary['status'];
    consentRequired: boolean;
    overallScore: number | null;
    skinAge: number | null;
  };
  error: ProviderError | null;
  quality: {
    /**
     * Whether the face-derived signals were measured or merely declared. Present
     * on the row all along and missing from this type, which meant the one screen
     * that could explain a capped confidence label had no way to read the field
     * that causes the cap.
     */
    source: 'camerakit' | 'declared';
    lightingLevel: number;
    lightingUneven: number;
    faceRatio: number;
    yaw: number;
    pitch: number;
    roll: number;
    shortSidePx: number;
    preset: string;
    declaredLight: string | null;
  } | null;
  photoUrl: string | null;
  readings: Reading[];
  masks: { metric: string; region: string; url: string }[];
  signedUrlTtlSeconds: number;
}

export interface Movement {
  metric: string;
  label: string;
  baseline: number | null;
  latest: number | null;
  delta: number | null;
}

export type Comparison =
  | { outcome: 'refused'; reason: string; title: string; detail: string }
  | { outcome: 'insufficient'; title: string; detail: string }
  | {
      outcome: 'comparison';
      label: string;
      labelId: string;
      rationale: string;
      provisional: true;
      daysApart: number;
      signals: { id: string; label: string; status: string; value: number }[];
      baselineScanId: string;
      latestScanId: string;
      tier: Tier;
      overall: { baseline: number | null; latest: number | null; delta: number | null };
      movements: Movement[];
    };

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  kind: string;
  startedOn: string | null;
  testing?: boolean;
}

export interface Trial {
  id: string;
  predictedMetric: string;
  kind: 'pre_registered' | 'exploratory';
  status: 'active' | 'completed' | 'stopped' | 'archived';
  startsAt: string;
  endsAt: string;
  cadenceDays: number;
  singleVariable: boolean;
  productName?: string;
  productBrand?: string | null;
  pooling?: { poolable: boolean; reason: string };
}

export interface Note {
  id: string;
  noteOn: string;
  body: string;
  tags: string[];
  scanId: string | null;
  /** Presigned, short-lived. The storage key never leaves the server. */
  photoUrl: string | null;
}

export interface CaptureMeta {
  capturedAt?: string;
  source?: 'camerakit' | 'declared';
  preset?: 'STRICT' | 'MODERATE' | 'RELAXED';
  lightingLevel: number;
  lightingUneven: number;
  faceRatio: number;
  yaw: number;
  pitch: number;
  roll: number;
  /**
   * Which signals were genuinely measured. Sent so the server can tell a real
   * reading of 0 from an absent one, and refrain from refusing a check-in on the
   * strength of a number nothing ever looked at.
   */
  measured?: readonly ('lighting' | 'framing' | 'pose')[];
  declaredLight?: string;
}

// -------------------------------------------------------------------- calls

export const api = {
  health: () =>
    request<{
      ok: boolean;
      mode: string;
      youcam: 'live' | 'fixture';
      auth: 'dev' | 'demo' | 'cognito';
    }>('/health'),

  /** Local sign-in. Only mounted when the API is in dev mode. */
  devToken: (email: string, authUid: string) =>
    request<{ token: string }>('/dev/token', {
      method: 'POST',
      body: { email, authUid },
    }),

  /**
   * Deployed sign-in: an access code in exchange for a session.
   *
   * This is what a reviewer uses. It exists because Cognito's own sender is rate
   * limited and SES starts sandboxed, so a verification email may not arrive at
   * all - and someone who cannot sign in cannot assess anything.
   */
  session: (email: string, code: string) =>
    request<{ token: string }>('/session', { method: 'POST', body: { email, code } }),

  account: () =>
    request<{
      profile: { id: string; email: string; displayName: string | null };
      entitlement: { entitlementId: string | null; isActive: boolean; expiresAt: string | null };
      privacy: { providerRetentionDays: number; resultUrlLifetimeHours: number };
    }>('/v1/account'),

  deleteAccount: () =>
    request<{ deleted: boolean; note: string }>('/v1/account', { method: 'DELETE' }),

  scans: () => request<{ scans: ScanSummary[] }>('/v1/scans'),

  scan: (id: string) => request<ScanDetail>(`/v1/scans/${id}`),

  createScan: (image: Blob, meta: CaptureMeta) => {
    const form = new FormData();
    form.set('image', image, 'check-in.jpg');
    form.set('meta', JSON.stringify(meta));
    return request<{
      scan: ScanSummary;
      consent: { required: boolean; policyVersion: string; providerRetentionDays: number };
    }>('/v1/scans', { method: 'POST', form, timeoutMs: UPLOAD_TIMEOUT_MS });
  },

  consent: (id: string) =>
    request<{ consented: boolean; policyVersion: string }>(`/v1/scans/${id}/consent`, {
      method: 'POST',
      body: { agree: true },
    }),

  analyse: (id: string) =>
    // Longer than the function's own 30 second timeout, deliberately. This call
    // uploads the photo to the provider and creates a task, and if the server is
    // going to give up we want its reason, not ours.
    request<{ scan: ScanSummary }>(`/v1/scans/${id}/analyse`, {
      method: 'POST',
      timeoutMs: 35_000,
    }),

  deleteScan: (id: string) =>
    request<{ deleted: boolean; note: string }>(`/v1/scans/${id}`, { method: 'DELETE' }),

  latestComparison: () => request<Comparison>('/v1/comparison/latest'),

  comparison: (baseline: string, latest: string) =>
    request<Comparison>(
      `/v1/comparison?baseline=${encodeURIComponent(baseline)}&latest=${encodeURIComponent(latest)}`,
    ),

  products: () => request<{ products: Product[] }>('/v1/products'),

  createProduct: (input: { name: string; brand?: string; kind?: string }) =>
    request<{ product: Product }>('/v1/products', { method: 'POST', body: input }),

  trials: (includeArchived = false) =>
    request<{ trials: Trial[]; archivedCount: number }>(
      `/v1/trials${includeArchived ? '?archived=true' : ''}`,
    ),

  trial: (id: string) =>
    request<{
      trial: Trial;
      pooling: { poolable: boolean; reason: string };
      checkIns: { id: string; capturedAt: string; overallScore: number | null }[];
      comparison: Comparison | null;
    }>(`/v1/trials/${id}`),

  createTrial: (input: {
    productId: string;
    predictedMetric: string;
    durationDays: number;
    cadenceDays?: number;
    /** Passing this marks the trial exploratory - the server decides, not us. */
    baselineScanId?: string;
  }) =>
    request<{ trial: Trial; pooling: { poolable: boolean; reason: string } }>('/v1/trials', {
      method: 'POST',
      body: input,
    }),

  setTrialStatus: (id: string, status: Trial['status']) =>
    request<{ trial: Trial; confirmed: string }>(`/v1/trials/${id}`, {
      method: 'PATCH',
      body: { status },
    }),

  /**
   * The diary's own entries. Optionally bounded to a window, which is what lets a
   * trial ask what else was going on during it rather than loading everything and
   * filtering on the client.
   */
  notes: (range?: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);
    const query = params.toString();
    return request<{ notes: Note[] }>(`/v1/notes${query ? `?${query}` : ''}`);
  },

  createNote: (input: { body: string; noteOn?: string; scanId?: string; tags?: string[] }) =>
    request<{ note: Note }>('/v1/notes', { method: 'POST', body: input }),

  // Both endpoints existed on the API from the start and had no client, which is
  // why an entry could be written and then never corrected or removed.
  updateNote: (id: string, input: { body?: string; noteOn?: string; tags?: string[] }) =>
    request<{ note: Note }>(`/v1/notes/${id}`, { method: 'PATCH', body: input }),

  deleteNote: (id: string) =>
    request<{ deleted: boolean }>(`/v1/notes/${id}`, { method: 'DELETE' }),

  /**
   * Stick a photo to an entry.
   *
   * Separate from createNote because most entries have no photo, and the upload
   * carries the same size ceiling as a check-in - the gateway refuses a body over
   * roughly 4 MB before our code runs, so the picker downscales first.
   */
  attachNotePhoto: (id: string, image: Blob) => {
    const form = new FormData();
    form.set('image', image, 'entry.jpg');
    return request<{ note: Note }>(`/v1/notes/${id}/photo`, {
      method: 'POST',
      form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
};
