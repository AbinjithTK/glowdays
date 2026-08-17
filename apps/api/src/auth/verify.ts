/**
 * Token verification. The whole of the identity-provider boundary.
 *
 * Two verifiers behind one function. `dev` mints and checks a local HS256 token
 * so the app runs with no cloud account attached. `cognito` verifies RS256
 * against the pool's published keys.
 *
 * Nothing above this file knows which is in use, and config refuses `dev` when
 * NODE_ENV is production, so the local stub cannot reach real users.
 *
 * What is checked, and why each matters:
 *  - signature, against the pool's keys rather than a shared secret
 *  - `iss`, so a token from another pool is rejected
 *  - `token_use`, so an id token cannot be swapped for an access token
 *  - audience or client id, so a token minted for a different app is rejected
 *  - expiry, with no clock tolerance beyond jose's default
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { config } from '../env.js';

export interface Principal {
  /** The identity provider's subject. Stored as `profile.auth_uid`. */
  readonly authUid: string;
  readonly email: string;
  readonly displayName: string | null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ------------------------------------------------------------------ cognito

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function cognitoIssuer(): string {
  const c = config();
  return `https://cognito-idp.${c.COGNITO_REGION}.amazonaws.com/${c.COGNITO_USER_POOL_ID}`;
}

function keySet(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    // jose caches and re-fetches on unknown kid, which is what key rotation
    // needs. Do not replace this with a one-off fetch.
    jwks = createRemoteJWKSet(new URL(`${cognitoIssuer()}/.well-known/jwks.json`));
  }
  return jwks;
}

function stringClaim(payload: JWTPayload, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

async function verifyCognito(token: string): Promise<Principal> {
  const c = config();
  const { payload } = await jwtVerify(token, keySet(), {
    issuer: cognitoIssuer(),
  });

  const tokenUse = stringClaim(payload, 'token_use');
  if (tokenUse !== 'id' && tokenUse !== 'access') {
    throw new AuthError('Unexpected token_use');
  }

  // Cognito puts the app client in `aud` on id tokens and `client_id` on
  // access tokens. Checking only one of the two leaves the other unverified.
  const audience = tokenUse === 'id' ? payload.aud : stringClaim(payload, 'client_id');
  const audienceOk = Array.isArray(audience)
    ? audience.includes(c.COGNITO_CLIENT_ID ?? '')
    : audience === c.COGNITO_CLIENT_ID;
  if (!audienceOk) {
    throw new AuthError('Token was not issued for this application');
  }

  const sub = stringClaim(payload, 'sub');
  if (!sub) throw new AuthError('Token has no subject');

  // An access token carries no email. Callers needing one must send the id
  // token; the profile row is created from that.
  const email = stringClaim(payload, 'email') ?? '';
  return {
    authUid: sub,
    email,
    displayName: stringClaim(payload, 'name') ?? stringClaim(payload, 'given_name'),
  };
}

// ---------------------------------------------------------------------- dev

const DEV_ISSUER = 'glowdays-dev';

function devKey(): Uint8Array {
  const secret = config().DEV_AUTH_SECRET;
  if (!secret) throw new Error('DEV_AUTH_SECRET missing after validation');
  return new TextEncoder().encode(secret);
}

async function verifyDev(token: string): Promise<Principal> {
  const { payload } = await jwtVerify(token, devKey(), {
    issuer: DEV_ISSUER,
    audience: DEV_ISSUER,
  });
  const sub = stringClaim(payload, 'sub');
  if (!sub) throw new AuthError('Token has no subject');
  return {
    authUid: sub,
    email: stringClaim(payload, 'email') ?? `${sub}@example.test`,
    displayName: stringClaim(payload, 'name'),
  };
}

/**
 * Exchange a shared access code for a session, in `demo` mode.
 *
 * The code is compared in constant time. A length check first would leak the
 * length through timing, so both operands are hashed to a fixed size before the
 * comparison - which also lets timingSafeEqual be used at all, since it throws
 * on mismatched lengths.
 */
export async function mintDemoToken(input: { code: string; email: string }): Promise<string> {
  const c = config();
  if (c.AUTH_MODE !== 'demo') throw new AuthError('Demo sign-in is not enabled');
  if (!c.DEMO_ACCESS_CODE) throw new AuthError('Demo sign-in is misconfigured');

  const given = createHash('sha256').update(input.code).digest();
  const expected = createHash('sha256').update(c.DEMO_ACCESS_CODE).digest();
  if (!timingSafeEqual(given, expected)) {
    throw new AuthError('That access code is not right');
  }

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new AuthError('That email address is not valid');
  }

  // The subject is derived from the address, so the same email always reopens
  // the same diary rather than creating a new one on each sign-in.
  return signLocalToken({ authUid: `demo:${email}`, email, ttlSeconds: 60 * 60 * 24 * 30 });
}

/**
 * Mint a local token. Only reachable when AUTH_MODE=dev, which config refuses
 * in production.
 */
export async function mintDevToken(input: {
  authUid: string;
  email: string;
  name?: string;
  ttlSeconds?: number;
}): Promise<string> {
  if (config().AUTH_MODE !== 'dev') {
    throw new AuthError('Dev tokens are disabled');
  }
  return signLocalToken(input);
}

async function signLocalToken(input: {
  authUid: string;
  email: string;
  name?: string;
  ttlSeconds?: number;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    ...(input.name ? { name: input.name } : {}),
    token_use: 'id',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_ISSUER)
    .setSubject(input.authUid)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? 60 * 60 * 24 * 7}s`)
    .sign(devKey());
}

// ------------------------------------------------------------------- public

export async function verifyToken(token: string): Promise<Principal> {
  if (!token) throw new AuthError('Missing token');
  try {
    // `demo` verifies the same locally-signed tokens as `dev`. Only the way they
    // are issued differs: dev hands one to anyone, demo requires the code.
    return config().AUTH_MODE === 'cognito' ? await verifyCognito(token) : await verifyDev(token);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Token rejected');
  }
}

/** `Authorization: Bearer <token>`. Nothing else is accepted. */
export function bearerFrom(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}
