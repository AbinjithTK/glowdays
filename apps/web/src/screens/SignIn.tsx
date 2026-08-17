/**
 * Getting in.
 *
 * Rebuilt as two steps, because the single form asked for an email and a shared
 * access code side by side and explained neither. That reads as a login wall for an
 * account you do not have, which is the fastest way to lose someone at the door.
 *
 * Patterns taken from sign-up flows that work:
 *
 *  - Lead with what you get, not with a field. Transit's account screen states the
 *    benefit and offers "what is this?" for the curious.
 *    https://mobbin.com/screens/4d3eaec9-84da-4c65-982f-f6a54eae39a6
 *  - Explain the code mechanism in the subtitle rather than letting a mystery field
 *    sit there. Udemy says plainly that a code is emailed for passwordless sign-up.
 *    https://mobbin.com/screens/28a2bc1c-b109-48cc-ab3a-3adb4bbfd088
 *  - Keep the code secondary and tucked below, the way Acorns treats a promo code,
 *    so it never looks like the main event.
 *    https://mobbin.com/screens/5233d95a-f41a-45cf-b8f6-77b61cae348d
 *  - One field per step, primary action disabled until it is valid, as in Gopuff.
 *    https://mobbin.com/screens/01f585f5-431b-44f8-bd5d-7d47d735f2d4
 *
 * Two things are deliberately honest rather than flattering. There is no
 * sign-up/log-in split, because in this build there genuinely is none: an email
 * creates a diary the first time and reopens the same one afterwards. Inventing two
 * buttons for one behaviour would be a lie that breaks the moment someone tries the
 * wrong one. And the access code is described as an invitation for the judging
 * period, which is what it is - not as a password the user chose.
 *
 * A `?code=` parameter is honoured so an invitation link fills the code in and
 * getting in is a single tap. It is prefilled, never auto-submitted: a form that
 * submits itself on load is impossible to recover from if it fails.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Info, Mail, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api, ApiError, setToken } from '../lib/api.ts';
import {
  Advisory,
  Card,
  Eyebrow,
  Headline,
  Lead,
  PrimaryButton,
  Screen,
  ScreenBody,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';

/** The last address used, so returning is one tap rather than retyping. */
const LAST_EMAIL_KEY = 'glowdays.lastEmail';

function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // Private browsing refuses storage. Only convenience is lost.
  }
}

/** Deliberately permissive. The server is the authority; this only gates a button. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function SignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(readLastEmail);
  const [code, setCode] = useState(params.get('code') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 });

  // No default. Guessing an auth mode meant the form once hid the code field and
  // posted to a development endpoint that does not exist in the deployed build.
  const mode = health.data?.auth ?? null;
  const needsCode = mode === 'demo';
  const ready = mode !== null;

  // An invitation link carries the code, so the email step is all that is left.
  const invited = Boolean(params.get('code'));
  useEffect(() => {
    if (invited && looksLikeEmail(email)) setStep('code');
  }, [invited, email]);

  const returning = readLastEmail() !== '' && readLastEmail() === email.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;

    // The email step never talks to the server; it only advances.
    if (needsCode && step === 'email') {
      if (!looksLikeEmail(email)) return;
      setError(null);
      setStep('code');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { token } = needsCode
        ? await api.session(email.trim(), code.trim())
        : // Locally the subject is derived from the address, so the same email
          // always reopens the same diary between reloads.
          await api.devToken(email.trim(), `dev:${email.trim().toLowerCase()}`);
      rememberEmail(email.trim());
      setToken(token);
      // Synchronous and before navigating. Awaiting a refetch here put a network
      // round trip between success and redirect, and a rejection in it left the
      // user on this screen already signed in.
      queryClient.clear();
      navigate('/today', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}. ${err.detail}`
          : 'Could not reach the API. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const onCodeStep = needsCode && step === 'code';

  return (
    <Screen>
      <ScreenBody>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          {onCodeStep ? (
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setError(null);
              }}
              aria-label="Back"
              className="self-start"
            >
              <ChevronLeft className="text-ink size-6" />
            </button>
          ) : null}

          <div className={onCodeStep ? 'mt-2' : ''}>
            <Eyebrow>Glowdays</Eyebrow>
          </div>

          {/* ------------------------------------------------------ step one */}

          {!onCodeStep ? (
            <>
              <div className="mt-4 flex flex-col gap-3">
                <Headline>Find out whether it actually worked.</Headline>
                <Lead>
                  A private skin diary that measures what changed, and tells you when the evidence
                  is too thin to say.
                </Lead>
              </div>

              <button
                type="button"
                onClick={() => setExplaining((v) => !v)}
                className="border-line-strong text-ink mt-6 flex items-center gap-2 self-start rounded-full border border-solid px-4 py-2"
              >
                <Info className="size-4" strokeWidth={1.5} aria-hidden />
                <span className="text-sm font-medium">What do I get?</span>
              </button>

              {explaining ? (
                <div className="mt-4">
                  <Card tone="lavender">
                    <div className="flex flex-col gap-3">
                      {[
                        'Photograph your face on a schedule you choose. Readings come from Perfect Corp\u2019s YouCam skin analysis.',
                        'Name one product and one metric you expect it to move, before you start.',
                        'Get a verdict with a confidence label \u2014 and a refusal when two check-ins were not alike enough to compare.',
                        'Log what else was going on. Sleep, sun, a flight. The verdict has to survive it.',
                      ].map((line) => (
                        <span key={line} className="text-ink text-[15px]">
                          {line}
                        </span>
                      ))}
                    </div>
                  </Card>
                </div>
              ) : null}

              <label className="mt-8 flex flex-col gap-2">
                <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
                  Your email
                </span>
                <span className="border-line-strong flex items-center gap-3 border-0 border-b border-solid pb-2">
                  <Mail className="text-ink-soft size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                  <input
                    type="email"
                    required
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="text-ink w-full bg-transparent text-base outline-none"
                  />
                </span>
                {/* There is one behaviour, so it is described as one rather than
                    split into a sign-up and a log-in that do the same thing. */}
                <span className="text-ink-soft text-sm">
                  {returning
                    ? 'Welcome back. This address reopens your diary.'
                    : 'New here? This address creates your diary. Returning? The same one reopens it.'}
                </span>
              </label>
            </>
          ) : (
            /* ---------------------------------------------------- step two */
            <>
              <div className="mt-4 flex flex-col gap-3">
                <Headline>{invited ? 'Your invitation is ready.' : 'One code to let you in.'}</Headline>
                <Lead>
                  {invited
                    ? 'The code came in with your link. Nothing to type.'
                    : 'This build is invitation-only while it is being judged, so there is no password to create and no verification email to wait for.'}
                </Lead>
              </div>

              <div className="bg-neutral-pill mt-6 flex items-center gap-3 self-start rounded-full px-4 py-2">
                <Mail className="text-ink-soft size-4" strokeWidth={1.5} aria-hidden />
                <span className="text-ink text-sm">{email}</span>
              </div>

              <label className="mt-8 flex flex-col gap-2">
                <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
                  Access code
                </span>
                <input
                  // `text`, not `password`. It is a shared invitation code, not a
                  // secret the user chose, and masking it only invites typos on a
                  // phone keyboard.
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Paste the code from your invite"
                  className="text-ink border-line-strong border-0 border-b border-solid bg-transparent pb-2 font-mono text-base outline-none"
                />
                <span className="text-ink-soft text-sm">
                  Your email decides which diary opens. The code only opens the door.
                </span>
              </label>
            </>
          )}

          {error ? (
            <div className="mt-6">
              <Advisory>
                <span className="text-ink text-base">{error}</span>
              </Advisory>
            </div>
          ) : null}

          <Spacer />

          <div className="mt-8 flex flex-col gap-4">
            {/* Said before anyone commits a photograph of their face, not after. */}
            <div className="bg-sage flex gap-3 rounded-2xl p-5">
              <ShieldCheck className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
              <div className="flex flex-col gap-2">
                <span className="text-ink text-base font-medium">Your photos stay private.</span>
                <span className="text-ink-soft text-sm">
                  Nothing is public, nothing is in a feed, and nothing trains a model. A photo is
                  only sent for analysis after you agree to it, one check-in at a time, and the
                  analyser removes its own copy within 30 days.
                </span>
              </div>
            </div>

            {health.data?.youcam === 'fixture' ? (
              <Advisory>
                <span className="text-ink text-base">
                  This build is running on generated sample scores, not live analysis.
                </span>
              </Advisory>
            ) : null}

            {health.isError ? (
              <Advisory>
                <span className="text-ink text-base">Could not reach the API.</span>
                <span className="text-ink-soft text-sm">
                  Nothing is wrong with your details. The service may still be starting up — give
                  it a moment and reload.
                </span>
              </Advisory>
            ) : null}

            <PrimaryButton
              type="submit"
              disabled={
                busy ||
                !ready ||
                (!onCodeStep && !looksLikeEmail(email)) ||
                (onCodeStep && code.trim().length === 0)
              }
            >
              {busy
                ? 'Opening your diary…'
                : !ready
                  ? 'Checking the connection…'
                  : onCodeStep
                    ? 'Open my diary'
                    : returning
                      ? 'Continue'
                      : 'Create my diary'}
            </PrimaryButton>

            {onCodeStep ? (
              <TextButton tone="ink" onClick={() => setStep('email')}>
                Use a different email
              </TextButton>
            ) : null}
          </div>
        </form>
      </ScreenBody>
    </Screen>
  );
}
