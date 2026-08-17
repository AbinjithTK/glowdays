/**
 * YouCam (Perfect Corp) client.
 *
 * Three things here are not obvious and are the reason this file exists rather
 * than inline fetch calls.
 *
 * 1. The File API does not upload anything. It issues a destination. The bytes
 *    go in a second, mandatory PUT to a presigned URL using exactly the headers
 *    the provider returned. Skipping it fails later, at task creation, with an
 *    error that does not name the cause.
 *
 * 2. `enable_mask_overlay` stays false. True returns one pre-blended JPG, which
 *    would leave the photo/mask toggle in the UI with nothing to toggle between.
 *
 * 3. `format: 'json'` rather than the default zip. The zip needs an archive
 *    reader Node does not ship, and the JSON response carries the same scores
 *    plus mask URLs. The URLs live two hours, so masks are copied server-side
 *    on success rather than fetched when someone opens the viewer.
 *
 * Rate limit is 250 requests per 300 seconds, per IP and per token. Both must
 * hold, so calls pass through a shared limiter rather than trusting call sites.
 */

import { actionsForTier, estimateUnits, type ConcernSet, type Tier } from '@glowdays/core';

import { config } from '../env.js';
import { YouCamError } from './errors.js';
import { fixtureAnalysis } from './fixtures.js';

export type TaskResult =
  | { readonly status: 'running' }
  | { readonly status: 'success'; readonly payload: unknown }
  | { readonly status: 'error'; readonly code: string };

export interface UploadInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

export interface YouCamClient {
  readonly mode: 'live' | 'fixture';
  uploadImage(input: UploadInput): Promise<{ fileId: string }>;
  createSkinAnalysisTask(input: {
    fileId: string;
    tier: Tier;
    fromCameraKit: boolean;
  }): Promise<{ taskId: string }>;
  getTask(taskId: string): Promise<TaskResult>;
}

// ------------------------------------------------------------------ limiter

/**
 * Token bucket. The documented ceiling is 250 per 300 seconds and the
 * recommended pace is about 5 per second, so this sits below both.
 */
class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {
    this.tokens = capacity;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const limiter = new RateLimiter(8, 4);

// --------------------------------------------------------------------- live

interface ApiEnvelope {
  readonly status?: number;
  readonly error?: string;
  readonly error_code?: string;
  readonly message?: string;
  readonly data?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

class LiveYouCamClient implements YouCamClient {
  readonly mode = 'live' as const;

  private readonly base: string;
  private readonly key: string;
  private readonly version: string;
  private readonly concernSet: ConcernSet;

  constructor(opts: {
    base: string;
    apiKey: string;
    taskVersion: string;
    concernSet: ConcernSet;
  }) {
    this.base = opts.base.replace(/\/+$/, '');
    this.key = opts.apiKey;
    this.version = opts.taskVersion;
    this.concernSet = opts.concernSet;
  }

  private async request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    attempt = 0,
  ): Promise<ApiEnvelope> {
    await limiter.take();

    const res = await fetch(`${this.base}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });

    // 429 and 5xx are transient. Back off and retry a bounded number of times.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(waitMs);
      return this.request(path, init, attempt + 1);
    }

    const text = await res.text();
    let json: ApiEnvelope = {};
    try {
      json = text ? (JSON.parse(text) as ApiEnvelope) : {};
    } catch {
      throw new YouCamError(
        'unknown_internal_error',
        `Provider returned non-JSON (HTTP ${res.status})`,
        { httpStatus: res.status, retryable: res.status >= 500 },
      );
    }

    if (!res.ok) {
      const code = json.error_code ?? json.error ?? 'unknown_internal_error';
      throw new YouCamError(code, json.message ?? `Provider error (HTTP ${res.status})`, {
        httpStatus: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    return json;
  }

  async uploadImage(input: UploadInput): Promise<{ fileId: string }> {
    // Step 1: ask for a destination.
    const envelope = await this.request('/s2s/v2.0/file', {
      method: 'POST',
      body: {
        files: [
          {
            content_type: input.contentType,
            file_name: input.fileName,
            file_size: input.bytes.byteLength,
          },
        ],
      },
    });

    const data = asRecord(envelope.data);
    const files = data?.['files'];
    const first = Array.isArray(files) ? asRecord(files[0]) : null;
    const fileId = first?.['file_id'];
    const requests = first?.['requests'];
    const put = Array.isArray(requests) ? asRecord(requests[0]) : null;
    const url = put?.['url'];

    if (typeof fileId !== 'string' || typeof url !== 'string') {
      throw new YouCamError('unknown_internal_error', 'File API response missing file_id or url');
    }

    // Step 2: the actual upload. Use exactly the headers we were handed, with
    // Content-Length filled in - the provider signs against these.
    const headers: Record<string, string> = {};
    const given = asRecord(put?.['headers']);
    if (given) {
      for (const [k, v] of Object.entries(given)) {
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v) && typeof v[0] === 'string') headers[k] = v[0];
      }
    }
    headers['Content-Type'] ??= input.contentType;
    headers['Content-Length'] = String(input.bytes.byteLength);

    const uploaded = await fetch(url, {
      method: typeof put?.['method'] === 'string' ? (put['method'] as string) : 'PUT',
      headers,
      body: input.bytes,
      signal: AbortSignal.timeout(60_000),
    });

    if (!uploaded.ok) {
      throw new YouCamError('error_upload', `Upload PUT failed (HTTP ${uploaded.status})`, {
        httpStatus: uploaded.status,
        retryable: uploaded.status >= 500,
      });
    }

    return { fileId };
  }

  async createSkinAnalysisTask(input: {
    fileId: string;
    tier: Tier;
    fromCameraKit: boolean;
  }): Promise<{ taskId: string }> {
    const envelope = await this.request(`/s2s/${this.version}/task/skin-analysis`, {
      method: 'POST',
      body: {
        src_file_id: input.fileId,
        // Banded billing, so breadth is not free. See CONCERN_COST in core.
        dst_actions: actionsForTier(input.tier, this.concernSet),
        format: 'json',
        pf_camera_kit: input.fromCameraKit,
        miniserver_args: {
          // Separate mask layers. See the note at the top of this file.
          enable_mask_overlay: false,
        },
      },
    });

    const data = asRecord(envelope.data);
    const taskId = data?.['task_id'];
    if (typeof taskId !== 'string') {
      throw new YouCamError('unknown_internal_error', 'Task response missing task_id');
    }
    return { taskId };
  }

  async getTask(taskId: string): Promise<TaskResult> {
    const envelope = await this.request(
      `/s2s/${this.version}/task/skin-analysis/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
    );
    const data = asRecord(envelope.data);
    const status = data?.['task_status'];

    if (status === 'success') return { status: 'success', payload: data };
    if (status === 'error') {
      const code = data?.['error_code'] ?? data?.['error'] ?? 'unknown_internal_error';
      return { status: 'error', code: typeof code === 'string' ? code : 'unknown_internal_error' };
    }
    return { status: 'running' };
  }
}

// ------------------------------------------------------------------ fixture

/**
 * Fixture mode. Spends no API units.
 *
 * This exists because the free allocation is finite and a file watcher
 * restarting the server mid-development would otherwise burn it. Results are
 * derived deterministically from the file id, so the same scan always returns
 * the same scores and a demo is reproducible.
 */
class FixtureYouCamClient implements YouCamClient {
  readonly mode = 'fixture' as const;

  private readonly tiers = new Map<string, Tier>();

  // Mirrors the configured concern set, so fixture responses have the same
  // breadth a live call would. A fixture that always returned all sixteen would
  // hide the effect of the setting until real units were being spent.
  constructor(private readonly concernSet: ConcernSet) {}

  async uploadImage(input: UploadInput): Promise<{ fileId: string }> {
    const stamp = Date.now().toString(36);
    const size = input.bytes.byteLength.toString(36);
    return { fileId: `fixture-${stamp}-${size}` };
  }

  async createSkinAnalysisTask(input: {
    fileId: string;
    tier: Tier;
  }): Promise<{ taskId: string }> {
    const taskId = `fixture-task-${input.fileId}`;
    this.tiers.set(taskId, input.tier);
    return { taskId };
  }

  async getTask(taskId: string): Promise<TaskResult> {
    const tier = this.tiers.get(taskId) ?? 'hd';
    return {
      status: 'success',
      payload: fixtureAnalysis(taskId, tier, { concernSet: this.concernSet }),
    };
  }
}

// ------------------------------------------------------------------ factory

let cached: YouCamClient | null = null;

export function youcam(): YouCamClient {
  if (cached) return cached;
  const c = config();
  if (c.YOUCAM_MODE === 'live') {
    if (!c.YOUCAM_API_KEY) throw new Error('YOUCAM_API_KEY missing after validation');
    // Logged at boot so the burn rate is visible before units are spent rather
    // than discovered when the allocation runs out.
    console.log(
      `[youcam] live mode, ${c.YOUCAM_CONCERN_SET} concerns: ` +
        `${estimateUnits('hd', c.YOUCAM_CONCERN_SET)} units per HD scan, ` +
        `${estimateUnits('sd', c.YOUCAM_CONCERN_SET)} per SD scan`,
    );
    cached = new LiveYouCamClient({
      base: c.YOUCAM_API_BASE,
      apiKey: c.YOUCAM_API_KEY,
      taskVersion: c.YOUCAM_TASK_VERSION,
      concernSet: c.YOUCAM_CONCERN_SET,
    });
  } else {
    cached = new FixtureYouCamClient(c.YOUCAM_CONCERN_SET);
  }
  return cached;
}
