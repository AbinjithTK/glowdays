/**
 * Google sign-in, across a site boundary.
 *
 * The awkward part is not Google. It is that the Better Auth session lives as a cookie
 * on the auth service's own host, which is a different site from this app. Our server
 * cannot read that cookie and the browser will only ever send it back to that host. So
 * the sequence has to hand something portable across the boundary, and the portable
 * thing is a signed token:
 *
 *   1. Ask the auth service to start the round trip. It answers with a URL.
 *   2. Navigate there. Google authenticates, the auth service sets its own cookie and
 *      redirects back to `returnPath` on our origin.
 *   3. From that page, fetch a JWT from the auth service with `credentials: 'include'`.
 *      This is the step that needs cross-site cookies, and it works because the service
 *      returns our exact origin in `Access-Control-Allow-Origin` together with
 *      `Access-Control-Allow-Credentials: true` - both verified against the live
 *      service before any of this was written.
 *   4. Post that JWT to our own API, which verifies it against the service's published
 *      key set and mints a normal thirty-day session.
 *
 * Step 4 exists because the JWT lasts fifteen minutes. Using it directly as the session
 * would sign people out mid-check-in.
 *
 * Nothing here holds a Google client id or secret. The provider runs in Neon's shared
 * mode, so those live with Neon and never reach this app.
 */

import { api, ApiError, setToken } from './api.ts';

/** Where the auth service sends the browser back to. A real client-side route. */
export const OAUTH_RETURN_PATH = '/oauth/finish';

export class GoogleSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

/**
 * Begin the round trip. Returns nothing on success because the page navigates away.
 *
 * `credentials: 'include'` matters even here: without it the auth service cannot
 * associate the request with a pending flow, and the callback later fails in a way that
 * looks like Google refused rather than like a missing cookie.
 */
export async function startGoogleSignIn(authBaseUrl: string): Promise<void> {
  const origin = window.location.origin;

  let res: Response;
  try {
    res = await fetch(`${authBaseUrl.replace(/\/+$/, '')}/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        provider: 'google',
        callbackURL: `${origin}${OAUTH_RETURN_PATH}`,
        // Sent so a refusal lands back in the app with something to say, rather than
        // on the auth service's own error page with no way back.
        errorCallbackURL: `${origin}/sign-in?oauth=failed`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleSignInError('Could not reach the sign-in service. Nothing was changed.');
  }

  if (!res.ok) {
    throw new GoogleSignInError('Google sign-in could not be started. Try email instead.');
  }

  const body = (await res.json().catch(() => ({}))) as { url?: string; redirect?: boolean };
  if (!body.url) {
    throw new GoogleSignInError('The sign-in service did not return a destination.');
  }

  // assign rather than replace, so the browser Back button returns here rather than
  // skipping past the screen the user started from.
  window.location.assign(body.url);
}

/**
 * Finish the round trip: collect the JWT and trade it for a session.
 *
 * Runs on OAUTH_RETURN_PATH. A failure here is genuinely ambiguous from the browser's
 * side - a declined consent screen, an expired flow and a blocked third-party cookie all
 * arrive as an unauthenticated /token - so the message says what to do rather than
 * guessing which happened.
 */
export async function completeGoogleSignIn(authBaseUrl: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${authBaseUrl.replace(/\/+$/, '')}/token`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GoogleSignInError('Could not reach the sign-in service to finish signing in.');
  }

  if (!res.ok) {
    throw new GoogleSignInError(
      'That sign-in did not complete. This can happen if the window was closed, if it ' +
        'took too long, or if your browser is blocking cross-site cookies. Signing in ' +
        'with an email and password always works.',
    );
  }

  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!body.token) {
    throw new GoogleSignInError('The sign-in service did not return a token.');
  }

  try {
    const { token } = await api.exchangeAuthToken(body.token);
    setToken(token);
  } catch (err) {
    throw new GoogleSignInError(
      err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not finish signing in.',
    );
  }
}
