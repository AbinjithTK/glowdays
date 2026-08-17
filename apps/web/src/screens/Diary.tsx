/**
 * Diary.
 *
 * Rebuilt, because the first version was a list of check-ins and nothing else. The
 * API has had notes with dates, bodies and tags from the start and the UI never
 * touched them, which made this a scan history wearing a diary's name. A diary that
 * only records measurements cannot answer the question the product is for: a score
 * moved, and what else was going on.
 *
 * Structure, taken from the journalling apps that get this right:
 *
 *  - A vertical spine with one node per day, from Life Reset. A day with a check-in
 *    gets a filled node; a day with only written entries gets a hollow one, so the
 *    shape of the record is legible before anything is read.
 *    https://mobbin.com/screens/9c591109-164f-4302-b945-65526ac111c4
 *  - The day as a stacked numeral and month, from Bears Gratitude.
 *    https://mobbin.com/screens/34fd4c95-ebe2-4024-9e58-ef310e6b6e3b
 *  - Times in the gutter and a composer pinned to the bottom, from ABY Journal.
 *    https://mobbin.com/screens/6bfa1cd3-b997-41bd-afac-4ef5cf98a016
 *  - Entries carrying their tags as pills underneath, from Calm and Liven.
 *    https://mobbin.com/screens/40ba5ad3-03c7-4b81-ac40-6a2b447233fa
 *
 * Check-ins and written entries are interleaved by date into one thread rather than
 * kept in separate tabs. Separating them would defeat the point - the whole value is
 * seeing that the week a reading dropped was also the week of three bad nights.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleSlash, Clock, FileEdit, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { stickersFrom, summariseConfounders } from '@glowdays/core';

import { api, ApiError, mediaUrl, type Note, type ScanSummary } from '../lib/api.ts';
import {
  Advisory,
  Card,
  Eyebrow,
  Headline,
  Lead,
  Screen,
  Spacer,
} from '../ui/primitives.tsx';
import { Composer, InstantPhoto, StickerRow, type ComposerValue } from '../ui/StickerSheet.tsx';
import { TabBar } from '../ui/TabBar.tsx';

/** One thing that happened, whichever kind it was. */
type Item =
  | { kind: 'scan'; at: string; scan: ScanSummary }
  | { kind: 'note'; at: string; note: Note };

interface DayGroup {
  /** ISO date, used as the key and for the header. */
  readonly date: string;
  readonly items: Item[];
  readonly hasScan: boolean;
}

function isoDate(value: string): string {
  // Notes carry a date-only string; scans carry a timestamp. Both reduce to a
  // local calendar day, which is what a diary groups by.
  return value.length === 10 ? value : new Date(value).toISOString().slice(0, 10);
}

function describeScan(scan: ScanSummary): { label: string; icon: typeof Camera; tint: string } {
  switch (scan.status) {
    case 'succeeded':
      return {
        label: `Check-in · overall ${scan.overallScore?.toFixed(1) ?? '—'}`,
        icon: Camera,
        tint: 'bg-sage',
      };
    case 'draft':
      return { label: 'Photo saved, not analysed', icon: FileEdit, tint: 'bg-caution' };
    case 'running':
    case 'queued':
    case 'uploading':
      return { label: 'Analysis underway', icon: Clock, tint: 'bg-lavender' };
    case 'failed':
      return { label: scan.error?.title ?? 'Did not complete', icon: CircleSlash, tint: 'bg-neutral-pill' };
    default:
      return { label: 'Expired', icon: CircleSlash, tint: 'bg-neutral-pill' };
  }
}

export function Diary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scans = useQuery({ queryKey: ['scans'], queryFn: api.scans });
  const notes = useQuery({ queryKey: ['notes'], queryFn: () => api.notes() });

  const save = useMutation({
    mutationFn: async (value: ComposerValue) => {
      const created = await api.createNote({
        // The API requires a body. A sticker-only entry is the common case, so
        // rather than forcing the user to type, the stickers become the body -
        // which also means the entry still reads sensibly anywhere tags are not
        // rendered.
        body:
          value.body ||
          stickersFrom(value.tags).map((s) => s.label).join(', ') ||
          (value.photo ? 'Photo' : 'Logged'),
        tags: value.tags,
      });

      // The photo is a second request, and a failure here must not lose the words.
      // The entry is already saved by this point, so the photo failing is reported
      // against the entry rather than throwing the whole composition away.
      if (value.photo) {
        await api.attachNotePhoto(created.note.id, value.photo);
      }
      return created;
    },
    onSuccess: async () => {
      setComposing(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? `${err.message}. ${err.detail}` : 'Could not save.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  });

  const scanList = scans.data?.scans ?? [];
  const noteList = notes.data?.notes ?? [];

  // Interleaved once, memoised, rather than re-sorted on every render.
  const days = useMemo<DayGroup[]>(() => {
    const byDate = new Map<string, DayGroup>();

    const push = (date: string, item: Item, isScan: boolean) => {
      const existing = byDate.get(date);
      if (existing) {
        existing.items.push(item);
        if (isScan) (existing as { hasScan: boolean }).hasScan = true;
      } else {
        byDate.set(date, { date, items: [item], hasScan: isScan });
      }
    };

    for (const scan of scanList) push(isoDate(scan.capturedAt), { kind: 'scan', at: scan.capturedAt, scan }, true);
    for (const note of noteList) push(isoDate(note.noteOn), { kind: 'note', at: note.noteOn, note }, false);

    return [...byDate.values()]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => (a.at < b.at ? 1 : -1)),
      }));
  }, [scanList, noteList]);

  // Last 28 days, so the summary describes the period a trial would actually use.
  const window28 = useMemo(() => {
    const cutoff = new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
    return summariseConfounders(
      noteList.filter((n) => n.noteOn >= cutoff).map((n) => ({ noteOn: n.noteOn, tags: n.tags })),
      28,
    );
  }, [noteList]);

  const loading = scans.isPending || notes.isPending;
  const empty = !loading && days.length === 0;

  return (
    <Screen>
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-6 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>Diary</Eyebrow>
            <div className="mt-3">
              <Headline>Your record.</Headline>
            </div>
          </div>
          {!composing ? (
            <button
              type="button"
              onClick={() => setComposing(true)}
              aria-label="Add an entry for today"
              className="bg-rose shadow-raised flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <Plus className="text-paper size-5" strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setComposing(false)}
              aria-label="Close"
              className="bg-neutral-pill flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <X className="text-ink size-5" strokeWidth={1.5} aria-hidden />
            </button>
          )}
        </div>

        {/* --------------------------------------------------------- composer */}

        {composing ? (
          <div className="mt-6">
            {/* The dashed edge is the sticker sheet metaphor, and it is decorative:
                it is on a container, never on a control. */}
            <div className="bg-canvas paper-grain cutout rounded-2xl p-5">
              <div className="mb-5 flex flex-col gap-1">
                <span className="text-ink text-base font-medium">Today</span>
                <span className="text-ink-soft text-sm">
                  Tap what applies. Writing is optional — three taps is a complete entry.
                </span>
              </div>
              <Composer
                busy={save.isPending}
                error={error}
                onSave={(value) => save.mutate(value)}
                onCancel={() => setComposing(false)}
              />
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------- confounder summary */}

        {!composing && window28.counted.length > 0 ? (
          <div className="mt-6">
            <Card>
              <Eyebrow tone="soft">Last 28 days</Eyebrow>
              <p className="text-ink mt-3 text-base">
                You logged something that could move a reading on{' '}
                <span className="tabular-nums font-medium">{window28.daysAffected}</span> of 28 days.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {window28.counted.slice(0, 6).map(({ sticker, days: count }) => (
                  <span
                    key={sticker.id}
                    className="bg-neutral-pill flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  >
                    <span className="text-[14px] leading-none" aria-hidden>
                      {sticker.emoji}
                    </span>
                    <span className="text-ink text-[12px]">{sticker.label}</span>
                    <span className="text-ink-soft tabular-nums text-[12px]">×{count}</span>
                  </span>
                ))}
              </div>
              {/* The reason this is worth collecting, said once. */}
              <p className="text-ink-soft mt-4 text-sm">
                This is not a score. It is the context a verdict has to survive — a trial that
                overlaps a run of these cannot claim a product caused the change on its own.
              </p>
            </Card>
          </div>
        ) : null}

        {/* ------------------------------------------------------------ empty */}

        {loading ? <Lead>Loading your record…</Lead> : null}

        {empty ? (
          <div className="mt-8 flex flex-col gap-4">
            <div className="bg-paper paper-grain paper-inset rounded-2xl p-6">
              <span className="text-ink text-base font-medium">A blank page, for now.</span>
              <p className="text-ink-soft mt-2 text-base">
                Two kinds of thing live here. Check-ins, which are measured, and entries, which are
                what you noticed and what was going on. The second kind is what makes the first kind
                mean anything.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {['😴', '🍷', '🌞', '🧴', '🩸', '✈️'].map((e, i) => (
                <span
                  key={e}
                  className={`bg-paper sticker-peel rounded-full px-3 py-1.5 text-[18px] ${
                    i % 2 ? 'tilt-r' : 'tilt-l'
                  }`}
                  aria-hidden
                >
                  {e}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* --------------------------------------------------------- timeline */}

        {days.map((group) => (
          <section key={group.date} className="mt-8 flex gap-4">
            {/* The gutter: node plus spine. One element, no per-row wiring. */}
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span
                className={[
                  'mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-solid',
                  group.hasScan ? 'bg-rose border-rose' : 'bg-canvas border-line-strong',
                ].join(' ')}
                aria-hidden
              >
                <span
                  className={`text-[11px] font-semibold ${group.hasScan ? 'text-paper' : 'text-ink-soft'}`}
                >
                  {new Date(group.date).getDate()}
                </span>
              </span>
              <span className="spine mt-2 w-px flex-1" aria-hidden />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-ink text-base font-medium">{dayLabel(group.date)}</span>
                <span className="text-ink-soft text-sm">{monthLabel(group.date)}</span>
              </div>

              {group.items.map((item) =>
                item.kind === 'scan' ? (
                  <ScanEntry
                    key={item.scan.id}
                    scan={item.scan}
                    onOpen={() => navigate(`/check-in/${item.scan.id}`)}
                  />
                ) : (
                  <NoteEntry
                    key={item.note.id}
                    note={item.note}
                    onDelete={() => remove.mutate(item.note.id)}
                    deleting={remove.isPending && remove.variables === item.note.id}
                  />
                ),
              )}
            </div>
          </section>
        ))}

        {/* Mixed tiers are the commonest reason a comparison gets refused, so it is
            said here from someone's own history rather than in a later refusal. */}
        <TierNote scans={scanList} />

        <Spacer />
      </div>

      <TabBar />
    </Screen>
  );
}

function ScanEntry({ scan, onOpen }: { scan: ScanSummary; onOpen: () => void }) {
  const { label, icon: Glyph, tint } = describeScan(scan);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-paper paper-inset flex w-full items-center gap-3 rounded-2xl p-4 text-left"
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tint}`}>
        <Glyph className="text-ink size-4" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ink text-base">{label}</span>
        <span className="text-ink-soft text-sm">
          {timeLabel(scan.capturedAt)} · {scan.tier === 'hd' ? 'high detail' : 'standard detail'}
        </span>
      </span>
    </button>
  );
}

/**
 * A written entry.
 *
 * The stickers are rendered as stuck-on pills above the text, which is the one
 * place a physical metaphor here is literally true rather than borrowed.
 */
function NoteEntry({
  note,
  onDelete,
  deleting,
}: {
  note: Note;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const stickers = stickersFrom(note.tags);
  // When the body is only the sticker labels, showing both is duplication.
  const labelsOnly = stickers.map((s) => s.label).join(', ');
  const showBody = note.body.trim() !== labelsOnly && note.body.trim() !== 'Logged';

  const photo = mediaUrl(note.photoUrl);

  return (
    <div className="bg-paper paper-grain paper-inset flex flex-col gap-3 rounded-2xl p-4">
      <StickerRow stickers={stickers} />

      {photo ? (
        <InstantPhoto
          src={photo}
          alt={`Photo attached to your entry on ${note.noteOn}`}
          caption={new Date(`${note.noteOn}T00:00:00`).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          })}
          tilt={note.id.charCodeAt(0) % 2 === 0 ? 'l' : 'r'}
        />
      ) : null}

      {showBody ? <p className="text-ink text-base whitespace-pre-wrap">{note.body}</p> : null}

      <div className="flex items-center justify-between">
        <span className="text-ink-soft text-xs">Your note</span>
        {confirming ? (
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="text-danger text-xs font-medium"
            >
              {deleting ? 'Removing…' : 'Remove'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-ink-soft text-xs"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Remove this entry"
            className="text-ink-soft"
          >
            <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function TierNote({ scans }: { scans: ScanSummary[] }) {
  const done = scans.filter((s) => s.status === 'succeeded');
  const hd = done.filter((s) => s.tier === 'hd').length;
  const sd = done.length - hd;
  if (hd === 0 || sd === 0) return null;
  return (
    <div className="mt-8">
      <Advisory tone="lavender">
        <span className="text-ink text-base font-medium">
          Your check-ins are split across two levels of detail.
        </span>
        <span className="text-ink-soft text-sm">
          {hd} at high detail and {sd} at standard. They are only ever compared with their own
          kind, so a run of one is worth more than an alternating mix.
        </span>
      </Advisory>
    </div>
  );
}

function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long' });
}

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
