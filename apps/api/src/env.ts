/**
 * Validated configuration. The single place any secret enters the process.
 *
 * Every value is checked at boot so a misconfiguration fails immediately and
 * loudly rather than at the first request. When this moves to AWS, only the
 * source of these values changes - Secrets Manager or SSM instead of a file.
 *
 * Security notes:
 *  - YOUCAM_API_KEY is server-only and must never be sent to a client.
 *  - Nothing here is logged. `describeConfig()` redacts every secret.
 */

import { z } from 'zod';

const Mode = z.enum(['development', 'production', 'test']);

/** How the YouCam client behaves. `fixture` never spends API units. */
const YouCamMode = z.enum(['live', 'fixture']);

/**
 * Which token verifier the auth middleware uses.
 *
 * `cognito` is the real thing. `dev` mints a session for any identity with no
 * credentials and is refused in production. `demo` sits between them: the same
 * locally-signed tokens, but issued only in exchange for a shared access code,
 * so a deployed build can be handed to reviewers without standing up email
 * delivery first.
 *
 * `demo` exists because of a concrete trap. Cognito's built-in sender is rate
 * limited and SES starts sandboxed, so if verification email is not approved in
 * time a reviewer cannot complete a sign-up at all - they would be locked out of
 * the thing they are meant to score. A shared code has no such dependency.
 */
const AuthMode = z.enum(['cognito', 'dev', 'demo']);

/** Where scan images and masks are written. */
const StorageDriver = z.enum(['s3', 'local']);

const Schema = z
  .object({
    NODE_ENV: Mode.default('development'),
    PORT: z.coerce.number().int().positive().default(8787),

    /**
     * `postgres://…` for a real server, or `pglite://<dir>` for the embedded
     * WebAssembly build used in local development.
     */
    DATABASE_URL: z
      .string()
      .refine(
        (v) => v.startsWith('postgres://') || v.startsWith('postgresql://') || v.startsWith('pglite://'),
        { message: 'must start with postgres://, postgresql:// or pglite://' },
      )
      .describe('Postgres. Embedded locally, Neon or RDS later.'),

    // ---- YouCam / Perfect Corp ----
    YOUCAM_MODE: YouCamMode.default('fixture'),
    YOUCAM_API_KEY: z.string().min(20).optional(),
    YOUCAM_API_BASE: z.string().url().default('https://yce-api-01.makeupar.com'),
    /** Task version. v2.1 is current: newer engines, output up to 2560px. */
    YOUCAM_TASK_VERSION: z.enum(['v2.0', 'v2.1']).default('v2.1'),
    /**
     * How many concerns each analysis requests. Billing is banded by count:
     * eight HD concerns cost 16 units, all sixteen cost 22. `surfaced` asks for
     * the eight the UI shows and stretches the allocation from 45 scans to 62.
     * `all` buys the other eight, which can never be backfilled once the
     * provider deletes the upload at 30 days.
     */
    YOUCAM_CONCERN_SET: z.enum(['surfaced', 'all']).default('surfaced'),

    // ---- storage ----
    STORAGE_DRIVER: StorageDriver.default('local'),
    STORAGE_LOCAL_DIR: z.string().default('.storage'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    /** Set for S3-compatible endpoints. Leave unset for real AWS. */
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
    /** Presigned GET lifetime. Deliberately short - these are face photos. */
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    // ---- auth ----
    AUTH_MODE: AuthMode.default('dev'),
    COGNITO_REGION: z.string().optional(),
    COGNITO_USER_POOL_ID: z.string().optional(),
    COGNITO_CLIENT_ID: z.string().optional(),
    /** Signing secret for locally minted tokens, used by `dev` and `demo`. */
    DEV_AUTH_SECRET: z.string().min(16).optional(),
    /**
     * Shared code required to obtain a session in `demo` mode.
     *
     * Long minimum because this is the only thing standing between a public URL
     * and an account. Compared in constant time when checked.
     */
    DEMO_ACCESS_CODE: z.string().min(12).optional(),

    /** Comma-separated allowed origins for the browser client. */
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    /**
     * Built web app to serve, relative to the API's working directory.
     *
     * Serving the UI from the API puts everything on one origin and one port,
     * which is what lets a single HTTPS tunnel expose the whole product. Set to
     * an empty string to serve the API alone.
     */
    WEB_DIST_DIR: z.string().default('../web/dist'),

    /**
     * Mounts the /dev routes and relaxes CORS to private network addresses.
     *
     * This exists because NODE_ENV was the only thing standing between the
     * internet and an endpoint that mints a session for any account. NODE_ENV
     * defaults to `development`, so a deployment that simply forgot to set it
     * was fully exploitable - and a security control that fails open on a
     * missing variable is not a control.
     *
     * Defaults to false and is refused outright in production, so enabling it
     * now takes a deliberate act that cannot happen by omission.
     */
    ENABLE_DEV_ROUTES: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.YOUCAM_MODE === 'live' && !cfg.YOUCAM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['YOUCAM_API_KEY'],
        message: 'YOUCAM_MODE=live requires YOUCAM_API_KEY',
      });
    }
    if (cfg.STORAGE_DRIVER === 's3' && !cfg.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'STORAGE_DRIVER=s3 requires S3_BUCKET',
      });
    }
    if (cfg.AUTH_MODE === 'cognito') {
      for (const key of ['COGNITO_REGION', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID'] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `AUTH_MODE=cognito requires ${key}`,
          });
        }
      }
    }
    if ((cfg.AUTH_MODE === 'dev' || cfg.AUTH_MODE === 'demo') && !cfg.DEV_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_AUTH_SECRET'],
        message: `AUTH_MODE=${cfg.AUTH_MODE} requires DEV_AUTH_SECRET`,
      });
    }
    if (cfg.AUTH_MODE === 'demo' && !cfg.DEMO_ACCESS_CODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEMO_ACCESS_CODE'],
        message: 'AUTH_MODE=demo requires DEMO_ACCESS_CODE',
      });
    }
    // A misconfiguration that would ship a fake auth stub to real users.
    if (cfg.NODE_ENV === 'production' && cfg.AUTH_MODE === 'dev') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=dev is refused in production',
      });
    }
    // The embedded database is single-connection and in-process. Reaching
    // production with it would look like it worked until the second user.
    if (cfg.NODE_ENV === 'production' && cfg.DATABASE_URL.startsWith('pglite://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'The embedded database is refused in production. Use a real Postgres.',
      });
    }
    // The second, independent lock on the dev routes.
    if (cfg.NODE_ENV === 'production' && cfg.ENABLE_DEV_ROUTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENABLE_DEV_ROUTES'],
        message: 'ENABLE_DEV_ROUTES is refused in production',
      });
    }
    // Requiring TLS is left to the connection string, so a missing sslmode is
    // caught here rather than becoming an unencrypted link to RDS. Localhost is
    // exempt because there is no network to intercept.
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(cfg.DATABASE_URL);
    if (
      cfg.DATABASE_URL.startsWith('postgres') &&
      !isLocal &&
      !/sslmode=(require|verify-ca|verify-full)/.test(cfg.DATABASE_URL)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message:
          'A remote Postgres URL must set sslmode=require (or stricter). ' +
          'RDS and Neon both accept unencrypted connections silently otherwise.',
      });
    }
  });

export type Config = z.infer<typeof Schema>;

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

export function corsOrigins(): string[] {
  return config()
    .CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Loopback and the three private IPv4 ranges, on any port. */
const PRIVATE_HOST =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

/**
 * Decide whether a browser origin may call the API.
 *
 * In production this is the configured allowlist and nothing else. The API hands
 * out signed links to photographs of people's faces, so a wildcard is not an
 * option and never becomes one.
 *
 * With ENABLE_DEV_ROUTES it also accepts loopback and private LAN addresses on
 * any port, because the app has to be opened on a real phone to exercise the
 * camera and that phone reaches this machine on an address nobody can predict at
 * install time. The range is deliberately private-only: a public origin is still
 * refused, so a tunnelling service cannot quietly get access.
 *
 * Keyed on the explicit flag rather than NODE_ENV, so a deployment that forgets
 * to set NODE_ENV does not silently widen its own CORS policy.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (corsOrigins().includes(origin)) return true;
  if (!config().ENABLE_DEV_ROUTES) return false;
  return PRIVATE_HOST.test(origin);
}

/** Safe to log. Secrets are reduced to present/absent. */
export function describeConfig(): Record<string, string> {
  const c = config();
  const present = (v: unknown) => (v ? 'set' : 'unset');
  return {
    NODE_ENV: c.NODE_ENV,
    PORT: String(c.PORT),
    DATABASE_URL: present(c.DATABASE_URL),
    YOUCAM_MODE: c.YOUCAM_MODE,
    YOUCAM_API_KEY: present(c.YOUCAM_API_KEY),
    YOUCAM_TASK_VERSION: c.YOUCAM_TASK_VERSION,
    STORAGE_DRIVER: c.STORAGE_DRIVER,
    S3_BUCKET: present(c.S3_BUCKET),
    AUTH_MODE: c.AUTH_MODE,
    SIGNED_URL_TTL_SECONDS: String(c.SIGNED_URL_TTL_SECONDS),
  };
}
