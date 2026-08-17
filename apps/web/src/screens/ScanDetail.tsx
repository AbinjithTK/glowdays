/**
 * One check-in, in full.
 *
 * This screen exists because everything the analyser returns was being stored and
 * none of it was being shown.
 *
 * Readings are grouped by metric and every region that arrived is listed. The
 * summary region is marked as the one used for comparison and the others are shown
 * as detail, because presenting eleven regions as eleven equal numbers would imply
 * they are all tracked against each other, which they are not.
 *
 * A note on what actually arrives, verified against the live API rather than assumed:
 * `hd_pore` is documented with four subcategories and `hd_wrinkle` with seven, but a
 * result requested as JSON returns one score per concern and no subcategories - those
 * live in `score_info.json` inside the ZIP result. So in the deployed build this
 * renders one row per metric and the region list is simply absent. That is why the
 * region block is conditional rather than assumed: the screen is correct whether or
 * not the breakdown is there, and it will populate the day the ZIP is read.
 *
 * It is also the screen that resolves an unfinished check-in. An analysis in flight
 * is polled here with the elapsed time visible and a way out, rather than a spinner
 * that says "Analysing" with no indication of whether it is stuck.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Clock, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { metric, SUMMARY_REGION, type MetricId } from '@glowdays/core';

import { api, ApiError, mediaUrl, type ScanDetail as Detail } from '../lib/api.ts';
import { formatScore, MetricIcon } from '../ui/metrics.tsx';
import {
  Advisory,
  Card,
  Divider,
  Eyebrow,
  Headline,
  Lead,
  OutlineButton,
  PrimaryButton,
  Screen,
  Section,
  Spacer,
  TextButton,
  ValuePill,
} from '../ui/primitives.tsx';

/** Region ids to words. The provider's own keys are not user-facing English. */
const REGION_WORDS: Record<string, string> = {
  whole: 'Overall',
  forehead: 'Forehead',
  nose: 'Nose',
  cheek: 'Cheeks',
  glabellar: 'Between the brows',
  crowfeet: 'Outer eyes',
  periocular: 'Around the eyes',
  nasolabial: 'Nose to mouth',
  marionette: 'Mouth to chin',
  t_zone: 'T-zone',
  u_zone: 'U-zone',
};

function regionWord(region: string): string {
  return REGION_WORDS[region] ?? region.replace(/_/g, ' ');
}

function metricLabel(id: string): string {
  try {
    return metric(id as MetricId).label;
  } catch {
    return id;
  }
}

export function ScanDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const scan = useQuery({
    queryKey: ['scan', id],
    queryFn: () => api.scan(id),
    // Polled only while work is genuinely in flight. A fixed interval on a
    // finished check-in would spend a request every two seconds forever, and each
    // of these calls presigns URLs on the server.
    refetchInterval: (query) => {
      const status = query.state.data?.scan.status;
      return status === 'running' || status === 'queued' || status === 'uploading' ? 2500 : false;
    },
    retry: 1,
  });

  const detail = scan.data;
  const status = detail?.scan.status;

  const consentAndAnalyse = useMutation({
    mutationFn: async () => {
      if (detail?.scan.consentRequired) await api.consent(id);
      await api.analyse(id);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['scan', id] }),
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not start.'),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteScan(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate('/diary', { replace: true });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not delete.'),
  });

  if (scan.isPending) {
    return (
      <Shell onBack={() => navigate(-1)}>
        <Lead>Opening this check-in…</Lead>
      </Shell>
    );
  }

  if (scan.isError || !detail) {
    return (
      <Shell onBack={() => navigate('/diary')}>
        <Headline>This check-in could not be opened.</Headline>
        <div className="mt-6">
          <Advisory>
            <span className="text-ink text-base">
              It may have been deleted, or it belongs to another account.
            </span>
          </Advisory>
        </div>
        <Spacer />
        <OutlineButton onClick={() => navigate('/diary')}>Back to the diary</OutlineButton>
      </Shell>
    );
  }

  const photo = mediaUrl(detail.photoUrl);
  const inFlight = status === 'running' || status === 'queued' || status === 'uploading';

  return (
    <Shell onBack={() => navigate('/diary')}>
      <Eyebrow>
        {new Date(detail.scan.capturedAt).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      </Eyebrow>

      <div className="mt-4">
        <Headline>
          {status === 'succeeded'
            ? 'Your readings.'
            : status === 'draft'
              ? 'Saved, not yet analysed.'
              : inFlight
                ? 'Analysis underway.'
                : 'This one did not complete.'}
        </Headline>
      </div>

      {photo ? (
        <div className="bg-plum mt-6 overflow-hidden rounded-2xl">
          <img
            src={photo}
            alt="Your check-in photo"
            className="aspect-[4/5] w-full object-cover"
          />
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-ink-soft text-sm">
          {detail.scan.tier === 'hd' ? 'High detail' : 'Standard detail'}
          {detail.quality ? ` · ${detail.quality.shortSidePx}px short side` : ''}
        </span>
        {detail.scan.overallScore !== null ? (
          <ValuePill>{formatScore(detail.scan.overallScore)} overall</ValuePill>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- draft */}

      {status === 'draft' ? (
        <Section header="Nothing has been sent">
          <Card tone="lavender">
            <div className="flex flex-col gap-4">
              {[
                'This photo is in your private storage and has not left it.',
                'Analysis sends it to Perfect Corp\u2019s YouCam skin analysis.',
                'The provider keeps its upload for up to 30 days, then removes it.',
              ].map((line) => (
                <div key={line} className="flex gap-3">
                  <ShieldCheck
                    className="text-ink mt-0.5 size-5 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <span className="text-ink text-base">{line}</span>
                </div>
              ))}
            </div>
          </Card>
          <PrimaryButton
            onClick={() => consentAndAnalyse.mutate()}
            disabled={consentAndAnalyse.isPending}
          >
            {consentAndAnalyse.isPending ? 'Starting…' : 'I agree, analyse this check-in'}
          </PrimaryButton>
        </Section>
      ) : null}

      {/* ------------------------------------------------------ in flight */}

      {inFlight ? <InFlight startedAt={detail.scan.capturedAt} /> : null}

      {/* --------------------------------------------------------- failed */}

      {status === 'failed' && detail.error ? (
        <Section header="What happened">
          <Advisory>
            <span className="text-ink text-base font-medium">{detail.error.title}</span>
            <span className="text-ink-soft text-sm">{detail.error.detail}</span>
          </Advisory>
          {detail.error.retake ? (
            <PrimaryButton onClick={() => navigate('/check-in')}>
              Take another photo
            </PrimaryButton>
          ) : (
            <PrimaryButton
              onClick={() => consentAndAnalyse.mutate()}
              disabled={consentAndAnalyse.isPending}
            >
              {consentAndAnalyse.isPending ? 'Trying again…' : 'Try the analysis again'}
            </PrimaryButton>
          )}
        </Section>
      ) : null}

      {/* ------------------------------------------------------- readings */}

      {detail.readings.length > 0 ? <Readings detail={detail} /> : null}

      {/* --------------------------------------------------------- masks */}

      {detail.masks.length > 0 ? <Masks detail={detail} /> : null}

      {/* -------------------------------------------------------- quality */}

      {detail.quality ? <Conditions detail={detail} /> : null}

      {error ? (
        <div className="mt-6">
          <Advisory>
            <span className="text-ink text-base">{error}</span>
          </Advisory>
        </div>
      ) : null}

      <Spacer />

      <div className="mt-10 flex flex-col gap-3">
        {confirmDelete ? (
          <>
            {/* Named consequences, not "are you sure". The provider's own copy is
                outside our control and saying otherwise would be a false promise. */}
            <Advisory>
              <span className="text-ink text-base font-medium">
                This removes the photo and every reading from it.
              </span>
              <span className="text-ink-soft text-sm">
                It cannot be undone, and any comparison built on it goes with it. The analysis
                provider removes its own copy within 30 days of upload, on its own schedule.
              </span>
            </Advisory>
            <PrimaryButton tone="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Delete this check-in'}
            </PrimaryButton>
            <TextButton tone="ink" onClick={() => setConfirmDelete(false)}>
              Keep it
            </TextButton>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-danger flex items-center justify-center gap-2 py-2 text-[15px]"
          >
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
            Delete this check-in
          </button>
        )}
      </div>
    </Shell>
  );
}

/**
 * Live status for work in flight.
 *
 * Elapsed time and named stages, never a percentage. A progress bar for work of
 * unknown duration is a guess presented as a fact, and the reported complaint was
 * exactly that: a screen saying "Analysing" for a long time with no way to tell a
 * slow analysis from a stuck one. Elapsed seconds distinguish the two without
 * inventing a number, and the note makes it clear that leaving is safe.
 */
function InFlight({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  const slow = seconds > 90;

  return (
    <Section header="In progress">
      <Card>
        <div className="flex items-center gap-3">
          <RefreshCw className="text-rose size-5 animate-spin" strokeWidth={1.5} aria-hidden />
          <span className="text-ink text-base">
            Sent to the analyser. Waiting for the readings.
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Clock className="text-ink-soft size-4" strokeWidth={1.5} aria-hidden />
          <span className="text-ink-soft tabular-nums text-sm">
            {seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`}
          </span>
        </div>
        <p className="text-ink-soft mt-4 text-sm">
          This page updates itself. You can leave and come back - the result will be here, and on
          Today.
        </p>
      </Card>

      {slow ? (
        <Advisory>
          <span className="text-ink text-base">This is taking longer than usual.</span>
          <span className="text-ink-soft text-sm">
            Nothing is lost. High-detail analysis of sixteen concerns is genuinely slow, and the
            result will still arrive. Coming back later is safe.
          </span>
        </Advisory>
      ) : null}
    </Section>
  );
}

/**
 * Readings, grouped by metric with every region.
 *
 * The summary region is labelled as the one comparisons use. That distinction is
 * the reason this is not just a list: the engine compares like with like on one
 * region, and showing eleven numbers as peers would imply all eleven are tracked,
 * which would be a claim the product does not make.
 */
function Readings({ detail }: { detail: Detail }) {
  const byMetric = new Map<string, Detail['readings']>();
  for (const reading of detail.readings) {
    const existing = byMetric.get(reading.metric);
    if (existing) existing.push(reading);
    else byMetric.set(reading.metric, [reading]);
  }

  return (
    <Section header={`${byMetric.size} metrics measured`}>
      {[...byMetric.entries()].map(([id, readings]) => {
        const summary = readings.find((r) => r.region === SUMMARY_REGION);
        const others = readings.filter((r) => r.region !== SUMMARY_REGION);
        return (
          <Card key={id}>
            <div className="flex items-center gap-4">
              <MetricIcon id={id as MetricId} />
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-ink text-base">{metricLabel(id)}</span>
                {others.length ? (
                  <span className="text-ink-soft text-sm">
                    {others.length} region{others.length === 1 ? '' : 's'} also measured
                  </span>
                ) : null}
              </span>
              {summary ? (
                <ValuePill>
                  {summary.rawScore !== null
                    ? formatScore(summary.rawScore)
                    : (summary.categoryValue ?? '—')}
                </ValuePill>
              ) : null}
            </div>

            {others.length ? (
              <div className="mt-4 flex flex-col">
                <Divider />
                {others.map((r) => (
                  <div key={r.region} className="flex items-center justify-between py-2.5">
                    <span className="text-ink-soft text-sm">{regionWord(r.region)}</span>
                    <span className="text-ink tabular-nums text-sm">
                      {r.rawScore !== null ? formatScore(r.rawScore) : (r.categoryValue ?? '—')}
                    </span>
                  </div>
                ))}
                <span className="text-ink-soft mt-2 text-xs">
                  Regions are recorded but not compared on their own. Comparison uses the overall
                  figure, so a like-for-like reading is always available.
                </span>
              </div>
            ) : null}
          </Card>
        );
      })}
    </Section>
  );
}

/** The analyser's own detection overlays, copied into our storage on arrival. */
function Masks({ detail }: { detail: Detail }) {
  return (
    <Section header="What the analyser marked">
      <p className="text-ink-soft -mt-2 text-sm">
        These overlays come from the analyser itself. They are copied into your storage on arrival,
        so they survive the provider deleting its own copy.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {detail.masks.slice(0, 8).map((mask) => {
          const url = mediaUrl(mask.url);
          return (
            <div key={`${mask.metric}-${mask.region}`} className="flex flex-col gap-2">
              <div className="bg-plum overflow-hidden rounded-xl">
                {url ? (
                  <img
                    src={url}
                    alt={`${metricLabel(mask.metric)} detection overlay`}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              <span className="text-ink-soft text-xs">
                {metricLabel(mask.metric)}
                {mask.region !== SUMMARY_REGION ? ` · ${regionWord(mask.region)}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * The capture conditions, shown because they are the input to confidence.
 *
 * Someone told that a comparison is only a directional check deserves to see why.
 * Unmeasured signals say so rather than showing zero, which would read as a
 * perfectly square-on head at identical distance - the strongest possible evidence
 * manufactured out of its own absence.
 */
function Conditions({ detail }: { detail: Detail }) {
  const q = detail.quality;
  if (!q) return null;
  const posed = q.source === 'camerakit';

  return (
    <Section header="Capture conditions">
      <Card>
        {[
          ['Light level', `${Math.round(q.lightingLevel * 100)}%`, true],
          ['Light evenness', `${Math.round((1 - q.lightingUneven) * 100)}%`, true],
          ['Face fills frame', posed ? `${Math.round(q.faceRatio * 100)}%` : 'not measured', posed],
          ['Head angle', posed ? `${q.yaw.toFixed(1)}° across` : 'not measured', posed],
        ].map(([label, value], i) => (
          <div key={String(label)}>
            {i > 0 ? <Divider /> : null}
            <div className="flex items-center justify-between py-3">
              <span className="text-ink-soft text-sm">{label}</span>
              <span className="text-ink tabular-nums text-sm">{value}</span>
            </div>
          </div>
        ))}
        <span className="text-ink-soft mt-3 text-xs">
          {posed
            ? 'All conditions were measured, so a comparison using this check-in can carry full confidence.'
            : 'This browser cannot measure framing or head angle. Those signals are left out of the confidence judgement rather than assumed, which caps any comparison using this check-in at a directional check.'}
        </span>
      </Card>
    </Section>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <Screen>
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        <button type="button" onClick={onBack} aria-label="Back" className="self-start">
          <ChevronLeft className="text-ink size-6" />
        </button>
        <div className="mt-2 flex flex-1 flex-col">{children}</div>
      </div>
    </Screen>
  );
}
