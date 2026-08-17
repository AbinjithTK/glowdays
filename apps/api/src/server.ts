/**
 * HTTP entry point.
 *
 * Route layout mirrors the product rather than the database: check-ins,
 * comparisons, trials, shelf, diary, account. Everything under /v1 requires a
 * bearer token except the health check and the development helpers.
 *
 * CORS is an allowlist read from config, not a wildcard. The API returns signed
 * links to photographs of people's faces; `*` with credentials is not an option.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z, ZodError } from 'zod';

import { neonAuthEnabled, neonAuthPublicBaseUrl } from './auth/neon-auth.js';
import { mintDemoToken } from './auth/verify.js';

import { closeDb, db, initDb, isEmbedded } from './db/client.js';
import { config, describeConfig, isAllowedOrigin } from './env.js';
import { requireAuth, type AppEnv } from './http/context.js';
import { AppError, isApiPath, notFound, onError } from './http/problem.js';
import { accountRoute } from './routes/account.js';
import { authRoute } from './routes/auth.js';
import { devRoute } from './routes/dev.js';
import { joinRoute } from './routes/join.js';
import { mediaRoute } from './routes/media.js';
import { notesRoute } from './routes/notes.js';
import { productsRoute } from './routes/products.js';
import { scansRoute } from './routes/scans.js';
import { trialsRoute } from './routes/trials.js';
import { compareLatest, compareScans } from './services/comparison.js';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());

  /**
   * One line per request: method, path, status, duration.
   *
   * Added because its absence cost a whole debugging cycle. A check-in upload was
   * failing on a phone and CloudWatch showed nothing but cold starts, which was
   * read as "the request never arrives" - when in fact 4xx responses were being
   * returned and simply never written down, because only 5xx reaches console.error.
   * Without this there is no way to tell a request that failed from one that was
   * never made.
   *
   * Deliberately not a body logger. Every request here carries either a bearer
   * token or a photograph of someone's face, and neither belongs in a log group.
   * The query string is dropped for the same reason: it can hold scan
   * identifiers.
   */
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    const path = new URL(c.req.url).pathname;
    // Static asset hits would drown the useful lines and are not interesting
    // unless they fail.
    const noisy = path.startsWith('/assets/') || path === '/favicon.ico';
    if (!noisy || c.res.status >= 400) {
      console.log(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started}ms`);
    }
  });
  // Applied to every path rather than a list of prefixes. The origin function is
  // the security boundary here, not the route pattern, and scoping it by prefix
  // had already missed two: /dev, where the sign-in screen mints its token, and
  // /media, which is served at exactly that path so a /media/* pattern does not
  // match it.
  app.use(
    '*',
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  );

  // Zod failures are request problems, not server faults. Translated once here
  // so no route has to wrap its own parse call.
  app.onError((err, c) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return onError(
        new AppError('invalid_request', 'That request was not valid', {
          detail: first ? `${first.path.join('.') || 'body'}: ${first.message}` : err.message,
          extra: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        }),
        c,
      );
    }
    return onError(err, c);
  });
  app.notFound(notFound);

  /**
   * Liveness only. Deliberately does not touch the database, so a load balancer
   * does not recycle every task during a brief database blip.
   */
  app.get('/health', (c) => {
    const cfg = config();
    return c.json({
      ok: true,
      mode: cfg.NODE_ENV,
      youcam: cfg.YOUCAM_MODE,
      // Declared so the sign-in screen can render the right form rather than
      // hard-coding an endpoint that only exists in one deployment.
      auth: cfg.AUTH_MODE,
      /**
       * Whether real accounts are available. Reported separately from `auth`
       * because the two are independent: Neon Auth is additive, so a deployment can
       * offer both a shared access code and real sign-up at once, and the landing
       * page needs to know which doors to show.
       */
      accounts: neonAuthEnabled(),
      /**
       * Where the browser sends the Google round trip. Public - it is an endpoint,
       * not a credential - and reported rather than compiled into the client so the
       * same bundle works against any branch's auth service.
       */
      authBaseUrl: neonAuthPublicBaseUrl(),
    });
  });

  /**
   * Readiness. This one does query the database, and returns 503 when it cannot.
   *
   * The distinction matters on a load balancer: the previous single check
   * reported healthy from configuration alone, so a task whose database was
   * unreachable kept receiving traffic and answering every request with a 500.
   */
  app.get('/ready', async (c) => {
    try {
      // initDb rather than db(): under Lambda the connection is started in the
      // background and may not be open yet, and this endpoint exists to report
      // the truth about it rather than to assume it.
      const database = await initDb();
      await database.execute(sql`select 1`);
      return c.json({ ready: true });
    } catch (err) {
      console.error('[health] database unreachable:', err instanceof Error ? err.message : err);
      return c.json({ ready: false, reason: 'database_unreachable' }, 503);
    }
  });

  /**
   * Exchange an access code for a session. Unauthenticated by necessity - it is
   * how authentication starts - and only mounted when demo mode is configured.
   *
   * Deliberately not under /v1, which requires a token, and deliberately not the
   * same endpoint as the development one: /dev/token asks for no credentials at
   * all and must never be the thing exposed on a public URL.
   */
  if (config().AUTH_MODE === 'demo') {
    app.post('/session', async (c) => {
      const input = z
        .object({ code: z.string().min(1).max(200), email: z.string().min(3).max(200) })
        .parse(await c.req.json().catch(() => ({})));
      try {
        const token = await mintDemoToken(input);
        return c.json({ token, tokenType: 'Bearer' });
      } catch (err) {
        // A wrong code and an unknown account are the same answer from outside,
        // so neither can be used to enumerate the other.
        throw new AppError('unauthorised', err instanceof Error ? err.message : 'Sign-in failed', {
          detail: 'Check the access code and try again.',
        });
      }
    });
  }

  /**
   * Real accounts, when Neon Auth is configured. Registered before /auth so the
   * Cognito router cannot shadow it, and mounted conditionally so an environment
   * without Neon Auth exposes no endpoint that could only fail.
   */
  if (neonAuthEnabled()) {
    app.route('/join', joinRoute);
    console.log('[glowdays] Neon Auth is configured: real sign-up is available at /join');
  }

  app.route('/media', mediaRoute);

  // Unauthenticated by necessity: these are how a session is obtained. Rate
  // limited inside, and they refuse to operate unless AUTH_MODE is cognito.
  app.route('/auth', authRoute);

  // Mounted only when explicitly enabled. The handlers check again themselves,
  // so this is the outer of three locks rather than the only one.
  if (config().ENABLE_DEV_ROUTES) {
    app.route('/dev', devRoute);
    console.warn('[glowdays] /dev routes are ENABLED. Never set this outside development.');
  }

  const v1 = new Hono<AppEnv>();
  v1.use('*', requireAuth);

  v1.route('/scans', scansRoute);
  v1.route('/trials', trialsRoute);
  v1.route('/products', productsRoute);
  v1.route('/notes', notesRoute);
  v1.route('/account', accountRoute);

  /**
   * Comparisons. Two entry points, one engine.
   *
   * `/comparison/latest` is what the home screen asks for. The explicit pair
   * form exists so the diary can compare any two check-ins the user picks,
   * including two that the engine will refuse - the refusal is the answer, and
   * it needs a route to be reachable from.
   */
  v1.get('/comparison/latest', async (c) => {
    return c.json(await compareLatest(c.get('profileId')));
  });

  v1.get('/comparison', async (c) => {
    const baseline = c.req.query('baseline');
    const latest = c.req.query('latest');
    if (!baseline || !latest) {
      throw new AppError('invalid_request', 'Two check-ins are needed', {
        detail: 'Pass ?baseline=<scanId>&latest=<scanId>.',
      });
    }
    return c.json(await compareScans(c.get('profileId'), baseline, latest));
  });

  app.route('/v1', v1);

  /**
   * Serve the built web app, if there is one.
   *
   * This is what makes the whole product reachable on a single origin and a
   * single port, which matters for three reasons at once:
   *
   *  - The camera needs a secure context, so a phone needs HTTPS, so it needs a
   *    tunnel. A tunnel forwards one port. With the API and the UI on separate
   *    ports, tunnelling either one leaves the other unreachable.
   *  - Only compiled output is exposed. Tunnelling the dev server instead would
   *    publish the project root, and the project root holds .env.
   *  - It is the deployment topology, so development exercises the same thing
   *    that ships rather than a different one.
   *
   * Registered last so every API route wins the match first.
   */
  const webDist = config().WEB_DIST_DIR;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    /**
     * Asset filenames carry a content hash, so a given URL can never change
     * contents and may be cached indefinitely. The app shell must not be, and the
     * asymmetry is the whole point: index.html is the only file that names the
     * hashed bundles, so a cached shell surviving a redeploy would keep asking
     * for asset filenames that no longer exist in the artefact. The result is not
     * a stale app but a broken one - the HTML loads, every script 404s, and the
     * page renders with dead controls and no error.
     */
    app.use('/assets/*', async (c, next) => {
      await next();
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('/assets/*', serveStatic({ root: webDist }));

    /**
     * Keyed on the response content type rather than the path, because the shell
     * is reachable two different ways and setting the header in only one of them
     * is the bug this replaces: a request for `/` is answered by serveStatic
     * finding index.html on disk, so the fallback handler below never runs and
     * the directive was silently absent on the one URL everybody opens first.
     */
    app.use('/*', async (c, next) => {
      await next();
      if (c.res.headers.get('content-type')?.includes('text/html')) {
        c.header('Cache-Control', 'no-cache, must-revalidate');
      }
    });
    app.use('/*', serveStatic({ root: webDist }));
    // Client-side routes have no file on disk, so they fall through to the app
    // shell and let the router resolve them.
    app.get('*', (c) => {
      if (isApiPath(new URL(c.req.url).pathname)) return notFound(c);
      return c.html(readFileSync(join(webDist, 'index.html'), 'utf8'));
    });
    console.log(`[glowdays] serving the built web app from ${webDist}`);
  }

  return app;
}

// -------------------------------------------------------------------- boot

async function main(): Promise<void> {
  // Reading config first means a misconfiguration fails before a port is bound.
  const c = config();
  console.log('[glowdays] config', describeConfig());

  if (c.YOUCAM_MODE === 'fixture') {
    console.log(
      '[glowdays] YouCam is in fixture mode. No API units will be spent. ' +
        'Set YOUCAM_MODE=live with a key to call the real analyser.',
    );
  }
  if (isEmbedded(c.DATABASE_URL)) {
    console.log('[glowdays] embedded Postgres. Development only, single connection.');
  }

  // Connect before binding the port. Otherwise the first request races the
  // database into existence and fails for a reason that looks like a bug.
  await initDb();

  const server = serve({ fetch: createApp().fetch, port: c.PORT }, (info) => {
    console.log(`[glowdays] api listening on http://localhost:${info.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[glowdays] ${signal} received, closing`);
    server.close(() => {
      void closeDb().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only boot when run directly, so tests can import `createApp` without binding
// a port.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error('[glowdays] failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
