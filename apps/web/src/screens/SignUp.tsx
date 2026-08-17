/**
 * Create an account, backed by Neon Auth.
 *
 * One screen, three fields, no verification email. That last part is not a shortcut -
 * it is the reason this exists at all. Neon Auth is configured with email
 * verification off, so an account works the instant it is made, which removes the
 * failure mode that ruled out Cognito: its sender is rate limited and SES starts
 * sandboxed, so a verification email may never arrive, and a person who cannot get in
 * cannot use the product.
 *
 * The password rule is stated before it is enforced. A minimum revealed only by a
 * rejection is a rule the user had no way to follow.
 *
 * The browser posts to our own origin. It never contacts the auth service directly,
 * which keeps the request same-origin and means Better Auth's CSRF handling and the
 * auth host stay entirely on the server side of the boundary.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

/** Matches Better Auth's own floor, so the client and the server agree. */
const MIN_PASSWORD = 8;

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function SignUp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.signUp({
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    onSuccess: ({ token }) => {
      setToken(token);
      // Synchronous, and before navigating. Awaiting a refetch here would put a
      // network round trip between success and redirect, and a rejection in it would
      // leave a signed-in user staring at the sign-up form.
      queryClient.clear();
      navigate('/today', { replace: true });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message} ${err.detail}` : 'Could not sign up.'),
  });

  const ready = looksLikeEmail(email) && password.length >= MIN_PASSWORD;

  return (
    <Screen>
      <ScreenBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !create.isPending) create.mutate();
          }}
          className="flex flex-1 flex-col"
        >
          <button type="button" onClick={() => navigate('/')} aria-label="Back" className="self-start">
            <ChevronLeft className="text-ink size-6" />
          </button>

          <div className="mt-2">
            <Eyebrow>New diary</Eyebrow>
            <div className="mt-4 flex flex-col gap-2">
              <Headline>Make it yours.</Headline>
              <Lead>
                No verification email, no waiting. Your diary opens as soon as you finish
                this form.
              </Lead>
            </div>
          </div>

          <label className="mt-8 flex flex-col gap-2">
            <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
              Your name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Optional"
              className="text-ink border-line-strong border-0 border-b border-solid bg-transparent pb-2 text-base outline-none"
            />
          </label>

          <label className="mt-6 flex flex-col gap-2">
            <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
              Email
            </span>
            <input
              type="email"
              required
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="text-ink border-line-strong border-0 border-b border-solid bg-transparent pb-2 text-base outline-none"
            />
          </label>

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
                autoComplete="new-password"
                className="text-ink w-full bg-transparent text-base outline-none"
              />
              {/* A reveal toggle rather than a strength meter. It removes the actual
                  problem - typing a long password blind on a phone - where a meter
                  only comments on it. */}
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
            {/* Stated up front, not revealed by a rejection. */}
            <span className="text-ink-soft text-sm">
              At least {MIN_PASSWORD} characters.
              {password.length > 0 && password.length < MIN_PASSWORD
                ? ` ${MIN_PASSWORD - password.length} to go.`
                : ''}
            </span>
          </label>

          {error ? (
            <div className="mt-6">
              <Advisory>
                <span className="text-ink text-base">{error}</span>
              </Advisory>
            </div>
          ) : null}

          <Spacer />

          <div className="mt-8 flex flex-col gap-3">
            <p className="text-ink-soft text-sm">
              Your photographs stay in private storage and are only sent for analysis
              when you agree to it, one check-in at a time.
            </p>
            <PrimaryButton type="submit" disabled={!ready || create.isPending}>
              {create.isPending ? 'Creating your diary…' : 'Create my diary'}
            </PrimaryButton>
            <TextButton tone="ink" onClick={() => navigate('/sign-in')}>
              I already have a diary
            </TextButton>
          </div>
        </form>
      </ScreenBody>
    </Screen>
  );
}
