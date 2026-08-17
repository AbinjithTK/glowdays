/**
 * Sign-up, sign-in and refresh.
 *
 * Mounted outside the authenticated router, obviously, and rate limited per
 * address because these are the only unauthenticated endpoints that accept a
 * password. Without a limit, a Function URL is a free password-guessing oracle.
 *
 * In `dev` auth mode these return 404 rather than pretending to work. Two auth
 * systems half-wired together is how you end up with a build that signs people
 * in locally and rejects them in production for reasons nobody can trace.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { refresh, signIn, signUp } from '../auth/cognito.js';
import { config } from '../env.js';
import { AppError } from '../http/problem.js';

export const authRoute = new Hono();

function assertCognito(): void {
  if (config().AUTH_MODE !== 'cognito') {
    throw new AppError('not_found', 'Not available', {
      detail: 'This build signs in locally. Use the development token endpoint.',
    });
  }
}

/**
 * Fixed-window counter, in memory.
 *
 * Deliberately modest about what it is: per-instance, so concurrent Lambda
 * containers each get their own allowance, and it resets on a cold start. That
 * still removes the cheap case - thousands of guesses down one warm connection -
 * which is what an unprotected endpoint invites. A real limit belongs at the edge
 * with WAF, and Cognito applies its own per-account throttling underneath.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): void {
  const now = Date.now();
  const existing = attempts.get(key);

  if (!existing || existing.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic cleanup, so the map cannot grow without bound on a
    // long-lived container being probed with many addresses.
    if (attempts.size > 5_000) {
      for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
    }
    return;
  }

  existing.count += 1;
  if (existing.count > MAX_ATTEMPTS) {
    throw new AppError('rate_limited', 'Too many attempts', {
      detail: 'Wait a minute before trying again.',
    });
  }
}

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Only a floor is enforced here. The real policy lives on the user pool, so
  // duplicating it would mean two definitions that can disagree.
  password: z.string().min(10).max(256),
});

authRoute.post('/sign-up', async (c) => {
  assertCognito();
  const input = Credentials.parse(await c.req.json().catch(() => ({})));
  rateLimit(`signup:${input.email}`);

  await signUp(input.email, input.password);
  // Signed straight in. The pool auto-confirms, so there is no email to wait for
  // and making someone type their password twice would be theatre.
  const tokens = await signIn(input.email, input.password);

  return c.json(
    {
      token: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    },
    201,
  );
});

authRoute.post('/sign-in', async (c) => {
  assertCognito();
  const input = Credentials.parse(await c.req.json().catch(() => ({})));
  rateLimit(`signin:${input.email}`);

  const tokens = await signIn(input.email, input.password);
  return c.json({
    token: tokens.idToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

authRoute.post('/refresh', async (c) => {
  assertCognito();
  const input = z
    .object({ refreshToken: z.string().min(20).max(4096) })
    .parse(await c.req.json().catch(() => ({})));

  const tokens = await refresh(input.refreshToken);
  return c.json({
    token: tokens.idToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

/** Which sign-in the client should present, so it does not have to guess. */
authRoute.get('/mode', (c) =>
  c.json({
    mode: config().AUTH_MODE,
    // Stated so the client can skip a confirmation-code screen entirely.
    emailVerificationRequired: false,
  }),
);
