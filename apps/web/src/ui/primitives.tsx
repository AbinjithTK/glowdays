/**
 * The component vocabulary, lifted from the generated screens.
 *
 * The Flowstep canvas repeats the same handful of shapes on every screen:
 * a section header, a paper card, a divider-separated row, a neutral pill, a
 * confidence badge, a primary button. They were duplicated as inline markup on
 * every screen with the hex values written out each time. Naming them once means
 * the tokens are applied from one place and a fix reaches every screen instead
 * of the ones someone remembers to edit.
 *
 * Two rules from the design guidelines are enforced in code rather than trusted
 * to each caller:
 *
 *  - Direction is never colour alone. `DeltaPill` always renders a sign, a
 *    triangle and a word, and it has no green or red variant to reach for.
 *  - Only the dominant card on a screen may carry a shadow, so that is an
 *    explicit prop rather than the default.
 */

import { ChevronRight, Minus, TriangleAlert, Check, Square, Triangle } from 'lucide-react';
import type { ReactNode } from 'react';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ layout

/** Screen shell. 24px padding and canvas background, per the guidelines. */
export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('bg-canvas text-ink flex min-h-dvh flex-col', className)}>{children}</div>
  );
}

export function ScreenBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col p-6">{children}</div>;
}

/** 12px uppercase letterspaced metadata. roseDeep for a section, inkSoft for a sub-header. */
export function Eyebrow({
  children,
  tone = 'rose',
}: {
  children: ReactNode;
  tone?: 'rose' | 'soft' | 'danger';
}) {
  const colour =
    tone === 'rose' ? 'text-rose-deep' : tone === 'danger' ? 'text-danger' : 'text-ink-soft';
  return (
    <span className={cx('text-xs font-semibold tracking-widest uppercase', colour)}>
      {children}
    </span>
  );
}

/** The single H1. DM Serif Display, nothing else uses it. */
export function Headline({ children }: { children: ReactNode }) {
  return <h1 className="font-serif text-ink text-3xl leading-tight">{children}</h1>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-ink-soft text-base">{children}</p>;
}

/** 32px between titled sections, 20px between a header and its content. */
export function Section({
  header,
  tone = 'soft',
  children,
}: {
  header?: ReactNode;
  tone?: 'rose' | 'soft';
  children: ReactNode;
}) {
  return (
    <section className="mt-8 flex flex-col gap-5">
      {header ? <Eyebrow tone={tone}>{header}</Eyebrow> : null}
      {children}
    </section>
  );
}

export function Card({
  children,
  tone = 'paper',
  dominant = false,
  className,
}: {
  children: ReactNode;
  tone?: 'paper' | 'lavender' | 'caution' | 'sage';
  /** Only one card per screen may carry the shadow. */
  dominant?: boolean;
  className?: string;
}) {
  const background =
    tone === 'lavender'
      ? 'bg-lavender'
      : tone === 'caution'
        ? 'bg-caution'
        : tone === 'sage'
          ? 'bg-sage'
          : 'bg-paper';
  return (
    <div
      className={cx(
        'flex flex-col rounded-2xl',
        background,
        dominant ? 'shadow-card p-6' : 'p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="bg-line h-px w-full" />;
}

// ----------------------------------------------------------------- controls

export function PrimaryButton({
  children,
  onClick,
  disabled,
  tone = 'rose',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'rose' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'h-13 w-full rounded-xl text-base font-medium transition-opacity',
        tone === 'danger' ? 'bg-danger' : 'bg-rose',
        'text-paper',
        // Disabled uses the neutral fill and a readable label, never black.
        disabled && 'bg-line-strong text-paper cursor-not-allowed opacity-70',
      )}
    >
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-13 border-rose text-rose w-full rounded-xl border border-solid bg-transparent text-base font-medium"
    >
      {children}
    </button>
  );
}

export function TextButton({
  children,
  onClick,
  tone = 'rose',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'rose' | 'danger' | 'ink';
}) {
  const colour = tone === 'danger' ? 'text-danger' : tone === 'ink' ? 'text-ink' : 'text-rose';
  return (
    <button type="button" onClick={onClick} className={cx('py-1 text-center text-[15px]', colour)}>
      {children}
    </button>
  );
}

/** Selectable pill. A tappable border is lineStrong, never the decorative line. */
export function Pill({
  children,
  selected = false,
  onClick,
  icon,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const interactive = typeof onClick === 'function';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={interactive ? selected : undefined}
      disabled={!interactive}
      className={cx(
        'flex items-center gap-2 rounded-full border border-solid px-4 py-2 text-sm',
        selected
          ? 'bg-rose-soft border-rose text-ink'
          : 'bg-paper border-line-strong text-ink-soft',
        !interactive && 'cursor-default',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** Read-only figure pill. Neutral fill, ink text, no direction implied. */
export function ValuePill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-neutral-pill rounded-full px-3 py-1.5">
      <span className="text-ink tabular-nums text-sm">{children}</span>
    </span>
  );
}

/**
 * A signed movement.
 *
 * Never green, never red. The guidelines are explicit that a metric moving down
 * is not a failure, and colour-coding direction would say the opposite before
 * anyone read the number. Sign, triangle and neutral fill only.
 */
export function DeltaPill({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="bg-neutral-pill flex items-center gap-1 rounded-full px-3 py-1.5">
        <Minus className="text-ink size-3" strokeWidth={1.5} />
        <span className="text-ink text-sm">not measured</span>
      </span>
    );
  }
  const rising = delta > 0;
  const flat = Math.abs(delta) < 0.05;
  return (
    <span className="bg-neutral-pill flex items-center gap-1 rounded-full px-3 py-1.5">
      {flat ? (
        <Minus className="text-ink size-3" strokeWidth={2} />
      ) : (
        <Triangle
          className={cx('text-ink size-2.5 fill-current', !rising && 'rotate-180')}
          strokeWidth={0}
          aria-hidden
        />
      )}
      <span className="text-ink tabular-nums text-sm">
        {flat ? '0.0' : `${rising ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}
      </span>
      {/* The word carries the meaning for anyone who cannot see the triangle. */}
      <span className="sr-only">{flat ? 'no change' : rising ? 'moved up' : 'moved down'}</span>
    </span>
  );
}

/**
 * Confidence. Four labels, exactly as named in the guidelines.
 *
 * Only the highest label gets the sage tint. The rest are neutral, because a
 * warning colour on a low-confidence comparison would read as "your skin got
 * worse" rather than "these two photos were not alike enough".
 */
export function ConfidenceBadge({ label }: { label: string }) {
  const high = label === 'Comparable capture';
  const care = label === 'Treat with care';
  const Glyph = high ? Check : care ? Square : Minus;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5',
        high ? 'bg-sage' : 'bg-neutral-pill',
      )}
    >
      <Glyph className="text-ink size-3.5" strokeWidth={1.5} aria-hidden />
      <span className="text-ink text-sm">{label}</span>
    </span>
  );
}

// --------------------------------------------------------------------- rows

/** A tinted circle holding a thin line icon. 32px, per the icon rules. */
export function IconCircle({
  children,
  tint,
}: {
  children: ReactNode;
  tint: string;
}) {
  return (
    <div className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', tint)}>
      {children}
    </div>
  );
}

export function Row({
  icon,
  title,
  detail,
  trailing,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="text-ink text-base">{title}</span>
        {detail ? <span className="text-ink-soft text-sm">{detail}</span> : null}
      </span>
      {trailing}
      {onClick ? (
        <ChevronRight className="text-ink-soft size-5 shrink-0" strokeWidth={1.5} aria-hidden />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="flex w-full items-center gap-4 py-4">
        {content}
      </button>
    );
  }
  return <div className="flex w-full items-center gap-4 py-4">{content}</div>;
}

/** Rows inside a card, separated by decorative dividers. */
export function RowGroup({ children }: { children: ReactNode[] }) {
  return (
    <>
      {children.map((child, i) => (
        // Index keys are correct here: this renders a static list of rows whose
        // order is fixed by the caller.
        <div key={i}>
          {i > 0 ? <Divider /> : null}
          {child}
        </div>
      ))}
    </>
  );
}

/** An advisory. Caution tint means "read this", never "you did wrong". */
export function Advisory({
  children,
  tone = 'caution',
}: {
  children: ReactNode;
  tone?: 'caution' | 'lavender';
}) {
  return (
    <div className={cx('flex gap-3 rounded-2xl p-5', tone === 'caution' ? 'bg-caution' : 'bg-lavender')}>
      <TriangleAlert className="text-ink mt-0.5 size-5 shrink-0" strokeWidth={1.5} aria-hidden />
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export function Spacer() {
  return <div className="flex-1" />;
}
