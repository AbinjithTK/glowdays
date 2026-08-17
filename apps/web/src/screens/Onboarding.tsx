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
 *
 * Motion, and why it is what it is:
 *
 *  - Panels are advanced by a button, not dragged. There is no gesture velocity to
 *    hand off, so a tuned curve is the correct tool and a spring would only add
 *    bounce nobody asked for. Curves and durations live as tokens in index.css.
 *  - The panel change is directional: forward arrives from the right, back arrives
 *    from the left. Four panels are one strip being walked, and a transition that
 *    looks the same in both directions throws away the only cheap way to say so.
 *  - The points stagger 36ms apart. This screen is read, not admired, so the last
 *    one has landed by 288ms and nothing blocks a tap while it plays.
 *  - Press feedback is on pointerdown, on every control. See ui/press.ts.
 */

import {
  Aperture,
  ArrowUpDown,
  CalendarClock,
  Camera,
  ChevronLeft,
  Flag,
  FolderLock,
  Gauge,
  Hand,
  Handshake,
  Lock,
  MapPin,
  NotebookPen,
  Scale,
  ScanFace,
  ScanLine,
  Sparkles,
  Sun,
  Trash2,
  UserX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Card,
  Eyebrow,
  Headline,
  IconCircle,
  Lead,
  PrimaryButton,
  Screen,
  ScreenBody,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';
import { usePress } from '../ui/press.ts';

const ONBOARDED_KEY = 'glowdays.onboarded';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

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

/**
 * A point, and the icon that indexes it.
 *
 * The icon names the *subject* of the sentence - the light, the place, the notebook,
 * the lock, the calendar, the bin - and never grades it. That rule is what makes one
 * icon per point defensible rather than decorative: there is no icon here that could
 * be swapped for another without the row meaning something different, and no repeat
 * across the screen, because a repeated icon tells the eye two statements are the
 * same kind of thing.
 *
 * A tick was the obvious alternative and it is wrong for the same reason the em-dash
 * rule this replaces was better than a tick: a tick claims something was completed,
 * and these are statements about how the product behaves, not a checklist the user
 * has worked through. A single repeated glyph would have been an em-dash with extra
 * steps.
 */
interface Point {
  readonly Icon: typeof Camera;
  readonly text: string;
}

interface Panel {
  readonly eyebrow: string;
  readonly headline: string;
  readonly lead: string;
  readonly Glyph: typeof Camera;
  readonly tint: string;
  readonly iconColour: string;
  /** Concrete, checkable statements. Never marketing lines. */
  readonly points: readonly Point[];
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
      {
        // The reading is a pass over a photograph, not an opinion about you.
        Icon: ScanLine,
        text: 'Readings come from Perfect Corp\u2019s YouCam skin analysis, from a photo you take.',
      },
      {
        // The subject of the sentence is other people, and they are excluded.
        Icon: UserX,
        text: 'Nothing is ranked against other people, and nothing here sells you a product.',
      },
      {
        // A baseline is a marker you plant and later measure from.
        Icon: Flag,
        text: 'Your first check-in is a baseline. Nothing is compared until there is a second.',
      },
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
      { Icon: Sun, text: 'Bright, even light on your face. Not a window behind you.' },
      {
        // Literally the oval framing guide the capture screen draws.
        Icon: ScanFace,
        text: 'Straight on, filling the oval guide, mouth closed.',
      },
      { Icon: MapPin, text: 'The same place each time. A bathroom mirror in the morning is ideal.' },
      {
        // The camera itself, not the photo: this point is about hardware.
        Icon: Aperture,
        text: 'Your camera\u2019s resolution decides the level of detail available, and the app shows you what it measured.',
      },
    ],
  },
  {
    eyebrow: 'When the answer is no',
    headline: 'It will sometimes refuse.',
    // Scales, not a face scan: this panel is about weighing evidence, and the face
    // scan glyph belongs to the framing point on the panel before it.
    Glyph: Scale,
    lead:
      'If two check-ins were not alike enough, Glowdays says so instead of reporting a difference it cannot stand behind.',
    tint: 'bg-lavender',
    iconColour: 'text-violet',
    points: [
      {
        // A confidence label is a reading off a dial, not a verdict.
        Icon: Gauge,
        text: 'Every comparison carries a confidence label based on the light and framing it measured.',
      },
      {
        // Direction with no colour and no winner, which is exactly the claim.
        Icon: ArrowUpDown,
        text: 'A change is never coloured green or red. A metric moving down is not a failure.',
      },
      {
        Icon: NotebookPen,
        text: 'Log what else was going on \u2014 sleep, sun, a flight \u2014 and a verdict has to survive it.',
      },
      {
        // An open palm is the refusal itself: stop, not error.
        Icon: Hand,
        text: 'A refusal is an answer. It means the evidence was thin, not that you did something wrong.',
      },
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
      {
        Icon: FolderLock,
        text: 'Stored in private storage. Never public, never in a feed, never used to train a model.',
      },
      {
        // The subject is the agreement, which is what gates the send.
        Icon: Handshake,
        text: 'A photo is sent for analysis only after you agree to it, one check-in at a time.',
      },
      { Icon: CalendarClock, text: 'The analyser keeps its own copy for up to 30 days, then removes it.' },
      { Icon: Trash2, text: 'Delete a check-in, or your whole account, whenever you like.' },
    ],
  },
];

/**
 * A button that highlights on pointer-down.
 *
 * The chevron, the dots and Skip all need the same behaviour, and a hook cannot be
 * called in a loop, so the press state lives one level down here - one instance per
 * dot.
 */
function PressButton({
  onClick,
  label,
  current,
  feel = 'tight',
  className,
  children,
}: {
  onClick: () => void;
  label?: string;
  /** Sets aria-current="step" - the dots are navigation, not decoration. */
  current?: boolean;
  /**
   * How hard the press reads. `tight` for small targets, because 3% of a 24px
   * chevron is sub-pixel; `dot` grows instead of shrinking, for marks too small for
   * a shrink to be visible at all.
   */
  feel?: 'plain' | 'tight' | 'dot';
  className?: string;
  children: ReactNode;
}) {
  const press = usePress();
  const pressClass = feel === 'dot' ? 'press-dot' : feel === 'tight' ? 'press-tight' : 'press';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={current ? 'step' : undefined}
      className={cx(pressClass, className)}
      {...press}
    >
      {children}
    </button>
  );
}

/**
 * Press feedback for the shared buttons in primitives, which are used by every other
 * screen and are not this screen's to change. The wrapper takes the pointer events
 * and scales; the button inside keeps its own focus ring.
 */
function PressBox({ children }: { children: ReactNode }) {
  const press = usePress();
  return (
    <div className="press flex flex-col" {...press}>
      {children}
    </div>
  );
}

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
  // Index and direction move together in one piece of state. Held separately, a
  // panel could render with the previous move's direction and slide the wrong way.
  const [step, setStep] = useState<{ index: number; dir: 'fwd' | 'back' }>({
    index: 0,
    dir: 'fwd',
  });

  const { index, dir } = step;
  const panel = PANELS[index];
  if (!panel) return null;

  const last = index === PANELS.length - 1;

  function go(to: number) {
    setStep((prev) => ({ index: to, dir: to < prev.index ? 'back' : 'fwd' }));
  }

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
            <PressButton
              onClick={() => go(index - 1)}
              label="Back"
              className="-m-1 self-start p-1"
            >
              <ChevronLeft className="text-ink size-6" />
            </PressButton>
          ) : (
            <span className="size-6" />
          )}

          {/* Position, as dots. Not a percentage: four panels is a countable
              number and a progress bar would imply a longer process.

              Tappable, because the check-in guidance on panel two is the reason
              anyone comes back here and making them walk to it is pointless. Every
              slot is 24px so the target is reachable, and 20px wide whichever one is
              active, so changing panel moves no pixels: the rose fill grows from
              exactly the size of the dot it replaces. Shape carries the state
              alongside colour, and aria-current carries it for everyone else. */}
          <div className="flex items-center">
            {PANELS.map((p, i) => (
              <PressButton
                key={p.eyebrow}
                onClick={() => go(i)}
                label={`Step ${i + 1} of ${PANELS.length}: ${p.eyebrow}`}
                current={i === index}
                feel="dot"
                className="flex size-6 items-center justify-center"
              >
                <span className="relative flex h-1.5 w-5 items-center justify-center">
                  <span
                    className="ob-dot-idle bg-line-strong absolute size-1.5 rounded-full"
                    data-on={i === index ? 'false' : 'true'}
                    aria-hidden
                  />
                  <span
                    className="ob-dot-fill bg-rose absolute inset-0 rounded-full"
                    data-on={i === index ? 'true' : 'false'}
                    aria-hidden
                  />
                </span>
              </PressButton>
            ))}
          </div>

          {/* `plain`, not `tight`: 12% off a word of text is a lurch, and there is
              enough of it here for 3% to read. */}
          <PressButton
            onClick={() => finish('today')}
            feel="plain"
            className="text-ink-soft -m-1 p-1 text-sm"
          >
            {revisiting ? 'Close' : 'Skip'}
          </PressButton>
        </div>

        <span className="sr-only" aria-live="polite">
          Step {index + 1} of {PANELS.length}: {panel.headline}
        </span>

        {/* Keyed on the index so a panel change remounts and replays the entry.
            Nothing is locked out while it plays - the animation is decoration over a
            state change that has already happened. */}
        <div key={index} className="ob-panel mt-10 flex flex-col" data-dir={dir}>
          <div className="flex flex-col gap-5">
            <span className={cx('flex size-14 items-center justify-center rounded-2xl', panel.tint)}>
              <Glyph className={cx('size-7', panel.iconColour)} strokeWidth={1.5} aria-hidden />
            </span>

            <div className="flex flex-col gap-3">
              <Eyebrow>{panel.eyebrow}</Eyebrow>
              <Headline>{panel.headline}</Headline>
              <Lead>{panel.lead}</Lead>
            </div>
          </div>

          <div className="mt-8">
            <Card>
              <div className="ob-stagger flex flex-col gap-4">
                {panel.points.map(({ Icon, text }) => (
                  <div key={text} className="flex items-start gap-3">
                    <IconCircle tint={panel.tint}>
                      <Icon
                        className={cx('size-4', panel.iconColour)}
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    </IconCircle>
                    <span className="text-ink pt-1.5 text-[15px]">{text}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        <Spacer />

        <div className="mt-10 flex flex-col gap-3">
          {last ? (
            <>
              <PressBox>
                <PrimaryButton onClick={() => finish('check-in')}>
                  Take my first check-in
                </PrimaryButton>
              </PressBox>
              <PressBox>
                <TextButton tone="ink" onClick={() => finish('today')}>
                  Look around first
                </TextButton>
              </PressBox>
            </>
          ) : (
            <PressBox>
              <PrimaryButton onClick={() => go(index + 1)}>Next</PrimaryButton>
            </PressBox>
          )}
        </div>
      </ScreenBody>
    </Screen>
  );
}
