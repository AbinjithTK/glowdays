/**
 * One accent hue per metric, from the design guidelines.
 *
 * The guidelines table names six metrics. The API returns sixteen, so the rest
 * fall back to neutral ink rather than borrowing a hue that belongs to another
 * metric - two accents competing inside one card is explicitly disallowed, and
 * silently reusing teal for both hydration and oiliness would do exactly that.
 */

import {
  CircleDot,
  Droplet,
  Eye,
  Fingerprint,
  Layers,
  Scan,
  Sparkles,
  Sun,
  Waves,
  type LucideIcon,
} from 'lucide-react';

import type { MetricId } from '@glowdays/core';

export interface MetricStyle {
  /** Tailwind class for the icon colour. */
  readonly icon: string;
  /** Tailwind class for the tinted circle behind it. */
  readonly tint: string;
  /**
   * lucide's own icon type. A hand-written `ComponentType<{className?: string}>`
   * looks equivalent but is not: lucide types `strokeWidth` as `string | number`
   * and under `exactOptionalPropertyTypes` the narrower shape is rejected.
   */
  readonly Glyph: LucideIcon;
}

const NEUTRAL: MetricStyle = { icon: 'text-ink', tint: 'bg-neutral-pill', Glyph: CircleDot };

const STYLES: Partial<Record<MetricId, MetricStyle>> = {
  hydration: { icon: 'text-teal', tint: 'bg-teal-soft', Glyph: Droplet },
  radiance: { icon: 'text-ochre', tint: 'bg-ochre-soft', Glyph: Sun },
  redness: { icon: 'text-violet', tint: 'bg-violet-soft', Glyph: Waves },
  texture: { icon: 'text-moss', tint: 'bg-moss-soft', Glyph: Layers },
  pore: { icon: 'text-slate', tint: 'bg-slate-soft', Glyph: CircleDot },
  wrinkles: { icon: 'text-rose', tint: 'bg-rose-soft', Glyph: Scan },
  // Beyond the six the guidelines assign, neutral rather than a borrowed hue.
  oiliness: { ...NEUTRAL, Glyph: Sparkles },
  acne: { ...NEUTRAL, Glyph: Fingerprint },
  darkCircle: { ...NEUTRAL, Glyph: Eye },
  eyeBag: { ...NEUTRAL, Glyph: Eye },
};

export function metricStyle(id: MetricId): MetricStyle {
  return STYLES[id] ?? NEUTRAL;
}

export function MetricIcon({ id }: { id: MetricId }) {
  const { icon, tint, Glyph } = metricStyle(id);
  return (
    <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tint}`}>
      <Glyph className={`size-[18px] ${icon}`} strokeWidth={1.5} />
    </div>
  );
}

/** `51.0 → 63.0 raw`, the exact reading format the guidelines require. */
export function formatMovement(from: number | null, to: number | null): string {
  if (from === null || to === null) return 'not measured';
  return `${from.toFixed(1)} → ${to.toFixed(1)} raw`;
}

export function formatScore(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}
