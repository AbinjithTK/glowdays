/**
 * Today.
 *
 * The canvas has five separate Today screens - no baseline, window open,
 * processing, result ready, lapsed. They are one screen in five states, and the
 * state is derived here from real data rather than chosen by a route. Building
 * them as five routes is how a prototype ends up with five copies of a card that
 * drift apart.
 *
 * The lapsed state carries a rule worth restating: no caution colour, and none
 * of the words overdue, missed, behind or lost. A diary that scolds you for a
 * gap is a diary you stop opening.
 */

import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api, type ScanSummary } from '../lib/api.ts';
import {
  Card,
  Eyebrow,
  IconCircle,
  PrimaryButton,
  Row,
  Screen,
  Section,
  Spacer,
} from '../ui/primitives.tsx';
import { TabBar } from '../ui/TabBar.tsx';

interface CardCopy {
  readonly eyebrow: string;
  readonly headline: string;
  readonly body: string;
  readonly action: string;
  readonly to: string;
}

function chooseState(scans: ScanSummary[], hasComparison: boolean): CardCopy {
  const succeeded = scans.filter((s) => s.status === 'succeeded');
  const inFlight = scans.find((s) => s.status === 'running' || s.status === 'queued' || s.status === 'uploading');
  const draft = scans.find((s) => s.status === 'draft');

  if (inFlight) {
    return {
      eyebrow: 'In progress',
      headline: 'Analysis underway.',
      body: 'You can close this. The result will be waiting here.',
      action: 'View status',
      to: `/check-in/${inFlight.id}`,
    };
  }
  if (draft) {
    return {
      eyebrow: 'Waiting on you',
      headline: 'One check-in is unfinished.',
      body: 'The photo is saved. It has not been sent anywhere, and it will not be until you agree.',
      action: 'Finish this check-in',
      to: `/check-in/${draft.id}`,
    };
  }
  if (hasComparison) {
    return {
      eyebrow: 'Ready to read',
      headline: 'Your comparison is ready.',
      body: 'Two check-ins that were similar enough to compare.',
      action: 'See what changed',
      to: '/what-changed',
    };
  }
  if (succeeded.length === 0) {
    return {
      eyebrow: 'First step',
      headline: 'Your baseline is waiting.',
      body: 'One clear photo starts the record. Nothing is compared until a later check-in.',
      action: 'Capture baseline',
      to: '/check-in',
    };
  }

  const latest = succeeded[0];
  const daysSince = latest
    ? Math.round((Date.now() - new Date(latest.capturedAt).getTime()) / 86_400_000)
    : 0;

  // Deliberately not a warning. A long gap is a fact, not a failure.
  if (daysSince > 21) {
    return {
      eyebrow: 'Still here',
      headline: 'Your diary is still here.',
      body: 'Nothing was lost. A new check-in continues the record whenever conditions feel right.',
      action: 'Check in',
      to: '/check-in',
    };
  }

  return {
    eyebrow: 'Your next entry',
    headline: 'Ready when you are.',
    body:
      'A check-in is worth keeping even when you are not testing anything. It becomes the ' +
      'baseline for whatever you try next.',
    action: 'Check in',
    to: '/check-in',
  };
}

export function Today() {
  const navigate = useNavigate();

  const scans = useQuery({ queryKey: ['scans'], queryFn: api.scans });
  const comparison = useQuery({ queryKey: ['comparison', 'latest'], queryFn: api.latestComparison });
  const trials = useQuery({ queryKey: ['trials'], queryFn: () => api.trials() });

  const list = scans.data?.scans ?? [];
  const succeeded = list.filter((s) => s.status === 'succeeded');
  const hasComparison = comparison.data?.outcome === 'comparison';
  const state = chooseState(list, hasComparison);
  const activeTrial = trials.data?.trials.find((t) => t.status === 'active') ?? null;

  const since = succeeded[succeeded.length - 1]?.capturedAt;
  const context = succeeded.length
    ? `${succeeded.length} check-in${succeeded.length === 1 ? '' : 's'}${
        since ? ` since ${formatDay(since)}` : ''
      }`
    : 'Nothing recorded yet';

  return (
    <Screen>
      <div className="flex flex-1 flex-col px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <Eyebrow>Glowdays</Eyebrow>
          <button
            type="button"
            onClick={() => navigate('/me')}
            aria-label="Your account"
            className="bg-rose-soft flex size-8 items-center justify-center rounded-full"
          >
            <span className="text-rose-deep text-xs font-medium">A</span>
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-1">
          <span className="text-ink text-base font-medium">Your diary</span>
          <span className="text-ink-soft tabular-nums text-sm">{context}</span>
        </div>

        {/* The trial is a chip, quieter than the card. A product name as the page
            title would make this a product tracker with a diary bolted on. */}
        {activeTrial ? (
          <button
            type="button"
            onClick={() => navigate(`/trials/${activeTrial.id}`)}
            className="bg-rose-soft mt-4 flex items-center gap-2 self-start rounded-full px-3 py-1.5"
          >
            <FlaskConical className="text-teal size-3.5" strokeWidth={1.5} aria-hidden />
            <span className="text-ink text-[13px]">
              Trial running · {activeTrial.productName ?? 'Untitled'}
            </span>
          </button>
        ) : null}

        {/* The one dominant card, and the only shadow on the screen. */}
        <div className="mt-8">
          <Card dominant>
            <Eyebrow>{state.eyebrow}</Eyebrow>
            <span className="font-serif text-ink mt-4 text-[28px] leading-tight">
              {state.headline}
            </span>
            <p className="text-ink-soft mt-4 text-base">{state.body}</p>
            <div className="mt-4">
              <PrimaryButton onClick={() => navigate(state.to)}>{state.action}</PrimaryButton>
            </div>
          </Card>
        </div>

        {!activeTrial && succeeded.length > 0 ? (
          <Section header="Want to test something">
            <Card>
              <Row
                icon={
                  <IconCircle tint="bg-teal-soft">
                    <FlaskConical className="text-teal size-4" strokeWidth={1.5} />
                  </IconCircle>
                }
                title="Start a trial"
                detail="Name one product, and the diary will tell you if it held up"
                onClick={() => navigate('/trials/new')}
              />
            </Card>
          </Section>
        ) : null}

        <Spacer />

        {succeeded[0] ? (
          <button
            type="button"
            onClick={() => navigate(`/check-in/${succeeded[0]?.id ?? ''}`)}
            className="mt-8 flex items-center justify-between px-1"
          >
            <span className="text-ink-soft text-sm">
              Last check-in {formatDay(succeeded[0].capturedAt)} ·{' '}
              {succeeded[0].tier === 'hd' ? 'high detail' : 'standard detail'}
            </span>
          </button>
        ) : null}
      </div>

      <TabBar resultReady={hasComparison} />
    </Screen>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
