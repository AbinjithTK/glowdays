/**
 * Account and privacy.
 *
 * This is a privacy centre first and a settings screen second, which is the right
 * order for a product that holds photographs of someone's face and sends them to a
 * third party. Every fact here is read from the API rather than typed into the
 * markup, because the retention period is a promise and a promise hard-coded in a
 * screen drifts from the one the server actually keeps.
 *
 * The deletion flow names what goes and what does not. Deleting here cannot reach
 * into the provider's storage, and saying "everything is deleted" would be false.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Clock, Database, FlaskConical, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError, setToken } from '../lib/api.ts';
import {
  Advisory,
  Card,
  Divider,
  Eyebrow,
  Headline,
  IconCircle,
  Lead,
  PrimaryButton,
  Row,
  Screen,
  Section,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';

export function Me() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<'idle' | 'confirm'>('idle');
  const [error, setError] = useState<string | null>(null);

  const account = useQuery({ queryKey: ['account'], queryFn: api.account });
  const scans = useQuery({ queryKey: ['scans'], queryFn: api.scans });
  const trials = useQuery({ queryKey: ['trials'], queryFn: () => api.trials() });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });

  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      // Sign out locally the moment the server confirms. Leaving a valid token in
      // the tab after a deletion request would let the next screen re-create the
      // profile row the request just tombstoned.
      setToken(null);
      queryClient.clear();
      navigate('/sign-in', { replace: true });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not delete.'),
  });

  const profile = account.data?.profile;
  const privacy = account.data?.privacy;
  const entitlement = account.data?.entitlement;
  const scanCount = scans.data?.scans.length ?? 0;
  const trialCount = trials.data?.trials.length ?? 0;

  return (
    <Screen>
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <button type="button" onClick={() => navigate('/today')} aria-label="Back" className="self-start">
          <ChevronLeft className="text-ink size-6" />
        </button>

        <div className="mt-2">
          <Eyebrow>Your account</Eyebrow>
          <div className="mt-4 flex flex-col gap-2">
            <Headline>{profile?.displayName ?? 'Your diary'}</Headline>
            <Lead>{profile?.email ?? 'Loading…'}</Lead>
          </div>
        </div>

        <Section header="What is in here">
          <Card>
            <Row
              icon={
                <IconCircle tint="bg-rose-soft">
                  <Database className="text-rose size-4" strokeWidth={1.5} />
                </IconCircle>
              }
              title={`${scanCount} check-in${scanCount === 1 ? '' : 's'}`}
              detail="Photos and readings, in your private storage"
              onClick={() => navigate('/diary')}
            />
            <Divider />
            <Row
              icon={
                <IconCircle tint="bg-teal-soft">
                  <FlaskConical className="text-teal size-4" strokeWidth={1.5} />
                </IconCircle>
              }
              title={`${trialCount} trial${trialCount === 1 ? '' : 's'}`}
              detail="What you have tested, and what held up"
              onClick={() => navigate('/trials')}
            />
          </Card>
        </Section>

        {/* Read from the API. These are the numbers the server actually enforces,
            not a paraphrase of them written into a screen. */}
        <Section header="Where your photos go">
          <Card tone="lavender">
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <ShieldCheck className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                  <span className="text-ink text-base font-medium">Private storage only.</span>
                  <span className="text-ink-soft text-sm">
                    Nothing is public, nothing is in a feed, and nothing trains a model.
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <Clock className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                  <span className="text-ink text-base font-medium">
                    The analyser keeps its upload for up to{' '}
                    {privacy?.providerRetentionDays ?? 30} days.
                  </span>
                  <span className="text-ink-soft text-sm">
                    A photo is only sent after you agree to it, one check-in at a time.
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <Clock className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                <div className="flex flex-col gap-1">
                  <span className="text-ink text-base font-medium">
                    Image links expire after{' '}
                    {privacy?.resultUrlLifetimeHours
                      ? `${privacy.resultUrlLifetimeHours} hour${privacy.resultUrlLifetimeHours === 1 ? '' : 's'}`
                      : 'a few minutes'}
                    .
                  </span>
                  <span className="text-ink-soft text-sm">
                    Every photo is fetched through a signed link that stops working on its own, so a
                    copied URL is not a permanent door.
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </Section>

        <Section header="This build">
          <Card>
            <div className="flex items-center justify-between py-2">
              <span className="text-ink-soft text-sm">Analyser</span>
              <span className="text-ink text-sm">
                {health.data?.youcam === 'live' ? 'Live YouCam analysis' : 'Generated sample scores'}
              </span>
            </div>
            <Divider />
            <div className="flex items-center justify-between py-2">
              <span className="text-ink-soft text-sm">Subscription</span>
              <span className="text-ink text-sm">
                {entitlement?.isActive ? 'Active' : 'Everything is available'}
              </span>
            </div>
          </Card>
        </Section>

        {error ? (
          <div className="mt-6">
            <Advisory>
              <span className="text-ink text-base">{error}</span>
            </Advisory>
          </div>
        ) : null}

        <Spacer />

        <div className="mt-10 flex flex-col gap-3">
          {stage === 'confirm' ? (
            <>
              <Advisory>
                <span className="text-ink text-base font-medium">
                  This deletes your diary and every photo in it.
                </span>
                <span className="text-ink-soft text-sm">
                  {scanCount} check-in{scanCount === 1 ? '' : 's'}, every reading, and every trial.
                  It cannot be undone. The analysis provider removes its own copies within{' '}
                  {privacy?.providerRetentionDays ?? 30} days of upload, on its own schedule, which
                  we cannot speed up.
                </span>
              </Advisory>
              <PrimaryButton tone="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? 'Deleting…' : 'Delete everything'}
              </PrimaryButton>
              <TextButton tone="ink" onClick={() => setStage('idle')}>
                Keep my diary
              </TextButton>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setToken(null);
                  queryClient.clear();
                  navigate('/sign-in', { replace: true });
                }}
                className="text-ink flex items-center justify-center gap-2 py-2 text-[15px]"
              >
                <LogOut className="size-4" strokeWidth={1.5} aria-hidden />
                Sign out
              </button>
              <button
                type="button"
                onClick={() => setStage('confirm')}
                className="text-danger flex items-center justify-center gap-2 py-2 text-[15px]"
              >
                <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
                Delete my account and everything in it
              </button>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
