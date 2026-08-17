/**
 * Sign up and sign in with a real account.
 *
 * Mounted at `/join` only when NEON_AUTH_BASE_URL is configured, so an environment
 * without it behaves exactly as before. Deliberately not under `/auth`, which is the
 * Cognito path, and deliberately not `/session`, which is the shared access code -
 * three different ways in, and conflating their routes would make it impossible to
 * tell from a log which one a caller used.
 *
 * Unauthenticated by necessity: this is where authentication starts.
 *
 * The password only ever travels browser -> our origin -> Neon Auth. It is never
 * stored, never logged, and never returned. Requests are rate limited per address
 * because an unauthenticated endpoint that validates passwords is a credential
 * stuffing target, and Better Auth's own limits are not ours to rely on.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { signIn, signUp, verifyNeonJwt } from '../auth/neon-auth.js';
import { AuthError, mintNeonToken } from '../auth/verify.js';
import { type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  /**
   * Eight is Better Auth's own floor. Enforced here too so the failure arrives
   * before a round trip, and phrased as guidance rather than a rejection.
   */
  password: z.string().min(8, 'Use at least eight characters').max(200),
  name: z.string().trim().min(1).max(80).optional(),
});

/**
 * A small fixed-window limiter, in memory.
 *
 * Per Lambda container rather than global, which is a real limitation and is stated
 * rather than glossed: a spread of concurrent containers each allow their own quota.
 * It still closes the cheap case - one client hammering one warm container - and the
 * honest fix is a shared counter, which is not worth a Redis dependency here.
 */
const ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function rateLimit(key: string): void {
  const now = Date.now();
  const entry = ATTEMPTS.get(key);

  if (!entry || entry.resetAt < now) {
    ATTEMPTS.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    throw new AppError('rate_limited', 'Too many attempts', {
      detail: 'Wait a minute and try again.',
    });
  }

  // Bounded, so a flood of distinct addresses cannot grow this map without limit.
  if (ATTEMPTS.size > 5_000) {
    for (const [k, v] of ATTEMPTS) if (v.resetAt < now) ATTEMPTS.delete(k);
  }
}

export const joinRoute = new Hono<AppEnv>();

joinRoute.post('/sign-up', async (c) => {
  const input = Credentials.parse(await c.req.json().catch(() => ({})));
  rateLimit(`up:${input.email}`);

  try {
    // Spread rather than passed whole: under exactOptionalPropertyTypes an optional
    // property that may be `undefined` is not assignable to one that may be absent.
    const user = await signUp({
      email: input.email,
      password: input.password,
      ...(input.name ? { name: input.name } : {}),
    });
    const token = await mintNeonToken({ userId: user.id, email: user.email, name: user.name });
    // 201: an account now exists that did not before.
    return c.json({ token, tokenType: 'Bearer', email: user.email }, 201);
  } catch (err) {
    throw new AppError('unauthorised', err instanceof AuthError ? err.message : 'Sign-up failed', {
      detail: 'Nothing was created. Check the details and try again.',
    });
  }
});

/**
 * Exchange a Neon Auth JWT for one of our sessions.
 *
 * This is how Google sign-in completes. The browser does the OAuth round trip against
 * the auth service, which leaves a session cookie on that service's own host - a host
 * our server cannot read a cookie from and the browser can only send one to. So the
 * browser fetches a short-lived JWT from there and posts it here.
 *
 * Unauthenticated by necessity, and safe to be: the token is verified against the key
 * set published by our own Neon branch, so an arbitrary caller cannot forge one. It is
 * also why the endpoint takes a JWT rather than a user id - a caller-supplied id would
 * let anyone name any account.
 */
joinRoute.post('/exchange', async (c) => {
  const input = z
    .object({ token: z.string().min(20).max(4000) })
    .parse(await c.req.json().catch(() => ({})));

  try {
    const user = await verifyNeonJwt(input.token);
    const token = await mintNeonToken({ userId: user.id, email: user.email, name: user.name });
    return c.json({ token, tokenType: 'Bearer', email: user.email });
  } catch (err) {
    throw new AppError('unauthorised', err instanceof AuthError ? err.message : 'Sign-in failed', {
      detail: 'Start the sign-in again.',
    });
  }
});

joinRoute.post('/sign-in', async (c) => {
  const input = Credentials.omit({ name: true }).parse(await c.req.json().catch(() => ({})));
  rateLimit(`in:${input.email}`);

  try {
    const user = await signIn(input);
    const token = await mintNeonToken({ userId: user.id, email: user.email, name: user.name });
    return c.json({ token, tokenType: 'Bearer', email: user.email });
  } catch (err) {
    // A wrong password and an unknown address give the same answer, so neither can
    // be used to discover which addresses have accounts.
    throw new AppError('unauthorised', 'That email and password do not match', {
      detail: err instanceof AuthError ? 'Check both and try again.' : 'Try again.',
    });
  }
});
