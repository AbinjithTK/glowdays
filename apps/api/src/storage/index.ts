/**
 * Object storage.
 *
 * One interface, two implementations. Local filesystem for development, S3 for
 * deployment. Nothing above this layer knows which is in use, so moving to AWS
 * is a config change rather than a code change.
 *
 * These objects are face photographs. Three rules hold in both drivers:
 *  - Keys are namespaced by profile so a deletion request has a clean prefix.
 *  - Nothing is ever publicly readable. Reads go through a short-lived URL.
 *  - Keys contain a random component, so guessing one is not possible.
 */

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  /** A URL the browser may fetch directly, valid for a short window. */
  signedGetUrl(key: string, ttlSeconds: number): Promise<string>;
  remove(key: string): Promise<void>;
  /** Used by account deletion. Must remove everything under the prefix. */
  removePrefix(prefix: string): Promise<number>;
}

export class ObjectNotFound extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFound';
  }
}

/** `p/<profileId>/scan/<scanId>/original.jpg` and friends. */
export function scanImageKey(profileId: string, scanId: string, ext: string): string {
  return `p/${profileId}/scan/${scanId}/original.${ext}`;
}

export function scanMaskKey(
  profileId: string,
  scanId: string,
  metric: string,
  region: string,
): string {
  return `p/${profileId}/scan/${scanId}/mask/${metric}__${region}.png`;
}

/**
 * `p/<profileId>/note/<noteId>/photo.jpg`.
 *
 * Under the same profile prefix as check-in photos, so the deletion sweep that
 * removes an account's storage picks these up without knowing they exist. Kept in
 * a `note/` branch rather than `scan/` because these are never analysed and the
 * distinction has to be legible from the key alone.
 */
export function notePhotoKey(profileId: string, noteId: string, ext: string): string {
  return `p/${profileId}/note/${noteId}/photo.${ext}`;
}

export function profilePrefix(profileId: string): string {
  return `p/${profileId}/`;
}

/**
 * Reject keys that could escape their namespace. Every key is built by this
 * module, but a traversal bug here would expose other users' faces, so it is
 * checked rather than assumed.
 */
export function assertSafeKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('\0') ||
    !/^[A-Za-z0-9/._-]+$/.test(key)
  ) {
    throw new Error('Unsafe storage key');
  }
}
