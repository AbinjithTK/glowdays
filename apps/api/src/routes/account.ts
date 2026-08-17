/**
 * Account routes.
 *
 * Deletion order matters and is the reason this is not a one-line cascade.
 * Storage objects are removed first, because a deleted database row leaves no
 * record of which keys existed. Get that backwards and the face photographs
 * stay in the bucket with nothing pointing at them.
 *
 * The profile row is tombstoned rather than dropped. A token issued minutes
 * earlier stays valid at the identity provider, and without a tombstone the
 * auth middleware would helpfully create a fresh profile for it - which reads
 * to the user as their deletion having silently failed.
 */

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../db/client.js';
import { entitlement, profile } from '../db/schema.js';
import { currentProfileId, type AppEnv } from '../http/context.js';
import { profilePrefix } from '../storage/index.js';
import { storage } from '../storage/factory.js';

export const accountRoute = new Hono<AppEnv>();

accountRoute.get('/', async (c) => {
  const profileId = currentProfileId(c);
  const principal = c.get('principal');

  const ent = await db()
    .select()
    .from(entitlement)
    .where(eq(entitlement.profileId, profileId))
    .limit(1);

  return c.json({
    profile: {
      id: profileId,
      email: principal.email,
      displayName: principal.displayName,
    },
    // Read from our own projection of the billing webhook, never from a token
    // claim. Two systems both believing they are authoritative on entitlement
    // is how people end up locked out of something they paid for.
    entitlement: ent[0] ?? { entitlementId: null, isActive: false, expiresAt: null },
    privacy: {
      providerRetentionDays: 30,
      resultUrlLifetimeHours: 2,
      signedUrlTtlSeconds: 300,
    },
  });
});

accountRoute.delete('/', async (c) => {
  const profileId = currentProfileId(c);

  const removed = await storage().removePrefix(profilePrefix(profileId));

  await db().transaction(async (tx) => {
    // Everything else cascades from the profile row. Tombstone, do not drop,
    // so a still-valid token cannot recreate the account by accident.
    await tx
      .update(profile)
      .set({ deletedAt: new Date(), email: `deleted+${profileId}@invalid`, displayName: null })
      .where(eq(profile.id, profileId));
  });

  return c.json({
    deleted: true,
    objectsRemoved: removed,
    // Said explicitly. Deletion here cannot reach into the provider, and
    // implying otherwise in a privacy flow would be the worst place to do it.
    note:
      'Your photos, readings and diary are gone from Glowdays. The analysis provider ' +
      'removes its own copies within 30 days of upload, on its own schedule. ' +
      'Sign out to finish.',
    nextStep: 'signed_out',
  });
});
