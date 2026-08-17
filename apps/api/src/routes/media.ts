/**
 * Signed media, local driver only.
 *
 * Under S3 the browser fetches a presigned URL straight from the bucket and
 * this route is not mounted. Locally there is no bucket to presign against, so
 * the API serves the bytes itself behind an HMAC token.
 *
 * The token, not the session, authorises this request - the same arrangement S3
 * presigning uses. The consequences are handled deliberately:
 *  - the signature covers the key and the expiry, so neither can be edited
 *  - expiry is checked before the signature comparison
 *  - the comparison is constant-time
 *  - responses are marked private and no-store, so a shared browser cache
 *    cannot hand one person's face to the next
 */

import { Hono } from 'hono';

import { AppError } from '../http/problem.js';
import { localStorageOrNull } from '../storage/factory.js';
import { ObjectNotFound } from '../storage/index.js';

export const mediaRoute = new Hono();

mediaRoute.get('/', async (c) => {
  const store = localStorageOrNull();
  if (!store) throw new AppError('not_found', 'Not available');

  const key = c.req.query('key');
  const expires = Number(c.req.query('expires'));
  const sig = c.req.query('sig');

  if (!key || !sig || !Number.isFinite(expires)) {
    throw new AppError('invalid_request', 'Malformed media link');
  }
  if (!store.verify(key, expires, sig)) {
    throw new AppError('forbidden', 'That link has expired', {
      detail: 'Reload the screen to get a fresh one.',
    });
  }

  try {
    const object = await store.get(key);
    return new Response(object.bytes, {
      headers: {
        'Content-Type': object.contentType,
        'Content-Length': String(object.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof ObjectNotFound) throw new AppError('not_found', 'That file is gone');
    throw err;
  }
});
