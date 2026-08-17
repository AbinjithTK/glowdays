/**
 * Sign in.
 *
 * Two credentials reach the same place, and which one is offered first depends on what
 * the server reports rather than on a hard-coded assumption:
 *
 *  - A password, for a real Neon Auth account.
 *  - A shared access code, for a reviewer who should not have to invent a password in
 *    order to look at something.
 *
 * The access code is presented as what it is - an invitation for the judging period -
 * rather than hidden as a back door. A reviewer who cannot get in cannot assess
 * anything, and dressing that path up as something else reads worse than naming it.
 *
 * There is no sign-up/sign-in split for the code path, because for that path there
 * genuinely is none: an email plus the code opens a diary the first time and reopens
 * the same one afterwards. Inventing two buttons for one behaviour breaks the moment
 * someone picks the wrong one.
 *
 * The mode is never guessed. An earlier version defaulted to `dev` until /health
 * answered, which meant that for the first couple of seconds after a cold start the
 * form posted to an endpoint that does not exist in the deployed build.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { api, ApiError, setToken } from '../lib/api.ts';
import {
  Advisory,
  Eyebrow,
  Headline,
  Lead,
  PrimaryButton,
  Screen,
  ScreenBody,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';

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

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

type Method = 'password' | 'code';

export function SignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const [email, setEmail] = useState(readLastEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [reveal, setReveal] = useState(false);
  const [method, setMethod] = useState<Method | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 });

  const accounts = health.data?.accounts === true;
  const codeAvailable = health.data?.auth === 'demo';
  const ready = health.data !== undefined;

  /**
   * Choose the default method once, when the server has told us what exists. An
   * invitation link carrying ?code= is a direct instruction, so it wins.
   */
  useEffect(() => {
    if (!ready || method !== null) return;
    if (params.get('code') && codeAvailable) setMethod('code');
    else if (accounts) setMethod('password');
    else if (codeAvailable) setMethod('code');
  }, [ready, method, accounts, codeAvailable, params]);

  const usingCode = method === 'code';

  const canSubmit =
    ready &&
    method !== null &&
    looksLikeEmail(email) &&
    (usingCode ? code.trim().length > 0 : password.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy) return;

    setBusy(true);
    setError(null);
    try {
      const { token } = usingCode
        ? await api.session(email.trim(), code.trim())
        : await api.signIn({ email: email.trim(), password });
      rememberEmail(email.trim());
      setToken(token);
      queryClient.clear();
      navigate('/today', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}. ${err.detail}`
          : 'Could not reach the service. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenBody>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <button type="button" onClick={() => navigate('/')} aria-label="Back" className="self-start">
            <ChevronLeft className="text-ink size-6" />
          </button>

          <div className="mt-2">
            <Eyebrow>Glowdays</Eyebrow>
            <div className="mt-4 flex flex-col gap-2">
              <Headline>Welcome back.</Headline>
              <Lead>
                {usingCode
                  ? 'Your email decides which diary opens. The code only opens the door.'
                  : 'Sign in with the password you chose.'}
              </Lead>
            </div>
          </div>

          <label className="mt-8 flex flex-col gap-2">
            <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
              Email
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
          </label>

          {usingCode ? (
            <label className="mt-6 flex flex-col gap-2">
              <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
                Access code
              </span>
              <input
                // `text`, not `password`. It is a shared invitation code, not a secret
                // the user chose, and masking it only causes typos on a phone.
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
                Shared by invitation while this build is being judged. No password to
                create and no email to wait for.
              </span>
            </label>
          ) : (
            <label className="mt-6 flex flex-col gap-2">
              <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
                Password
              </span>
              <span className="border-line-strong flex items-center gap-3 border-0 border-b border-solid pb-2">
                <input
                  type={reveal ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="text-ink w-full bg-transparent text-base outline-none"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  className="text-ink-soft shrink-0"
                >
                  {reveal ? (
                    <EyeOff className="size-5" strokeWidth={1.5} aria-hidden />
                  ) : (
                    <Eye className="size-5" strokeWidth={1.5} aria-hidden />
                  )}
                </button>
              </span>
            </label>
          )}

          {error ? (
            <div className="mt-6">
              <Advisory>
                <span className="text-ink text-base">{error}</span>
              </Advisory>
            </div>
          ) : null}

          <Spacer />

          <div className="mt-8 flex flex-col gap-3">
            {health.isError ? (
              <Advisory>
                <span className="text-ink text-base">Could not reach the service.</span>
                <span className="text-ink-soft text-sm">
                  Nothing is wrong with your details. It may still be starting up — give
                  it a moment and reload.
                </span>
              </Advisory>
            ) : null}

            <PrimaryButton type="submit" disabled={!canSubmit || busy}>
              {busy ? 'Opening your diary…' : !ready ? 'Checking the connection…' : 'Open my diary'}
            </PrimaryButton>

            {/* Both doors, always reachable. Offered only when the server says the
                other one exists. */}
            {accounts && codeAvailable ? (
              <TextButton
                tone="ink"
                onClick={() => {
                  setError(null);
                  setMethod(usingCode ? 'password' : 'code');
                }}
              >
                {usingCode ? 'Use a password instead' : 'I have an access code instead'}
              </TextButton>
            ) : null}

            {accounts ? (
              <div className="flex items-center justify-center gap-1.5">
                <KeyRound className="text-ink-soft size-3.5" strokeWidth={1.5} aria-hidden />
                <TextButton onClick={() => navigate('/sign-up')}>
                  No diary yet? Create one
                </TextButton>
              </div>
            ) : null}
          </div>
        </form>
      </ScreenBody>
    </Screen>
  );
}
