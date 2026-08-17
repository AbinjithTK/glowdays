/**
 * Note routes.
 *
 * Notes may be backdated. Photos may not. A person can reasonably record that
 * their skin stung last Tuesday; they cannot produce last Tuesday's measurement
 * today, and letting them try would corrupt every comparison downstream.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { db } from '../db/client.js';
import { note, scan } from '../db/schema.js';
import { config } from '../env.js';
import { currentProfileId, type AppEnv } from '../http/context.js';
import { AppError } from '../http/problem.js';
import { MAX_IMAGE_BYTES, readImageInfo, UnreadableImage } from '../media/dimensions.js';
import { storage } from '../storage/factory.js';
import { notePhotoKey } from '../storage/index.js';

const NoteBody = z.object({
  body: z.string().trim().min(1).max(2000),
  /** The day the note is about. Defaults to today. Past dates allowed. */
  noteOn: z.string().date().optional(),
  scanId: z.string().uuid().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const notesRoute = new Hono<AppEnv>();

notesRoute.post('/', async (c) => {
  const profileId = currentProfileId(c);
  const input = NoteBody.parse(await c.req.json().catch(() => ({})));

  if (input.noteOn && input.noteOn > today()) {
    throw new AppError('invalid_request', 'That date is in the future');
  }

  if (input.scanId) {
    const owned = await db()
      .select({ id: scan.id })
      .from(scan)
      .where(and(eq(scan.id, input.scanId), eq(scan.profileId, profileId)))
      .limit(1);
    if (!owned[0]) throw new AppError('not_found', 'No such check-in');
  }

  const inserted = await db()
    .insert(note)
    .values({
      profileId,
      scanId: input.scanId ?? null,
      noteOn: input.noteOn ?? today(),
      body: input.body,
      tags: input.tags,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new AppError('internal', 'Note was not saved');
  return c.json({ note: await withPhotoUrl(row) }, 201);
});

/**
 * Attach a photo to an entry.
 *
 * A separate multipart endpoint rather than a field on the create call, because the
 * overwhelmingly common entry is a few sticker taps with no photo at all, and making
 * every one of those a multipart request to carry an absent file would be the wrong
 * default for the frequent case.
 *
 * This photo is never sent to the analyser and never graded. It is a memento, and
 * the consent the user gave covers check-in photographs going to a third party -
 * quietly analysing a snapshot of a rash on their wrist would exceed it.
 */
notesRoute.post('/:id/photo', async (c) => {
  const profileId = currentProfileId(c);
  const noteId = c.req.param('id');

  const owned = await db()
    .select({ id: note.id, imageKey: note.imageKey })
    .from(note)
    .where(and(eq(note.id, noteId), eq(note.profileId, profileId)))
    .limit(1);
  const row = owned[0];
  if (!row) throw new AppError('not_found', 'No such note');

  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) {
    throw new AppError('invalid_request', 'No photo was attached', {
      detail: 'Send the photo as multipart form data under the field name "image".',
    });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError('invalid_request', 'That photo is larger than 10 MB');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Read the header rather than trusting the content type. This is not for a tier
  // decision - there is none here - but a mislabelled file would be stored with the
  // wrong extension and then fail to render in an <img> for no visible reason.
  let info;
  try {
    info = readImageInfo(bytes);
  } catch (err) {
    if (err instanceof UnreadableImage) {
      throw new AppError('invalid_request', 'That file could not be read as an image', {
        detail: err.message,
      });
    }
    throw err;
  }

  const store = storage();
  const key = notePhotoKey(profileId, noteId, info.extension);
  await store.put(key, bytes, info.contentType);

  // Replacing a photo removes the previous object. Without this, every retake
  // leaves an orphan that nothing points at and only account deletion collects.
  if (row.imageKey && row.imageKey !== key) {
    await store.remove(row.imageKey).catch(() => {
      // A failed cleanup must not fail the upload the user just waited for.
    });
  }

  const updated = await db()
    .update(note)
    .set({ imageKey: key })
    .where(and(eq(note.id, noteId), eq(note.profileId, profileId)))
    .returning();

  const saved = updated[0];
  if (!saved) throw new AppError('internal', 'Photo was not attached');

  return c.json({
    note: await withPhotoUrl(saved),
  });
});

/** Presign the entry photo, so the client never sees a storage key. */
async function withPhotoUrl<T extends { imageKey: string | null }>(row: T) {
  const url = row.imageKey
    ? await storage().signedGetUrl(row.imageKey, config().SIGNED_URL_TTL_SECONDS)
    : null;
  const { imageKey: _ignored, ...rest } = row;
  return { ...rest, photoUrl: url };
}

notesRoute.get('/', async (c) => {
  const profileId = currentProfileId(c);
  const from = c.req.query('from');
  const to = c.req.query('to');

  const filters = [eq(note.profileId, profileId)];
  if (from) filters.push(gte(note.noteOn, from));
  if (to) filters.push(lte(note.noteOn, to));

  const rows = await db()
    .select()
    .from(note)
    .where(and(...filters))
    .orderBy(desc(note.noteOn), desc(note.createdAt))
    .limit(500);

  // Presigned in parallel. Serially, a diary of fifty photographed entries would
  // spend fifty round trips before the screen could render.
  return c.json({ notes: await Promise.all(rows.map(withPhotoUrl)) });
});

/** Present so "edit what you logged" has somewhere to go. */
notesRoute.get('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const rows = await db()
    .select()
    .from(note)
    .where(and(eq(note.id, c.req.param('id')), eq(note.profileId, profileId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', 'No such note');
  return c.json({ note: await withPhotoUrl(row) });
});

notesRoute.patch('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const input = NoteBody.partial().parse(await c.req.json().catch(() => ({})));

  if (input.noteOn && input.noteOn > today()) {
    throw new AppError('invalid_request', 'That date is in the future');
  }

  const updated = await db()
    .update(note)
    .set({
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.noteOn !== undefined ? { noteOn: input.noteOn } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    })
    .where(and(eq(note.id, c.req.param('id')), eq(note.profileId, profileId)))
    .returning();

  const row = updated[0];
  if (!row) throw new AppError('not_found', 'No such note');
  return c.json({ note: await withPhotoUrl(row) });
});

notesRoute.delete('/:id', async (c) => {
  const profileId = currentProfileId(c);
  const deleted = await db()
    .delete(note)
    .where(and(eq(note.id, c.req.param('id')), eq(note.profileId, profileId)))
    .returning({ id: note.id, imageKey: note.imageKey });

  const row = deleted[0];
  if (!row) throw new AppError('not_found', 'No such note');

  // The row cascades; the stored object does not. Removed after the delete
  // succeeds, because an object with no row is a harmless orphan whereas a row
  // pointing at nothing is a visibly broken entry.
  if (row.imageKey) {
    await storage()
      .remove(row.imageKey)
      .catch(() => {
        // Reported as deleted regardless: the entry is gone from the user's diary,
        // and a failed object cleanup is ours to fix, not theirs to retry.
      });
  }

  return c.json({ deleted: true });
});
