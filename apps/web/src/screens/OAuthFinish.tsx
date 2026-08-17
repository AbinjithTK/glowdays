/**
 * Where Google sends you back.
 *
 * A real screen rather than an invisible redirect, because the work it does can fail and
 * a blank flash followed by the sign-in page would tell the user nothing about why.
 *
 * The path is `/oauth/finish` and not `/auth/callback` for a concrete reason: `/auth` is
 * on the API prefix list the server uses to decide what gets the SPA shell, so a client
 * route under it would have been answered with a 404 instead of the app.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../lib/api.ts';
import { completeGoogleSignIn, GoogleSignInError } from '../lib/google.ts';
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

export function OAuthFinish() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // React runs effects twice in development. Without this the token is exchanged
  // twice, and the second call fails on an already-consumed flow, replacing a
  // successful sign-in with an error.
  const started = useRef(false);

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 });
  const authBaseUrl = health.data?.authBaseUrl ?? null;

  useEffect(() => {
    if (!authBaseUrl || started.current) return;
    started.current = true;

    void (async () => {
      try {
        await completeGoogleSignIn(authBaseUrl);
        queryClient.clear();
        navigate('/today', { replace: true });
      } catch (err) {
        setError(
          err instanceof GoogleSignInError ? err.message : 'That sign-in could not be completed.',
        );
      }
    })();
  }, [authBaseUrl, navigate, queryClient]);

  return (
    <Screen>
      <ScreenBody>
        <Eyebrow>{error ? 'Sign-in' : 'Almost there'}</Eyebrow>

        <div className="mt-4 flex flex-col gap-2">
          <Headline>{error ? 'That did not finish.' : 'Finishing your sign-in…'}</Headline>
          <Lead>
            {error
              ? 'Nothing was lost, and no account was changed.'
              : 'Checking with Google and opening your diary.'}
          </Lead>
        </div>

        {error ? (
          <div className="mt-8">
            <Advisory>
              <span className="text-ink text-base">{error}</span>
            </Advisory>
          </div>
        ) : null}

        {health.isError ? (
          <div className="mt-8">
            <Advisory>
              <span className="text-ink text-base">Could not reach the service.</span>
              <span className="text-ink-soft text-sm">
                It may still be starting up. Reload in a moment.
              </span>
            </Advisory>
          </div>
        ) : null}

        <Spacer />

        {error ? (
          <div className="mt-8 flex flex-col gap-3">
            <PrimaryButton onClick={() => navigate('/sign-in', { replace: true })}>
              Sign in with an email instead
            </PrimaryButton>
            <TextButton tone="ink" onClick={() => navigate('/', { replace: true })}>
              Back to the start
            </TextButton>
          </div>
        ) : null}
      </ScreenBody>
    </Screen>
  );
}
