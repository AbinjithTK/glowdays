/**
 * The sticker sheet and the entry composer.
 *
 * Modelled on the tile pattern in Yazio's diary and the mood row in Life Reset:
 * an emoji above a written word, laid out as a grid of tappable tiles, with the
 * text field secondary rather than primary.
 *
 * https://mobbin.com/screens/7c6a6338-29c8-4e5e-a40b-9d3d43a80622  (Yazio)
 * https://mobbin.com/screens/9c591109-164f-4302-b945-65526ac111c4  (Life Reset)
 *
 * The ordering is the important decision. Every journalling app that gets used
 * daily makes an entry possible without writing a sentence, because a blank text
 * field is a chore and a chore gets skipped - and a diary with gaps cannot support
 * a comparison. So stickers come first and the note body is optional. Tap three
 * tiles, press save, done in about three seconds.
 *
 * The emoji is never alone. It sits above a real word, because emoji render
 * differently on every platform, mean different things to different people, and are
 * announced unhelpfully or not at all by screen readers. The word is the label; the
 * emoji is the affordance.
 */

import { Camera, Check, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { preparePhoto, PhotoError, type PreparedPhoto } from '../lib/photo.ts';

import {
  MAX_STICKERS_PER_ENTRY,
  stickersOfKind,
  type StickerDef,
  type StickerKind,
} from '@glowdays/core';

import { Eyebrow, PrimaryButton, TextButton } from './primitives.tsx';

const GROUPS: readonly { kind: StickerKind; header: string; note: string }[] = [
  {
    kind: 'observation',
    header: 'How your skin felt',
    note: 'What you noticed. These are never used to explain a change away.',
  },
  {
    kind: 'lifestyle',
    header: 'What happened',
    note: 'These move a reading on their own, so a verdict has to account for them.',
  },
  {
    kind: 'routine',
    header: 'What you did',
    note: 'A change to your routine is a change to the experiment.',
  },
];

export function StickerTile({
  sticker,
  selected,
  onToggle,
  disabled,
}: {
  sticker: StickerDef;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled && !selected}
      aria-pressed={selected}
      className={[
        'relative flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition-transform',
        // A selected tile is identified by fill, a border AND a tick, never by
        // colour alone. lineStrong is the lightest border permitted to mark a
        // control, so the unselected state uses it rather than the decorative line.
        selected
          ? 'bg-rose-soft border-rose border border-solid'
          : 'bg-paper border-line-strong border border-solid',
        disabled && !selected ? 'opacity-40' : 'active:scale-95',
      ].join(' ')}
    >
      <span className="text-[26px] leading-none" aria-hidden>
        {sticker.emoji}
      </span>
      <span className="text-ink text-center text-[11px] leading-tight font-medium">
        {sticker.label}
      </span>
      {selected ? (
        <span className="bg-rose absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full">
          <Check className="text-paper size-2.5" strokeWidth={3} aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

/** Stickers already saved on an entry, shown stuck to the page. */
export function StickerRow({ stickers }: { stickers: readonly StickerDef[] }) {
  if (stickers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stickers.map((s, i) => (
        <span
          key={s.id}
          className={[
            'bg-paper sticker-peel flex items-center gap-1.5 rounded-full px-2.5 py-1',
            i % 3 === 0 ? 'tilt-l' : i % 3 === 1 ? '' : 'tilt-r',
          ].join(' ')}
        >
          <span className="text-[15px] leading-none" aria-hidden>
            {s.emoji}
          </span>
          <span className="text-ink text-[12px] font-medium">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

export interface ComposerValue {
  readonly tags: string[];
  readonly body: string;
  /** Optional snapshot. Never analysed, never sent to the provider. */
  readonly photo: Blob | null;
}

/**
 * An instant photo, taped to the page.
 *
 * The white border is thicker at the bottom, which is the whole visual signature of
 * a peel-apart instant print and the reason this reads as a photograph on paper
 * rather than as a rounded thumbnail. The tilt and the small shadow are the same
 * treatment the stickers get, so the two belong to one metaphor instead of two.
 *
 * The tape is `aria-hidden` and the caption is real text, because the frame is
 * decoration and the photograph needs an actual description.
 */
export function InstantPhoto({
  src,
  alt,
  caption,
  tilt = 'l',
  onRemove,
}: {
  src: string;
  alt: string;
  caption?: string;
  tilt?: 'l' | 'r' | 'none';
  onRemove?: () => void;
}) {
  return (
    <div className="relative self-start">
      <div
        className={[
          'bg-paper sticker-peel relative rounded-[3px] px-2 pt-2 pb-7',
          tilt === 'l' ? 'tilt-l' : tilt === 'r' ? 'tilt-r' : '',
        ].join(' ')}
      >
        {/* A strip of tape across the top corner. Decorative only. */}
        <span
          className="absolute -top-2 left-1/2 h-4 w-14 -translate-x-1/2 -rotate-2 rounded-[1px] bg-[rgba(107,95,91,0.16)]"
          aria-hidden
        />
        <img src={src} alt={alt} className="block size-36 rounded-[2px] object-cover" />
        {caption ? (
          <span className="text-ink-soft absolute bottom-1.5 left-0 w-full px-2 text-center text-[10px]">
            {caption}
          </span>
        ) : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this photo"
          className="bg-ink absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full"
        >
          <X className="text-paper size-3.5" strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The composer.
 *
 * Saving with stickers and no text is allowed and expected. The body placeholder
 * says so, because an empty field with no explanation reads as a required one.
 */
export function Composer({
  busy,
  error,
  onSave,
  onCancel,
  initial,
}: {
  busy: boolean;
  error: string | null;
  onSave: (value: ComposerValue) => void;
  onCancel: () => void;
  initial?: ComposerValue;
}) {
  const [tags, setTags] = useState<string[]>(initial ? [...initial.tags] : []);
  const [body, setBody] = useState(initial?.body ?? '');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const full = tags.length >= MAX_STICKERS_PER_ENTRY;

  async function pick(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      const prepared = await preparePhoto(file);
      // Release the previous preview before replacing it, or every retake leaks a
      // blob URL for the lifetime of the page.
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      setPhoto(prepared);
    } catch (err) {
      setPhotoError(err instanceof PhotoError ? err.message : 'That photo could not be used.');
    }
  }

  function toggle(id: string) {
    setTags((current) =>
      current.includes(id)
        ? current.filter((t) => t !== id)
        : current.length < MAX_STICKERS_PER_ENTRY
          ? [...current, id]
          : current,
    );
  }

  // Nothing at all is not an entry. Any one of the three is enough on its own.
  const empty = tags.length === 0 && body.trim().length === 0 && photo === null;

  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <div key={group.kind} className="flex flex-col gap-3">
          <Eyebrow tone="soft">{group.header}</Eyebrow>
          <div className="grid grid-cols-4 gap-2">
            {stickersOfKind(group.kind).map((s) => (
              <StickerTile
                key={s.id}
                sticker={s}
                selected={tags.includes(s.id)}
                onToggle={() => toggle(s.id)}
                disabled={full}
              />
            ))}
          </div>
          <span className="text-ink-soft text-xs">{group.note}</span>
        </div>
      ))}

      {full ? (
        <span className="text-ink-soft text-sm">
          Eight is the most one entry holds. Untick one to swap it.
        </span>
      ) : null}

      {/* A snapshot for the page. Stated as not-analysed, because in an app that
          does send photographs to an analyser, silence here would be misleading. */}
      <div className="flex flex-col gap-3">
        <Eyebrow tone="soft">A photo for the page</Eyebrow>
        {photo ? (
          <InstantPhoto
            src={photo.previewUrl}
            alt="The photo you are attaching to this entry"
            caption="today"
            onRemove={() => {
              URL.revokeObjectURL(photo.previewUrl);
              setPhoto(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border-line-strong text-ink flex items-center gap-2 self-start rounded-xl border border-dashed px-4 py-3"
          >
            <Camera className="size-4" strokeWidth={1.5} aria-hidden />
            <span className="text-sm font-medium">Add a photo</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // `capture` is deliberately absent. On a phone this lets the user choose
          // between the camera and their library, and a diary photo is as likely to
          // be a product label they already photographed as something taken now.
          onChange={(e) => void pick(e.target.files?.[0])}
          className="hidden"
        />
        <span className="text-ink-soft text-xs">
          Kept in your private storage and never sent for analysis. This is for the page, not for
          measurement.
        </span>
        {photoError ? (
          <span className="text-danger text-sm" role="alert">
            {photoError}
          </span>
        ) : null}
      </div>

      <label className="flex flex-col gap-2">
        <Eyebrow tone="soft">Anything to add</Eyebrow>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Optional. The stickers are enough on their own."
          className="text-ink border-line-strong bg-paper rounded-xl border border-solid p-3 text-base outline-none"
        />
      </label>

      {error ? (
        <span className="text-danger text-sm" role="alert">
          {error}
        </span>
      ) : null}

      <div className="flex flex-col gap-2">
        <PrimaryButton
          onClick={() => onSave({ tags, body: body.trim(), photo: photo?.blob ?? null })}
          disabled={busy || empty}
        >
          {busy ? 'Saving…' : 'Save to my diary'}
        </PrimaryButton>
        <TextButton tone="ink" onClick={onCancel}>
          Not now
        </TextButton>
      </div>
    </div>
  );
}
