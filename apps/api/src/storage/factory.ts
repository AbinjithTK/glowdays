/**
 * Picks the storage driver. The one place the choice is made.
 */

import { config } from '../env.js';
import type { StorageAdapter } from './index.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

let cached: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (cached) return cached;
  const c = config();
  if (c.STORAGE_DRIVER === 's3') {
    if (!c.S3_BUCKET) throw new Error('S3_BUCKET missing after validation');
    cached = new S3Storage({
      bucket: c.S3_BUCKET,
      region: c.S3_REGION,
      ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT } : {}),
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
    });
  } else {
    // The local driver signs its own media URLs. In dev the auth secret is
    // already required, so it doubles as the signing key rather than adding
    // another variable to the setup instructions.
    const secret = c.DEV_AUTH_SECRET ?? 'local-development-only-secret';
    cached = new LocalStorage({ dir: c.STORAGE_LOCAL_DIR, secret });
  }
  return cached;
}

/** The local driver only. Returns null under S3, where the route is disabled. */
export function localStorageOrNull(): LocalStorage | null {
  const s = storage();
  return s instanceof LocalStorage ? s : null;
}
