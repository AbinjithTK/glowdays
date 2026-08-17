/**
 * Check-in capture.
 *
 * Four steps in one screen: live preview, review, consent, analysis. They are
 * one screen because they are one act, and because a route per step means a
 * half-finished check-in can be reached by URL with no camera behind it.
 *
 * The preview is mirrored so it behaves like a mirror. The saved frame is not -
 * see camera.ts, because a flipped image would invert every left/right reading,
 * including the cheek regions the provider scores separately.
 *
 * The diagnostics panel is not debug clutter. The resolution a browser actually
 * grants decides which analysis tier is reachable, browsers ignore resolution
 * requests silently, and the number is invisible unless something shows it. It
 * is the first thing worth knowing about any device this runs on.
 */

import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronLeft, Info, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../lib/api.ts';
import * as cam from '../lib/camera.ts';
import { measureQuality, tierExplanation, tierFor, type MeasuredQuality } from '../lib/quality.ts';
import {
  Advisory,
  Card,
  Eyebrow,
  Headline,
  Lead,
  OutlineButton,
  PrimaryButton,
  Screen,
  ScreenBody,
  Spacer,
  TextButton,
} from '../ui/primitives.tsx';

type Step = 'starting' | 'live' | 'review' | 'consent' | 'analysing' | 'blocked';

interface Shot {
  readonly blob: Blob;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly shortSidePx: number;
  readonly sourceShortSidePx: number;
  readonly downscaled: boolean;
  readonly bytes: number;
  readonly quality: MeasuredQuality;
}

export function Capture() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<cam.CameraSession | null>(null);

  const [step, setStep] = useState<Step>('starting');
  const [session, setSession] = useState<cam.CameraSession | null>(null);
  const [problem, setProblem] = useState<cam.CameraError | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------- camera

  const start = useCallback(async () => {
    setProblem(null);
    setStep('starting');
    try {
      const opened = await cam.open();
      sessionRef.current = opened;
      setSession(opened);
      setStep('live');
      if (videoRef.current) {
        videoRef.current.srcObject = opened.stream;
        await videoRef.current.play().catch(() => {
          // Autoplay can be refused until a gesture. The preview appears on the
          // next tap; not worth an error state.
        });
      }
    } catch (err) {
      setProblem(err instanceof cam.CameraError ? err : new cam.CameraError('unknown', 'Failed.'));
      setStep('blocked');
    }
  }, []);

  useEffect(() => {
    void start();
    // Releasing the track matters: a camera left open keeps the indicator light
    // on and blocks other apps from using it.
    return () => sessionRef.current?.stop();
  }, [start]);

  // ---------------------------------------------------------------- capture

  async function takeShot() {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    try {
      const frame = await cam.capture(video);
      const quality = await measureQuality(frame.bitmap);
      setShot({
        blob: frame.blob,
        previewUrl: URL.createObjectURL(frame.blob),
        width: frame.width,
        height: frame.height,
        shortSidePx: frame.shortSidePx,
        sourceShortSidePx: Math.min(frame.sourceWidth, frame.sourceHeight),
        downscaled: frame.downscaled,
        bytes: frame.bytes,
        quality,
      });
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo could not be taken.');
    }
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.previewUrl);
    setShot(null);
    setError(null);
    setStep('live');
  }

  // -------------------------------------------------------------- uploading

  const upload = useMutation({
    mutationFn: async (current: Shot) => {
      const created = await api.createScan(current.blob, {
        source: current.quality.source,
        preset: 'MODERATE',
        lightingLevel: current.quality.lightingLevel,
        lightingUneven: current.quality.lightingUneven,
        faceRatio: current.quality.faceRatio,
        yaw: current.quality.yaw,
        pitch: current.quality.pitch,
        roll: current.quality.roll,
        // Sent so the server does not read an unmeasured 0 as "too far away".
        measured: current.quality.measured,
      });
      return created.scan.id;
    },
    onSuccess: (id) => {
      setScanId(id);
      setStep('consent');
      sessionRef.current?.stop();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Upload failed.');
    },
  });

  /**
   * Consent, start the analysis, then hand off.
   *
   * This used to poll for the result here, up to sixty times, and hold the screen
   * on "Analysing…" for the duration. That was wrong in both directions: a slow
   * but healthy analysis looked identical to a stuck one, and an analysis that
   * outlived the loop reported failure for work that was still running perfectly
   * well and would land a few seconds later.
   *
   * The check-in's own screen already polls, shows elapsed time, and says plainly
   * that leaving is safe. Sending the user there means the wait is observable and
   * escapable rather than a modal with no exit, and there is one polling
   * implementation instead of two that can disagree.
   */
  const analyse = useMutation({
    mutationFn: async (id: string) => {
      // Consent is a server-side gate. Analysis is refused with a 428 without it,
      // so this order is not a formality.
      await api.consent(id);
      await api.analyse(id);
      return id;
    },
    onSuccess: async (id) => {
      sessionRef.current?.stop();
      await queryClient.invalidateQueries();
      navigate(`/check-in/${id}`, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Analysis failed.');
      setStep('review');
    },
  });

  // ------------------------------------------------------------------ views

  if (step === 'blocked' && problem) {
    return <CameraBlocked problem={problem} onRetry={start} onBack={() => navigate('/today')} />;
  }

  if (step === 'consent' || step === 'analysing') {
    return (
      <ConsentAndAnalyse
        busy={analyse.isPending}
        error={error}
        onAgree={() => {
          if (!scanId) return;
          setStep('analysing');
          analyse.mutate(scanId);
        }}
        onCancel={() => navigate('/today')}
      />
    );
  }

  if (step === 'review' && shot) {
    return (
      <Review
        shot={shot}
        busy={upload.isPending}
        error={error}
        onRetake={retake}
        onContinue={() => upload.mutate(shot)}
      />
    );
  }

  // Live preview.
  return (
    <div className="bg-plum relative flex min-h-dvh flex-col">
      <div className="flex items-center justify-between p-6">
        <button type="button" onClick={() => navigate('/today')} aria-label="Close">
          <X className="size-6 text-white" />
        </button>
        <span className="text-xs font-semibold tracking-widest text-white/70 uppercase">
          Check-in
        </span>
        <span className="size-6" />
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          // playsInline is required or iOS takes the video fullscreen and the
          // guide overlay disappears behind it.
          playsInline
          muted
          autoPlay
          aria-label="Camera preview"
          className="absolute inset-0 size-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* The oval the face should fill. Also defines the region quality is
            measured over, so it is not only decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[50%] border border-white/60"
          style={{ left: '22%', top: '16%', width: '56%', height: '62%' }}
        />

        {step === 'starting' ? (
          <p className="z-10 px-8 text-center text-base text-white">
            Asking for the camera…
          </p>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-col gap-5 px-6 pb-8">
        <div className="flex flex-col gap-1 text-center">
          <p className="text-base text-white">Bright, even light.</p>
          <p className="text-base text-white/70">Straight on, filling the oval.</p>
          <p className="text-base text-white/70">Same spot as last time.</p>
        </div>

        {session ? <Diagnostics session={session} /> : null}

        {error ? (
          <p className="text-center text-sm text-white" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={takeShot}
            disabled={step !== 'live'}
            aria-label="Take the photo"
            className="flex size-[76px] items-center justify-center rounded-full border-4 border-white/90 bg-white/10 active:scale-95 disabled:opacity-40"
          >
            <Camera className="size-7 text-white" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the device actually gave us.
 *
 * Kept on screen rather than hidden behind a developer flag. The tier is not a
 * setting, it is a consequence of the hardware, and someone whose phone can only
 * reach standard detail should be told once, plainly, instead of wondering why
 * their check-ins never compare against a friend's.
 */
function Diagnostics({ session }: { session: cam.CameraSession }) {
  const tier = tierFor(session.shortSidePx);
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest text-white/70 uppercase">
          This camera
        </span>
        <span className="tabular-nums text-sm text-white">
          {session.width}×{session.height}
        </span>
      </div>
      <p className="mt-1 text-sm text-white/80">
        {tier === 'hd'
          ? 'High detail available.'
          : tier === 'sd'
            ? `${session.shortSidePx}px short side — standard detail.`
            : `${session.shortSidePx}px short side — below the minimum.`}
      </p>
    </div>
  );
}

function CameraBlocked({
  problem,
  onRetry,
  onBack,
}: {
  problem: cam.CameraError;
  onRetry: () => void;
  onBack: () => void;
}) {
  const insecure = problem.reason === 'insecure_context';
  return (
    <Screen>
      <ScreenBody>
        <button type="button" onClick={onBack} aria-label="Back" className="self-start">
          <ChevronLeft className="text-ink size-6" />
        </button>
        <div className="mt-4 flex flex-col gap-2">
          <Eyebrow>Camera</Eyebrow>
          <Headline>
            {insecure ? 'This page needs a secure connection.' : 'The camera is not available.'}
          </Headline>
          <Lead>{problem.message}</Lead>
        </div>

        <div className="mt-8">
          <Advisory tone="lavender">
            <span className="text-ink text-base font-medium">Nothing is lost either way.</span>
            <span className="text-ink-soft text-sm">
              Your diary and any trial are untouched. A photo from your library works exactly the
              same, including its confidence label.
            </span>
          </Advisory>
        </div>

        <Spacer />

        <div className="mt-8 flex flex-col gap-3">
          {problem.recoverable ? (
            <PrimaryButton onClick={onRetry}>Try the camera again</PrimaryButton>
          ) : null}
          <OutlineButton onClick={onBack}>Back to Today</OutlineButton>
        </div>
      </ScreenBody>
    </Screen>
  );
}

function Review({
  shot,
  busy,
  error,
  onRetake,
  onContinue,
}: {
  shot: Shot;
  busy: boolean;
  error: string | null;
  onRetake: () => void;
  onContinue: () => void;
}) {
  const tier = tierFor(shot.shortSidePx);
  const framingMeasured = shot.quality.measured.includes('framing');

  return (
    <Screen>
      <ScreenBody>
        <div className="flex flex-col gap-2">
          <Eyebrow>Review</Eyebrow>
          <Headline>Does this match your baseline?</Headline>
        </div>

        <div className="bg-plum mt-6 overflow-hidden rounded-2xl">
          <img
            src={shot.previewUrl}
            alt="The photo you just took"
            className="aspect-[4/5] w-full object-cover"
          />
        </div>

        <div className="mt-3 flex items-center justify-center">
          <TextButton onClick={onRetake}>Retake</TextButton>
        </div>

        {tier !== 'hd' ? (
          <div className="mt-6">
            <Advisory>
              <span className="text-ink text-base">{tierExplanation(shot.shortSidePx)}</span>
              <span className="text-ink-soft text-sm">
                It is a real measurement, simply a different instrument. Saved either way.
              </span>
            </Advisory>
          </div>
        ) : null}

        {/* What is actually about to be sent. Stated because it can differ from
            what the camera produced: the upload has a hard size ceiling, and a
            reduction that changed the analysis tier would otherwise be invisible
            until two check-ins mysteriously refused to compare. */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-ink-soft text-xs font-semibold tracking-widest uppercase">
            Sending
          </span>
          <span className="text-ink-soft tabular-nums text-sm">
            {shot.width}×{shot.height} · {(shot.bytes / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>
        {shot.downscaled ? (
          <p className="text-ink-soft mt-1 text-sm">
            Reduced from {shot.sourceShortSidePx}px on the short side to fit the upload limit.
            {tier === 'hd'
              ? ' Still above the 1080 high detail needs.'
              : ' This one could not be kept above 1080.'}
          </p>
        ) : null}

        {/* Stated before upload, not after. Someone deciding whether to send a
            photo of their face should know what the resulting comparison can
            and cannot claim. */}
        <div className="mt-6">
          <Card tone={framingMeasured ? 'sage' : 'lavender'}>
            <div className="flex gap-3">
              <Info className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
              <div className="flex flex-col gap-2">
                <span className="text-ink text-base font-medium">
                  {framingMeasured
                    ? 'Light and framing measured.'
                    : 'Light measured, framing not.'}
                </span>
                <span className="text-ink-soft text-sm">
                  {framingMeasured
                    ? 'Both were recorded from the frame, so a comparison against another measured check-in can carry full confidence.'
                    : 'This browser cannot measure how much of the frame your face filled or how your head was angled, so comparisons using this check-in are capped at a directional check rather than claiming everything lined up.'}
                </span>
              </div>
            </div>
          </Card>
        </div>

        <Spacer />

        {/* Below the spacer, so it is pinned to the button rather than floating
            up with the content. This screen is tall - a 4:5 photo plus two
            explanatory cards - and an error placed above the spacer sat off the
            bottom of a phone viewport, which made a refused upload look like a
            button that simply did nothing. */}
        {error ? (
          <div className="mt-6" role="alert">
            <Advisory>
              <span className="text-ink text-base">{error}</span>
            </Advisory>
          </div>
        ) : null}

        <div className="mt-8">
          <PrimaryButton onClick={onContinue} disabled={busy || tier === null}>
            {busy ? 'Saving…' : 'Continue'}
          </PrimaryButton>
        </div>
      </ScreenBody>
    </Screen>
  );
}

function ConsentAndAnalyse({
  busy,
  error,
  onAgree,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onAgree: () => void;
  onCancel: () => void;
}) {
  return (
    <Screen>
      <ScreenBody>
        <div className="flex flex-col gap-2">
          <Eyebrow>Before analysis</Eyebrow>
          <Headline>Where this photo goes.</Headline>
        </div>

        <div className="mt-8">
          <Card tone="lavender">
            <div className="flex flex-col gap-4">
              {[
                'Sent to Perfect Corp\u2019s YouCam skin analysis to produce scores.',
                'Stored in your private storage, never in a gallery or a feed.',
                // The corrected figure. Five prototype screens said 24 hours,
                // which understated the provider's own stated period by 30x
                // inside a consent flow.
                'The provider keeps the upload for up to 30 days, then removes it.',
                'Deleting this check-in removes the photo and its readings here.',
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
        </div>

        {busy ? (
          <div className="mt-8 flex flex-col gap-3">
            <Eyebrow tone="soft">In progress</Eyebrow>
            <div className="flex items-center gap-3">
              <RefreshCw className="text-rose size-5 animate-spin" strokeWidth={1.5} aria-hidden />
              <span className="text-ink text-base">Analysis underway.</span>
            </div>
            {/* Named steps, never a percentage. A progress bar for work of
                unknown duration is a guess presented as a fact. */}
            <span className="text-ink-soft text-sm">
              You can close this. The result will be waiting on Today.
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6">
            <Advisory>
              <span className="text-ink text-base">{error}</span>
            </Advisory>
          </div>
        ) : null}

        <Spacer />

        <div className="mt-8 flex flex-col gap-3">
          <PrimaryButton onClick={onAgree} disabled={busy}>
            {busy ? 'Analysing…' : 'I agree, analyse this check-in'}
          </PrimaryButton>
          <TextButton onClick={onCancel} tone="ink">
            Not now, keep it as a draft
          </TextButton>
        </div>
      </ScreenBody>
    </Screen>
  );
}
