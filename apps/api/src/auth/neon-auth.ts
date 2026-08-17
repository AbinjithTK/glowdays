/**
 * Neon Auth, used as an identity provider.
 *
 * Neon Auth is Better Auth managed by Neon, deployed beside the Postgres compute.
 * It gives us real accounts - email and password, with Google OAuth available - and
 * a user table that branches with the database.
 *
 * Two findings from probing the live service shaped this file, both of which would
 * have cost a deploy cycle each if assumed:
 *
 *  1. **An Origin header is mandatory.** A request without one is refused outright:
 *     `MISSING_ORIGIN` on sign-up, `MISSING_OR_NULL_ORIGIN` on sign-in. That is
 *     Better Auth's CSRF protection, and it does not care that the caller is a
 *     server rather than a browser. So every call here sends one.
 *
 *  2. **The JWT it issues lasts fifteen minutes.** Verified from the claims: `exp`
 *     minus `iat` is 900. Handing that to the browser as the session would log
 *     people out mid-check-in, and refreshing it per request would add a
 *     cross-region round trip to every call. So Neon Auth answers "is this person
 *     who they say they are", and the session token stays ours.
 *
 * The browser never talks to this service. It posts to our own origin, which
 * removes CORS and keeps the auth host out of the page's network surface entirely.
 */

import { config } from '../env.js';

import { AuthError } from './verify.js';

export interface NeonUser {
  /** Better Auth user id, a UUID. Becomes `neon:<id>` in `profile.auth_uid`. */
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

export function neonAuthEnabled(): boolean {
  return Boolean(config().NEON_AUTH_BASE_URL);
}

function baseUrl(): string {
  const url = config().NEON_AUTH_BASE_URL;
  if (!url) throw new AuthError('Neon Auth is not configured');
  return url.replace(/\/+$/, '');
}

/**
 * The Origin we present to Better Auth.
 *
 * Derived from the auth base URL rather than from the incoming request. Forwarding
 * the browser's Origin would let a caller choose which origin we claim to be, and
 * the value is load-bearing: it is what the CSRF check and the redirect allowlist
 * are validated against.
 */
function originHeader(): string {
  const configured = config().CORS_ORIGINS?.split(',')[0]?.trim();
  if (configured) return configured;
  return new URL(baseUrl()).origin;
}

interface AuthResponse {
  token?: string;
  user?: { id?: string; email?: string; name?: string | null };
  message?: string;
  code?: string;
}

/** Map the service's own error codes onto something a person can act on. */
function present(status: number, body: AuthResponse): AuthError {
  switch (body.code) {
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return new AuthError('An account already exists for that email. Sign in instead.');
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
      return new AuthError('That email and password do not match.');
    case 'PASSWORD_TOO_SHORT':
      return new AuthError('That password is too short. Use at least eight characters.');
    case 'MISSING_ORIGIN':
    case 'MISSING_OR_NULL_ORIGIN':
      // Ours to fix, not the user's, so it must not read as their mistake.
      return new AuthError('Sign-in is misconfigured on our side. Nothing is wrong with your details.');
    default:
      return new AuthError(
        body.message && status < 500 ? body.message : 'Sign-in could not be completed.',
      );
  }
}

async function post(path: string, body: unknown): Promise<NeonUser> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Mandatory. See the note at the top of this file.
        Origin: originHeader(),
      },
      body: JSON.stringify(body),
      // The auth service is in us-east-2 and this function is in us-east-1, so a
      // slow call is plausible. A hung one must not hold the Lambda to its timeout.
      signal: AbortSignal.timeout(12_000),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new AuthError(
      timedOut
        ? 'The sign-in service did not respond in time. Nothing was lost - try again.'
        : 'The sign-in service could not be reached.',
    );
  }

  const text = await res.text();
  let payload: AuthResponse = {};
  try {
    payload = text ? (JSON.parse(text) as AuthResponse) : {};
  } catch {
    payload = {};
  }

  if (!res.ok) throw present(res.status, payload);

  const id = payload.user?.id;
  const email = payload.user?.email;
  if (!id || !email) {
    throw new AuthError('The sign-in service returned an unexpected response.');
  }

  return { id, email, name: payload.user?.name ?? null };
}

export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<NeonUser> {
  return post('/sign-up/email', {
    email: input.email,
    password: input.password,
    // Better Auth requires a name on sign-up. The local part of the address is a
    // better default than an empty string, which would render as a blank heading on
    // the account screen.
    name: input.name?.trim() || input.email.split('@')[0],
  });
}

export async function signIn(input: { email: string; password: string }): Promise<NeonUser> {
  return post('/sign-in/email', { email: input.email, password: input.password });
}
