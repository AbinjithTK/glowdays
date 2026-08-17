/**
 * Onboarding.
 *
 * Four panels, and every one of them exists to prevent a specific
 * misunderstanding rather than to advertise a feature. A tour that lists what an
 * app can do is skipped; one that tells you how to get a usable measurement out of
 * it changes what people actually do on their first check-in, which is the only
 * onboarding that pays for itself here.
 *
 *  1. What this is. Someone arriving from any other skin app expects a score out of
 *     a hundred and a list of products to buy. Saying "a record, not a score" up
 *     front is cheaper than disappointing them on the Today screen.
 *  2. How to take a check-in that is worth comparing. This is the one panel with
 *     real instrumental value: light and framing decide whether two check-ins can
 *     be compared at all, and nobody guesses that unprompted.
 *  3. That it will sometimes refuse to answer. Without warning, a refusal reads as
 *     a bug or a broken photo. Framed in advance, it reads as the product being
 *     careful - which is the whole proposition.
 *  4. Where the photographs go. Said before the camera is ever opened, because
 *     consent obtained after someone has already taken a picture of their face is
 *     consent obtained too late to matter.
 *
 * Rendered inline by App rather than as a route redirect, deliberately. A guard that
 * redirects on a flag is one bad condition away from stranding every user outside
 * the app, and Skip is on every panel, so this can never become a wall. It is also
 * reachable again from the account screen, because the check-in guidance in panel two
 * is worth re-reading and burying it in a one-time flow wastes it.
 */

import { Camera, ChevronLeft, Lock, ScanFace, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
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

const ONBOARDED_KEY = 'glowdays.onboarded';

/** Per profile, so a shared browser does not skip onboarding for the next person. */
export function hasOnboarded(profileId: string): boolean {
  try {
    return localStorage.getItem(`${ONBOARDED_KEY}.${profileId}`) === '1';
  } catch {
    // Storage refused. Better to show onboarding again than to guess it was seen.
    return false;
  }
}

export function markOnboarded(profileId: string): void {
  try {
    localStorage.setItem(`${ONBOARDED_KEY}.${profileId}`, '1');
  } catch {
    // Only repetition is lost.
  }
}

interface Panel {
  readonly eyebrow: string;
  readonly headline: string;
  readonly lead: string;
  readonly Glyph: typeof Camera;
  readonly tint: string;
  readonly iconColour: string;
  /** Concrete, checkable statements. Never marketing lines. */
  readonly points: readonly string[];
}

const PANELS: readonly Panel[] = [
  {
    eyebrow: 'What this is',
    headline: 'A record, not a score.',
    lead:
      'Glowdays measures your skin over time and tells you whether something you tried actually changed anything.',
    Glyph: Sparkles,
    tint: 'bg-rose-soft',
    iconColour: 'text-rose',
    points: [
      'Readings come from Perfect Corp\u2019s YouCam skin analysis, from a photo you take.',
      'Nothing is ranked against other people, and nothing here sells you a product.',
      'Your first check-in is a baseline. Nothing is compared until there is a second.',
    ],
  },
  {
    eyebrow: 'Getting a usable check-in',
    headline: 'Same light, same spot.',
    lead:
      'Two photos of the same face in different conditions produce different numbers. This is the part that decides whether your check-ins can be compared at all.',
    Glyph: Camera,
    tint: 'bg-teal-soft',
    iconColour: 'text-teal',
    points: [
      'Bright, even light on your face. Not a window behind you.',
      'Straight on, filling the oval guide, mouth closed.',
      'The same place each time. A bathroom mirror in the morning is ideal.',
      'Your camera\u2019s resolution decides the level of detail available, and the app shows you what it measured.',
    ],
  },
  {
    eyebrow: 'When the answer is no',
    headline: 'It will sometimes refuse.',
    lead:
      'If two check-ins were not alike enough, Glowdays says so instead of reporting a difference it cannot stand behind.',
    Glyph: ScanFace,
    tint: 'bg-lavender',
    iconColour: 'text-violet',
    points: [
      'Every comparison carries a confidence label based on the light and framing it measured.',
      'A change is never coloured green or red. A metric moving down is not a failure.',
      'Log what else was going on \u2014 sleep, sun, a flight \u2014 and a verdict has to survive it.',
      'A refusal is an answer. It means the evidence was thin, not that you did something wrong.',
    ],
  },
  {
    eyebrow: 'Your photographs',
    headline: 'Private, and yours to delete.',
    lead:
      'This app holds pictures of your face. Here is exactly what happens to them, before you take the first one.',
    Glyph: Lock,
    tint: 'bg-sage',
    iconColour: 'text-moss',
    points: [
      'Stored in private storage. Never public, never in a feed, never used to train a model.',
      'A photo is sent for analysis only after you agree to it, one check-in at a time.',
      'The analyser keeps its own copy for up to 30 days, then removes it.',
      'Delete a check-in, or your whole account, whenever you like.',
    ],
  },
];

export function Onboarding({
  profileId,
  onDone,
  /** True when opened from the account screen rather than on first sign-in. */
  revisiting = false,
}: {
  profileId: string;
  onDone: () => void;
  revisiting?: boolean;
}) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);

  const panel = PANELS[index];
  if (!panel) return null;

  const last = index === PANELS.length - 1;

  function finish(then: 'check-in' | 'today') {
    markOnboarded(profileId);
    onDone();
    // replace, so Back does not land the user in a tour they have completed.
    navigate(then === 'check-in' ? '/check-in' : '/today', { replace: true });
  }

  const { Glyph } = panel;

  return (
    <Screen>
      <ScreenBody>
        <div className="flex items-center justify-between">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              aria-label="Back"
              className="self-start"
            >
              <ChevronLeft className="text-ink size-6" />
            </button>
          ) : (
            <span className="size-6" />
          )}

          {/* Position, as dots. Not a percentage: four panels is a countable
              number and a progress bar would imply a longer process. */}
          <div className="flex items-center gap-1.5" role="presentation">
            {PANELS.map((p, i) => (
              <span
                key={p.eyebrow}
                className={
                  i === index ? 'bg-rose h-1.5 w-5 rounded-full' : 'bg-line-strong size-1.5 rounded-full'
                }
                aria-hidden
              />
            ))}
          </div>

          {!revisiting ? (
            <button
              type="button"
              onClick={() => finish('today')}
              className="text-ink-soft text-sm"
            >
              Skip
            </button>
          ) : (
            <button type="button" onClick={() => finish('today')} className="text-ink-soft text-sm">
              Close
            </button>
          )}
        </div>

        <span className="sr-only" aria-live="polite">
          Step {index + 1} of {PANELS.length}: {panel.headline}
        </span>

        <div className="mt-10 flex flex-col gap-5">
          <span className={`flex size-14 items-center justify-center rounded-2xl ${panel.tint}`}>
            <Glyph className={`size-7 ${panel.iconColour}`} strokeWidth={1.5} aria-hidden />
          </span>

          <div className="flex flex-col gap-3">
            <Eyebrow>{panel.eyebrow}</Eyebrow>
            <Headline>{panel.headline}</Headline>
            <Lead>{panel.lead}</Lead>
          </div>
        </div>

        <div className="mt-8">
          <Card>
            <div className="flex flex-col gap-4">
              {panel.points.map((point) => (
                <div key={point} className="flex gap-3">
                  {/* A rule, not a tick. A tick implies something was completed. */}
                  <span className="bg-line-strong mt-2.5 h-px w-4 shrink-0" aria-hidden />
                  <span className="text-ink text-[15px]">{point}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Spacer />

        <div className="mt-10 flex flex-col gap-3">
          {last ? (
            <>
              <PrimaryButton onClick={() => finish('check-in')}>
                Take my first check-in
              </PrimaryButton>
              <TextButton tone="ink" onClick={() => finish('today')}>
                Look around first
              </TextButton>
            </>
          ) : (
            <PrimaryButton onClick={() => setIndex((i) => i + 1)}>Next</PrimaryButton>
          )}
        </div>
      </ScreenBody>
    </Screen>
  );
}
