/**
 * Trials.
 *
 * This is the part of the product that is not a skin scanner. A scanner tells you a
 * number. A trial makes you commit, in advance and in writing, to which metric you
 * expect a product to move and by when - and then holds you to it.
 *
 * The distinction the API draws and this screen surfaces:
 *
 *  - A pre-registered trial names its outcome before any evidence exists. Nothing
 *    can be reinterpreted afterwards, because the claim was fixed first.
 *  - An exploratory trial is one started from a check-in that already happened.
 *    The server decides which it is - passing a baseline scan id is what makes it
 *    exploratory - and it is labelled as such forever, because a hypothesis formed
 *    after seeing the data is a different kind of claim and pretending otherwise is
 *    how skincare marketing works.
 *
 * Single-variable is enforced by the database, not by advice: one active trial per
 * profile. Two products at once cannot produce an attributable result, so the app
 * declines to pretend it can rather than showing two trials and letting the user
 * draw a false conclusion.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FlaskConical, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { summariseConfounders, SURFACED_METRICS, type MetricId } from '@glowdays/core';

import { api, ApiError, type Trial } from '../lib/api.ts';
import { formatMovement, MetricIcon } from '../ui/metrics.tsx';
import {
  Advisory,
  Card,
  ConfidenceBadge,
  DeltaPill,
  Divider,
  Eyebrow,
  Headline,
  IconCircle,
  Lead,
  OutlineButton,
  Pill,
  PrimaryButton,
  Row,
  Screen,
  Section,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';

function Shell({ children, back }: { children: React.ReactNode; back: () => void }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <button type="button" onClick={back} aria-label="Back" className="self-start">
          <ChevronLeft className="text-ink size-6" />
        </button>
        <div className="mt-2 flex flex-1 flex-col">{children}</div>
      </div>
    </Screen>
  );
}

function metricLabel(id: string): string {
  return SURFACED_METRICS.find((m) => m.id === id)?.label ?? id;
}

function days(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------- list

export function Trials() {
  const navigate = useNavigate();
  const trials = useQuery({ queryKey: ['trials'], queryFn: () => api.trials(true) });
  const scans = useQuery({ queryKey: ['scans'], queryFn: api.scans });

  const list = trials.data?.trials ?? [];
  const active = list.filter((t) => t.status === 'active');
  const past = list.filter((t) => t.status !== 'active');
  const canStart = (scans.data?.scans ?? []).some((s) => s.status === 'succeeded');

  return (
    <Shell back={() => navigate('/today')}>
      <Eyebrow>Trials</Eyebrow>
      <div className="mt-4 flex flex-col gap-2">
        <Headline>What you have tested.</Headline>
        <Lead>
          A trial names the metric you expect to move before you start, so the answer cannot be
          rewritten afterwards.
        </Lead>
      </div>

      {active.length === 0 ? (
        <Section header="Nothing running">
          <Card>
            <span className="text-ink text-base font-medium">One product at a time.</span>
            <p className="text-ink-soft mt-2 text-base">
              Only one trial runs at once, deliberately. Two products started together cannot be
              told apart in the result, and a result you cannot attribute is not worth having.
            </p>
          </Card>
          {canStart ? (
            <PrimaryButton onClick={() => navigate('/trials/new')}>Start a trial</PrimaryButton>
          ) : (
            <Advisory>
              <span className="text-ink text-base">A trial needs a baseline first.</span>
              <span className="text-ink-soft text-sm">
                One completed check-in is enough to start from.
              </span>
            </Advisory>
          )}
        </Section>
      ) : null}

      {active.map((trial) => (
        <Section key={trial.id} header="Running now">
          <Card dominant>
            <TrialSummary trial={trial} />
            <div className="mt-4">
              <PrimaryButton onClick={() => navigate(`/trials/${trial.id}`)}>
                Open this trial
              </PrimaryButton>
            </div>
          </Card>
        </Section>
      ))}

      {past.length ? (
        <Section header="Finished and stopped">
          <Card>
            {past.map((trial, i) => (
              <div key={trial.id}>
                {i > 0 ? <Divider /> : null}
                <Row
                  icon={
                    <IconCircle tint="bg-neutral-pill">
                      <FlaskConical className="text-ink size-4" strokeWidth={1.5} />
                    </IconCircle>
                  }
                  title={trial.productName ?? 'Untitled'}
                  detail={`${metricLabel(trial.predictedMetric)} · ${trial.status} · ${
                    trial.kind === 'pre_registered' ? 'pre-registered' : 'exploratory'
                  }`}
                  onClick={() => navigate(`/trials/${trial.id}`)}
                />
              </div>
            ))}
          </Card>
        </Section>
      ) : null}

      <Spacer />
    </Shell>
  );
}

function TrialSummary({ trial }: { trial: Trial }) {
  const total = days(trial.startsAt, trial.endsAt);
  const elapsed = Math.min(total, days(trial.startsAt, new Date().toISOString()));
  return (
    <>
      <Eyebrow>{trial.kind === 'pre_registered' ? 'Pre-registered' : 'Exploratory'}</Eyebrow>
      <span className="font-serif text-ink mt-3 text-[26px] leading-tight">
        {trial.productName ?? 'Untitled'}
      </span>
      <p className="text-ink-soft mt-3 text-base">
        Predicting {metricLabel(trial.predictedMetric)} will move, over {total} days.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {/* A count of days, not a percentage bar. The trial is not "62% complete"
            in any meaningful sense - what matters is whether the window is open. */}
        <span className="text-ink tabular-nums text-sm">
          day {elapsed} of {total}
        </span>
        {trial.singleVariable ? (
          <span className="bg-sage rounded-full px-2.5 py-1">
            <span className="text-ink text-[11px] font-medium">single variable</span>
          </span>
        ) : null}
      </div>
    </>
  );
}

// -------------------------------------------------------------------- create

export function NewTrial() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const products = useQuery({ queryKey: ['products'], queryFn: api.products });
  const [productId, setProductId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [predicted, setPredicted] = useState<MetricId>('hydration');
  const [duration, setDuration] = useState(28);
  const [error, setError] = useState<string | null>(null);

  const addProduct = useMutation({
    mutationFn: (name: string) => api.createProduct({ name }),
    onSuccess: async (res) => {
      setProductId(res.product.id);
      setNewName('');
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not add.'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createTrial({
        productId: productId ?? '',
        predictedMetric: predicted,
        durationDays: duration,
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries();
      navigate(`/trials/${res.trial.id}`, { replace: true });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not start.'),
  });

  const list = products.data?.products ?? [];

  return (
    <Shell back={() => navigate('/trials')}>
      <Eyebrow>New trial</Eyebrow>
      <div className="mt-4 flex flex-col gap-2">
        <Headline>Commit to one prediction.</Headline>
        <Lead>
          Naming the metric now is what makes the result meaningful later. It is recorded before any
          evidence exists and cannot be changed afterwards.
        </Lead>
      </div>

      <Section header="Which product">
        {list.length ? (
          <div className="flex flex-wrap gap-2">
            {list.map((p) => (
              <Pill key={p.id} selected={productId === p.id} onClick={() => setProductId(p.id)}>
                {p.name}
              </Pill>
            ))}
          </div>
        ) : null}
        <Card>
          <label className="flex flex-col gap-2">
            <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
              Add one
            </span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="What is it called"
              className="text-ink border-line-strong border-0 border-b border-solid bg-transparent pb-2 text-base outline-none"
            />
          </label>
          <div className="mt-4">
            <OutlineButton
              onClick={() => newName.trim() && addProduct.mutate(newName.trim())}
            >
              {addProduct.isPending ? 'Adding…' : 'Add to my shelf'}
            </OutlineButton>
          </div>
        </Card>
      </Section>

      <Section header="What do you expect to move">
        <div className="flex flex-wrap gap-2">
          {SURFACED_METRICS.filter((m) => m.kind === 'score').map((m) => (
            <Pill
              key={m.id}
              selected={predicted === m.id}
              onClick={() => setPredicted(m.id)}
              icon={<MetricIcon id={m.id} />}
            >
              {m.label}
            </Pill>
          ))}
        </div>
        <p className="text-ink-soft text-sm">
          One metric, not several. Predicting everything is the same as predicting nothing: with
          enough metrics, one of them moves by chance.
        </p>
      </Section>

      <Section header="For how long">
        <div className="flex flex-wrap gap-2">
          {[14, 28, 56].map((d) => (
            <Pill key={d} selected={duration === d} onClick={() => setDuration(d)}>
              {d} days
            </Pill>
          ))}
        </div>
        <p className="text-ink-soft text-sm">
          Skin turnover takes weeks. A fortnight is the shortest window in which a change means
          anything, and 28 days is the usual claim period on a label.
        </p>
      </Section>

      {error ? (
        <div className="mt-6">
          <Advisory>
            <span className="text-ink text-base">{error}</span>
          </Advisory>
        </div>
      ) : null}

      <Spacer />

      <div className="mt-8 flex flex-col gap-3">
        <PrimaryButton
          onClick={() => create.mutate()}
          disabled={!productId || create.isPending}
        >
          {create.isPending ? 'Starting…' : 'Start this trial'}
        </PrimaryButton>
        {!productId ? (
          <span className="text-ink-soft text-center text-sm">Pick a product to continue.</span>
        ) : null}
      </div>
    </Shell>
  );
}

// -------------------------------------------------------------------- detail

export function TrialDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const trial = useQuery({ queryKey: ['trial', id], queryFn: () => api.trial(id) });

  const setStatus = useMutation({
    mutationFn: (status: Trial['status']) => api.setTrialStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not update.'),
  });

  if (trial.isPending) {
    return (
      <Shell back={() => navigate('/trials')}>
        <Lead>Opening this trial…</Lead>
      </Shell>
    );
  }

  if (trial.isError || !trial.data) {
    return (
      <Shell back={() => navigate('/trials')}>
        <Headline>This trial could not be opened.</Headline>
        <Spacer />
        <OutlineButton onClick={() => navigate('/trials')}>Back to trials</OutlineButton>
      </Shell>
    );
  }

  const { trial: t, pooling, checkIns, comparison } = trial.data;
  const predicted = t.predictedMetric;

  return (
    <Shell back={() => navigate('/trials')}>
      <Card dominant>
        <TrialSummary trial={t} />
      </Card>

      {/* The honest label. An exploratory trial is not a weaker version of a
          pre-registered one, it is a different claim, and it says so here. */}
      {t.kind === 'exploratory' ? (
        <div className="mt-6">
          <Advisory tone="lavender">
            <span className="text-ink text-base font-medium">
              This one started from a check-in that already existed.
            </span>
            <span className="text-ink-soft text-sm">
              The prediction was made after the baseline was taken, so it is recorded as
              exploratory. It still counts, and it is still yours, but it cannot claim the same
              thing as a prediction made in advance.
            </span>
          </Advisory>
        </div>
      ) : null}

      {/* Pooling. Whether this trial can be counted alongside others, and why not. */}
      {pooling && !pooling.poolable ? (
        <Section header="Counting this with others">
          <Card>
            <span className="text-ink text-base">Not pooled.</span>
            <p className="text-ink-soft mt-2 text-sm">{pooling.reason}</p>
          </Card>
        </Section>
      ) : null}

      <Section header={`Check-ins in this window`}>
        {checkIns.length === 0 ? (
          <Card>
            <span className="text-ink text-base">Nothing recorded inside the window yet.</span>
            <p className="text-ink-soft mt-2 text-sm">
              A trial needs a check-in at the start and one at the end. Anything in between is
              extra evidence, not a requirement.
            </p>
          </Card>
        ) : (
          <Card>
            {checkIns.map((c, i) => (
              <div key={c.id}>
                {i > 0 ? <Divider /> : null}
                <Row
                  title={new Date(c.capturedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                  })}
                  detail={c.overallScore !== null ? `overall ${c.overallScore.toFixed(1)}` : 'no score'}
                  onClick={() => navigate(`/check-in/${c.id}`)}
                />
              </div>
            ))}
          </Card>
        )}
      </Section>

      {/* The result, including the refusals. A refusal is an answer. */}
      <Section header="The verdict">
        {comparison === null ? (
          <Card>
            <span className="text-ink text-base">Not yet.</span>
            <p className="text-ink-soft mt-2 text-sm">
              Two comparable check-ins are needed before this can be answered.
            </p>
          </Card>
        ) : comparison.outcome === 'refused' || comparison.outcome === 'insufficient' ? (
          <Advisory>
            <span className="text-ink text-base font-medium">{comparison.title}</span>
            <span className="text-ink-soft text-sm">{comparison.detail}</span>
          </Advisory>
        ) : (
          <>
            <ConfidenceBadge label={comparison.label} />
            <Card>
              <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
                What you predicted
              </span>
              <div className="mt-4 flex items-center gap-4">
                <MetricIcon id={predicted as MetricId} />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-ink text-base">{metricLabel(predicted)}</span>
                  <span className="text-ink-soft tabular-nums text-sm">
                    {(() => {
                      const m = comparison.movements.find((x) => x.metric === predicted);
                      return m ? formatMovement(m.baseline, m.latest) : 'not measured';
                    })()}
                  </span>
                </span>
                <DeltaPill
                  delta={comparison.movements.find((x) => x.metric === predicted)?.delta ?? null}
                />
              </div>
            </Card>
            <p className="text-ink-soft text-sm">{comparison.rationale}</p>
            <p className="text-ink-soft text-sm">
              Provisional, and it stays provisional. {comparison.daysApart} days apart on one
              person is a personal observation, not a study, and no amount of check-ins turns it
              into one.
            </p>
          </>
        )}
      </Section>

      {/* What else was going on. This is the reason the diary collects stickers. */}
      <Confounders trial={t} />

      {error ? (
        <div className="mt-6">
          <Advisory>
            <span className="text-ink text-base">{error}</span>
          </Advisory>
        </div>
      ) : null}

      <Spacer />

      {t.status === 'active' ? (
        <div className="mt-10 flex flex-col gap-3">
          <OutlineButton onClick={() => setStatus.mutate('completed')}>
            Mark this trial finished
          </OutlineButton>
          {/* Stopping is not failing. Named that way on purpose. */}
          <TextButton tone="ink" onClick={() => setStatus.mutate('stopped')}>
            Stop early — the record is kept either way
          </TextButton>
        </div>
      ) : null}
    </Shell>
  );
}

/**
 * What else was going on during the trial window.
 *
 * This is the payoff for the diary's stickers, and it is the difference between a
 * verdict and a claim. A serum cannot be credited with a change across a fortnight
 * that also contained five bad nights, a sunburn and a second new product - and
 * without this panel the app would present the movement as though it could be.
 *
 * The framing is deliberately not a warning. Confounders are normal; lives contain
 * them. What would be wrong is not counting them, or counting them and then
 * reporting the verdict as if they were absent.
 *
 * An empty window is stated too. "Nothing logged" is genuinely different from
 * "nothing happened", and quietly showing a clean result for a window nobody
 * recorded would be the most flattering possible misreading.
 */
function Confounders({ trial }: { trial: Trial }) {
  const from = trial.startsAt.slice(0, 10);
  const to = trial.endsAt.slice(0, 10);
  const total = Math.max(1, days(trial.startsAt, trial.endsAt));

  // Fetched for the window rather than filtered on the client, so a long diary
  // does not have to travel to answer a question about a fortnight.
  const notes = useQuery({
    queryKey: ['notes', from, to],
    queryFn: () => api.notes({ from, to }),
  });

  const entries = notes.data?.notes ?? [];
  const summary = summariseConfounders(
    entries.map((n) => ({ noteOn: n.noteOn, tags: n.tags })),
    total,
  );

  if (notes.isPending) return null;

  return (
    <Section header="What else was going on">
      {entries.length === 0 ? (
        <Card>
          <span className="text-ink text-base">Nothing logged in this window.</span>
          <p className="text-ink-soft mt-2 text-sm">
            That is not the same as nothing happening. With no diary entries there is no way to tell
            whether something else moved this reading, so treat the verdict above as thinner than it
            looks.
          </p>
        </Card>
      ) : summary.counted.length === 0 ? (
        <Card tone="sage">
          <span className="text-ink text-base font-medium">A clean window.</span>
          <p className="text-ink-soft mt-2 text-sm">
            You logged {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} and none of them
            recorded something that moves a reading on its own. That makes this verdict about as
            attributable as a single-person trial gets.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <p className="text-ink text-base">
              You logged something that moves a reading on{' '}
              <span className="tabular-nums font-medium">{summary.daysAffected}</span> of{' '}
              <span className="tabular-nums">{total}</span> days.
            </p>
            <div className="mt-4 flex flex-col gap-3">
              {summary.counted.slice(0, 5).map(({ sticker: s, days: count }) => (
                <div key={s.id} className="flex items-start gap-3">
                  <span className="text-[18px] leading-none" aria-hidden>
                    {s.emoji}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-ink text-[15px]">
                      {s.label}
                      <span className="text-ink-soft tabular-nums"> · {count} day{count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="text-ink-soft text-xs">{s.because}</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <p className="text-ink-soft text-sm">
            None of this invalidates the reading. It is the context the reading sits in, and it is
            the honest reason this is called a provisional observation rather than a result.
          </p>
        </>
      )}
    </Section>
  );
}
