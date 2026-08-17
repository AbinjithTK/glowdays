/**
 * Request context and the auth middleware.
 *
 * `requireAuth` does two things: verifies the token, and resolves it to a local
 * profile row, creating one on first sight. Every handler downstream can assume
 * `profileId` exists, which removes the "user might not have a profile yet"
 * branch from every route.
 *
 * The profile lookup is by `auth_uid`, never by email. Emails change, and two
 * accounts arriving at the same address is a real Cognito behaviour when a
 * password sign-up and a Google sign-in share an address without being linked.
 * Keying on the subject means that case produces two profiles rather than one
 * account silently absorbing another person's diary.
 */

import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';

import { bearerFrom, verifyToken, type Principal } from '../auth/verify.js';
import { db, initDb } from '../db/client.js';
import { profile } from '../db/schema.js';
import { AppError } from './problem.js';

export interface AppEnv {
  Variables: {
    principal: Principal;
    profileId: string;
  };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Every authenticated route reads the database, and under Lambda the
  // connection is opened in the background rather than awaited at cold start.
  // Awaiting it here is a no-op once open, and turns a not-yet-connected first
  // request into an honest 503 instead of "Database not initialised".
  try {
    await initDb();
  } catch {
    throw new AppError('internal', 'The service is starting up', {
      detail: 'Nothing was lost. Try again in a moment.',
    });
  }

  const token = bearerFrom(c.req.header('authorization'));
  if (!token) {
    throw new AppError('unauthorised', 'Sign in to continue', {
      detail: 'This endpoint needs a bearer token.',
    });
  }

  let principal: Principal;
  try {
    principal = await verifyToken(token);
  } catch {
    throw new AppError('unauthorised', 'Your session has expired', {
      detail: 'Sign in again to continue.',
    });
  }

  const profileId = await resolveProfile(principal);
  c.set('principal', principal);
  c.set('profileId', profileId);
  await next();
};

async function resolveProfile(principal: Principal): Promise<string> {
  const database = db();
  const existing = await database
    .select({ id: profile.id, deletedAt: profile.deletedAt })
    .from(profile)
    .where(eq(profile.authUid, principal.authUid))
    .limit(1);

  const found = existing[0];
  if (found) {
    if (found.deletedAt) {
      // The account was deleted. A valid token for it must not resurrect data.
      throw new AppError('forbidden', 'This account was deleted', {
        detail: 'Create a new account to start again.',
      });
    }
    return found.id;
  }

  const inserted = await database
    .insert(profile)
    .values({
      authUid: principal.authUid,
      email: principal.email,
      displayName: principal.displayName,
    })
    // Two concurrent first requests would otherwise race on the unique index.
    .onConflictDoNothing({ target: profile.authUid })
    .returning({ id: profile.id });

  const created = inserted[0];
  if (created) return created.id;

  const retry = await database
    .select({ id: profile.id })
    .from(profile)
    .where(eq(profile.authUid, principal.authUid))
    .limit(1);
  const row = retry[0];
  if (!row) throw new AppError('internal', 'Could not create your profile');
  return row.id;
}

/** Typed accessor so handlers do not repeat the cast. */
export function currentProfileId(c: Context<AppEnv>): string {
  return c.get('profileId');
}
