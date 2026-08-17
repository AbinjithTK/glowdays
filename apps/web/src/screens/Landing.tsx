/**
 * Landing.
 *
 * The first thing an unauthenticated visitor sees. Until now that was a sign-in form,
 * which asks someone to hand over an email address before telling them what the thing
 * does - and for a product whose whole proposition is unusual, that ordering loses
 * people who would otherwise have stayed.
 *
 * The claim is stated in the negative on purpose. Every other app in this category
 * promises a better score and a routine to buy; the honest and more interesting thing
 * to lead with is that this one will refuse to answer when the evidence is thin. That
 * is the differentiator, and burying it below a form would waste it.
 *
 * Two doors, and both are real:
 *  - Create an account. Real email and password, via Neon Auth, no verification email
 *    to wait for.
 *  - Use an access code. For reviewers, who should not have to invent a password to
 *    look at something.
 *
 * The second is offered plainly rather than hidden, because a reviewer who cannot get
 * in cannot assess anything, and an access code presented as a secret back door reads
 * worse than one presented as what it is.
 */

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, KeyRound, ScanFace, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api } from '../lib/api.ts';
import { Eyebrow, PrimaryButton, Screen, TextButton } from '../ui/primitives.tsx';

const PROOFS = [
  {
    Glyph: ScanFace,
    tint: 'bg-lavender',
    colour: 'text-violet',
    title: 'It refuses when it should',
    body: 'Two check-ins taken in different light are not comparable, and the app says so instead of reporting the difference as a change in your skin.',
  },
  {
    Glyph: SlidersHorizontal,
    tint: 'bg-teal-soft',
    colour: 'text-teal',
    title: 'Commit before you conclude',
    body: 'Name the one metric you expect a product to move, before you start. One trial at a time, so a result is actually attributable.',
  },
  {
    Glyph: Camera,
    tint: 'bg-rose-soft',
    colour: 'text-rose',
    title: 'Measured, not guessed',
    body: 'Readings come from Perfect Corp\u2019s YouCam skin analysis. Light and framing are measured from the frame and decide how much the comparison can claim.',
  },
] as const;

export function Landing() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1 });

  // Only offered when the server says real accounts exist. Showing a sign-up button
  // that 404s is worse than showing only the door that works.
  const accounts = health.data?.accounts === true;
  const demo = health.data?.auth === 'demo';

  return (
    <Screen>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* ------------------------------------------------------------ hero */}
        <div className="bg-plum paper-grain px-6 pt-10 pb-12">
          <Eyebrow tone="soft">
            <span className="text-white/70">Glowdays</span>
          </Eyebrow>

          <h1 className="font-serif mt-5 text-[34px] leading-[1.15] text-white">
            Find out whether it actually worked.
          </h1>

          <p className="mt-4 text-base text-white/80">
            A private skin diary that measures what changed — and tells you when two
            photographs were not alike enough to say anything at all.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {accounts ? (
              <PrimaryButton onClick={() => navigate('/sign-up')}>
                Create my diary
              </PrimaryButton>
            ) : null}

            {demo ? (
              <button
                type="button"
                onClick={() => navigate('/sign-in')}
                className="flex h-13 w-full items-center justify-center gap-2 rounded-xl border border-solid border-white/40 bg-transparent text-base font-medium text-white"
              >
                {accounts ? (
                  <>
                    <KeyRound className="size-4" strokeWidth={1.5} aria-hidden />
                    I have an account or a code
                  </>
                ) : (
                  <>
                    Continue with an access code
                    <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
                  </>
                )}
              </button>
            ) : null}

            {health.isError ? (
              <p className="text-sm text-white/70" role="alert">
                The service is not answering. It may still be starting up — give it a
                moment and reload.
              </p>
            ) : null}
          </div>
        </div>

        {/* ---------------------------------------------------------- proofs */}
        <div className="flex flex-col gap-4 px-6 pt-10">
          <Eyebrow>Why it is different</Eyebrow>

          {PROOFS.map(({ Glyph, tint, colour, title, body }) => (
            <div key={title} className="bg-paper paper-inset flex gap-4 rounded-2xl p-5">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
                <Glyph className={`size-5 ${colour}`} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="flex flex-col gap-1.5">
                <span className="text-ink text-base font-medium">{title}</span>
                <span className="text-ink-soft text-sm">{body}</span>
              </span>
            </div>
          ))}
        </div>

        {/* --------------------------------------------------------- privacy */}
        <div className="px-6 py-10">
          <div className="bg-sage flex gap-3 rounded-2xl p-5">
            <ShieldCheck className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
            <div className="flex flex-col gap-2">
              <span className="text-ink text-base font-medium">
                Photographs of your face, treated like it.
              </span>
              <span className="text-ink-soft text-sm">
                Private storage only. Nothing public, nothing in a feed, nothing used to
                train a model. A photo is sent for analysis only after you agree to it,
                one check-in at a time, and the analyser removes its own copy within 30
                days. Delete any of it whenever you like.
              </span>
            </div>
          </div>

          {health.data?.youcam === 'fixture' ? (
            <p className="text-ink-soft mt-6 text-sm">
              Note: this build is running on generated sample scores rather than live
              analysis.
            </p>
          ) : null}

          <div className="mt-8 flex justify-center">
            <TextButton tone="ink" onClick={() => navigate('/sign-in')}>
              Already have a diary? Sign in
            </TextButton>
          </div>
        </div>
      </div>
    </Screen>
  );
}
