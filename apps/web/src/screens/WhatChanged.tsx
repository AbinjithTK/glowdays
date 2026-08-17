/**
 * What changed.
 *
 * The screen the product exists for, and the one most able to mislead, so the
 * three outcomes are rendered as genuinely different screens rather than one
 * screen with things greyed out.
 *
 * When the engine refuses, there are no numbers here at all. Not blurred, not
 * disabled, not shown with a warning - absent. A greyed-out figure still tells
 * you the figure, and the whole claim of this app is that it will not hand you
 * a number it cannot stand behind.
 *
 * The overall figure is the provider's own and is printed as received. It will
 * not equal the mean of the rows underneath, because the provider computes it
 * independently. Recomputing it to make the two agree is exactly the bug that
 * shipped in the prototype, where the headline delta was 1.8 times what the
 * visible metrics supported.
 */

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import type { MetricId } from '@glowdays/core';

import { api, type Comparison } from '../lib/api.ts';
import { formatMovement, MetricIcon } from '../ui/metrics.tsx';
import {
  Advisory,
  Card,
  ConfidenceBadge,
  DeltaPill,
  Divider,
  Eyebrow,
  Headline,
  Lead,
  OutlineButton,
  Row,
  RowGroup,
  Screen,
  ScreenBody,
  Section,
  Spacer,
} from '../ui/primitives.tsx';

export function WhatChanged() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['comparison', 'latest'],
    queryFn: api.latestComparison,
  });

  return (
    <Screen>
      <ScreenBody>
        <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="self-start">
          <ChevronLeft className="text-ink size-6" />
        </button>

        {isPending ? (
          <div className="mt-4">
            <Headline>Reading your check-ins.</Headline>
          </div>
        ) : isError ? (
          <div className="mt-4 flex flex-col gap-4">
            <Headline>That did not load.</Headline>
            <Lead>{error instanceof Error ? error.message : 'Try again in a moment.'}</Lead>
          </div>
        ) : (
          <Body comparison={data} />
        )}
      </ScreenBody>
    </Screen>
  );
}

function Body({ comparison }: { comparison: Comparison }) {
  if (comparison.outcome === 'refused') {
    return (
      <>
        <div className="mt-4 flex flex-col gap-2">
          <Eyebrow>Bookkeeping</Eyebrow>
          <Headline>{comparison.title}</Headline>
        </div>
        {/* Lavender, not caution. This is careful accounting, not an error. */}
        <div className="mt-8">
          <Advisory tone="lavender">
            <span className="text-ink text-base">{comparison.detail}</span>
            <span className="text-ink-soft text-sm">
              Both measurements are kept. It is only the subtraction that is refused.
            </span>
          </Advisory>
        </div>
        <Spacer />
        <div className="mt-8">
          <OutlineButton>How comparison works</OutlineButton>
        </div>
      </>
    );
  }

  if (comparison.outcome === 'insufficient') {
    return (
      <>
        <div className="mt-4 flex flex-col gap-2">
          <Headline>{comparison.title}</Headline>
          <Lead>{comparison.detail}</Lead>
        </div>
        <Spacer />
        <div className="mt-8">
          <OutlineButton>How comparison works</OutlineButton>
        </div>
      </>
    );
  }

  const headlineMovement = comparison.movements.find((m) => m.delta !== null) ?? null;
  const careNeeded = comparison.labelId !== 'comparable_capture';

  return (
    <>
      <div className="mt-4 flex flex-col gap-2">
        <Eyebrow>{`${comparison.daysApart} days apart`}</Eyebrow>
        <Headline>
          {careNeeded
            ? 'Treat this one with care.'
            : headlineMovement
              ? `${headlineMovement.label} moved ${(headlineMovement.delta ?? 0) > 0 ? 'up' : 'down'}.`
              : 'Nothing moved much.'}
        </Headline>
        {headlineMovement ? (
          <Lead>
            {`${headlineMovement.label} moved `}
            <span className="tabular-nums">
              {formatMovement(headlineMovement.baseline, headlineMovement.latest)}
            </span>
            .
          </Lead>
        ) : null}
      </div>

      <div className="mt-8">
        <Card dominant>
          <div className="flex items-center justify-between">
            <span className="text-ink tabular-nums text-base">
              {comparison.daysApart} days between check-ins
            </span>
          </div>
          <div className="mt-4">
            <ConfidenceBadge label={comparison.label} />
          </div>
          <p className="text-ink-soft mt-4 text-sm">{comparison.rationale}</p>
          {/* Stated on every comparison. The bands are starting values, not
              findings, until the repeat-measurement study runs. */}
          <p className="text-ink-soft mt-2 text-xs">
            Confidence thresholds are provisional while we measure the analyser's own
            repeat-measurement spread.
          </p>
        </Card>
      </div>

      {careNeeded ? (
        <div className="mt-5">
          <Advisory>
            <span className="text-ink text-base">
              The measurement is kept. It is the comparison that is less reliable.
            </span>
          </Advisory>
        </div>
      ) : null}

      {comparison.overall.baseline !== null && comparison.overall.latest !== null ? (
        <div className="mt-5 flex items-center justify-between px-1">
          <span className="text-ink tabular-nums text-base">
            Overall {comparison.overall.baseline.toFixed(1)} → {comparison.overall.latest.toFixed(1)}
          </span>
          <DeltaPill delta={comparison.overall.delta} />
        </div>
      ) : null}

      <Section header="Biggest movements">
        <Card>
          <RowGroup>
            {comparison.movements.slice(0, 3).map((m) => (
              <Row
                key={m.metric}
                icon={<MetricIcon id={m.metric as MetricId} />}
                title={m.label}
                detail={<span className="tabular-nums">{formatMovement(m.baseline, m.latest)}</span>}
                trailing={<DeltaPill delta={m.delta} />}
              />
            ))}
          </RowGroup>
        </Card>
        <Divider />
        <button type="button" className="flex w-full items-center justify-between">
          <span className="text-ink text-base">
            See all {comparison.movements.length} metrics
          </span>
        </button>
      </Section>

      <Spacer />

      <div className="mt-8">
        <OutlineButton>Add a note about this check-in</OutlineButton>
      </div>
    </>
  );
}
