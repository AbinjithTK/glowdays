/**
 * Local filesystem storage for development.
 *
 * The only interesting part is `signedGetUrl`. There is no S3 to presign
 * against, so the API mints a short-lived HMAC token and serves the bytes
 * itself from `GET /media/:key`. That keeps the interface identical to S3 and
 * avoids the tempting shortcut of a static directory, which would make every
 * scan photo readable by anyone who could guess a path.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { assertSafeKey, ObjectNotFound, type StorageAdapter, type StoredObject } from './index.js';

const CONTENT_TYPE_SIDECAR = '.contenttype';

export class LocalStorage implements StorageAdapter {
  private readonly root: string;
  private readonly secret: string;

  constructor(opts: { dir: string; secret: string }) {
    this.root = resolve(opts.dir);
    this.secret = opts.secret;
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    // Belt and braces: even with a validated key, confirm we stayed inside.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Unsafe storage key');
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(path + CONTENT_TYPE_SIDECAR, contentType, 'utf8');
  }

  async get(key: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    try {
      const bytes = await readFile(path);
      let contentType = 'application/octet-stream';
      try {
        contentType = (await readFile(path + CONTENT_TYPE_SIDECAR, 'utf8')).trim();
      } catch {
        // Sidecar is best-effort.
      }
      return { key, bytes: new Uint8Array(bytes), contentType };
    } catch {
      throw new ObjectNotFound(key);
    }
  }

  /**
   * Returns a root-relative URL, not an absolute one.
   *
   * An absolute URL would have to name a host, and the only host this process
   * knows is the one it was configured with - which is `localhost`. On a phone
   * opening the app over the network, `localhost` is the phone, so every photo
   * and every mask would silently fail to load. Returning a path lets the client
   * resolve it against whichever address it actually reached the API on.
   *
   * The S3 driver returns an absolute presigned URL, so clients handle both.
   */
  async signedGetUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, expires);
    const q = new URLSearchParams({ key, expires: String(expires), sig });
    return `/media?${q.toString()}`;
  }

  async remove(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(path + CONTENT_TYPE_SIDECAR, { force: true });
  }

  async removePrefix(prefix: string): Promise<number> {
    const path = this.pathFor(prefix.replace(/\/+$/, ''));
    await rm(path, { recursive: true, force: true });
    // The filesystem driver deletes the tree in one call, so an exact object
    // count is not available. Callers treat this as "removed".
    return 1;
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.secret).update(`${key}:${expires}`).digest('base64url');
  }

  /** Used by the media route. Constant-time compare, expiry checked first. */
  verify(key: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    let expected: Buffer;
    try {
      assertSafeKey(key);
      expected = Buffer.from(this.sign(key, expires), 'utf8');
    } catch {
      return false;
    }
    const given = Buffer.from(sig, 'utf8');
    if (expected.length !== given.length) return false;
    return timingSafeEqual(expected, given);
  }
}
