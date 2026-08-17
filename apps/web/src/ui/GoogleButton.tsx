/**
 * Continue with Google.
 *
 * One button shared by the landing page, sign-in and sign-up, because Google does not
 * distinguish between the two: the same round trip creates an account on first use and
 * signs you in afterwards. Labelling it "Sign up with Google" on one screen and "Sign in
 * with Google" on another would imply a choice that does not exist, and would strand
 * anyone who guessed wrong.
 *
 * Google's brand guidelines call for their mark on a white or light surface with a
 * visible border, the wordmark unmodified, and the icon not recoloured. The four-colour
 * mark is inlined as SVG rather than fetched, so it cannot fail to load and leave a
 * button that looks broken at the exact moment someone is deciding whether to trust it.
 */

import { useState } from 'react';

import { GoogleSignInError, startGoogleSignIn } from '../lib/google.ts';

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] shrink-0" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A8.99 8.99 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A8.99 8.99 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function GoogleButton({
  authBaseUrl,
  onError,
  tone = 'light',
}: {
  authBaseUrl: string;
  onError: (message: string) => void;
  /** `dark` for the plum hero on the landing page, `light` on a canvas screen. */
  tone?: 'light' | 'dark';
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    onError('');
    try {
      await startGoogleSignIn(authBaseUrl);
      // On success the page navigates away, so `busy` is never cleared. Deliberate:
      // clearing it would flash the button back to its idle state during the redirect
      // and invite a second click that starts a competing flow.
    } catch (err) {
      setBusy(false);
      onError(
        err instanceof GoogleSignInError ? err.message : 'Google sign-in could not be started.',
      );
    }
  }

  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      className={[
        'flex h-13 w-full items-center justify-center gap-3 rounded-xl border border-solid text-base font-medium',
        // A visible border on both tones. Google's mark needs a light surface, and a
        // borderless white block on white canvas would have no discernible edge - the
        // same 3:1 boundary rule that applies to every other control here.
        tone === 'dark' ? 'bg-white border-white text-ink' : 'bg-paper border-line-strong text-ink',
        busy && 'opacity-70',
      ].join(' ')}
    >
      <GoogleMark />
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  );
}
