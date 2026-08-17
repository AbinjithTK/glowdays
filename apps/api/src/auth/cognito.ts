/**
 * Cognito sign-up and sign-in.
 *
 * Uses Cognito's JSON API over fetch rather than the AWS SDK. Every operation
 * here is unauthenticated - SignUp, InitiateAuth and the refresh flow need no
 * SigV4 signature, only the app client id - so the SDK would add roughly a
 * megabyte to the bundle and a cold-start cost to sign four requests that do not
 * require signing.
 *
 * These run on the server rather than in the browser so the app keeps its own
 * sign-in screen instead of Cognito's hosted pages. The password crosses one TLS
 * hop to us and one to Cognito, and is never written down: not logged, not
 * stored, not in an error message.
 *
 * The tokens are returned to the client, which sends the id token as a bearer
 * credential. verify.ts checks it against the pool's published keys, so this
 * file issuing them and that file trusting them are independent.
 */

import { config } from '../env.js';
import { AppError } from '../http/problem.js';

interface Tokens {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresIn: number;
}

function endpoint(): string {
  return `https://cognito-idp.${config().COGNITO_REGION}.amazonaws.com/`;
}

function clientId(): string {
  const id = config().COGNITO_CLIENT_ID;
  if (!id) throw new Error('COGNITO_CLIENT_ID missing after validation');
  return id;
}

interface CognitoFailure {
  readonly __type?: string;
  readonly message?: string;
}

/**
 * Map Cognito's error types to something a person can act on.
 *
 * Two deliberate choices. Sign-in failures never distinguish "no such user" from
 * "wrong password", because that difference lets anyone enumerate who has an
 * account - the pool sets PreventUserExistenceErrors for the same reason, and
 * undoing it here would defeat that. And the raw Cognito message is never
 * forwarded: it leaks pool internals and reads like a stack trace.
 */
function present(type: string | undefined, fallback: string): AppError {
  switch (type) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return new AppError('unauthorised', 'That email and password do not match', {
        detail: 'Check both and try again.',
      });
    case 'UsernameExistsException':
      return new AppError('conflict', 'There is already a diary for that email', {
        detail: 'Sign in instead, or use a different address.',
      });
    case 'InvalidPasswordException':
      return new AppError('invalid_request', 'That password is too weak', {
        detail: 'At least 10 characters, with a lowercase letter and a number.',
      });
    case 'InvalidParameterException':
      return new AppError('invalid_request', 'That email does not look right');
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return new AppError('rate_limited', 'Too many attempts', {
        detail: 'Wait a minute and try again.',
      });
    case 'UserNotConfirmedException':
      // Should not happen: the pool auto-confirms via a PreSignUp trigger.
      return new AppError('forbidden', 'That account is not confirmed yet');
    default:
      return new AppError('internal', fallback);
  }
}

async function call<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const failure = (payload ?? {}) as CognitoFailure;
    // `__type` arrives as either `Name` or `com.amazonaws...#Name`.
    const type = failure.__type?.split('#').pop();
    // Logged without the request body, which holds the password.
    console.warn(`[cognito] ${action} failed: ${type ?? res.status}`);
    throw present(type, 'Sign-in is unavailable at the moment');
  }

  return payload as T;
}

interface AuthResponse {
  AuthenticationResult?: {
    IdToken?: string;
    AccessToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  };
  ChallengeName?: string;
}

function tokensFrom(response: AuthResponse): Tokens {
  if (response.ChallengeName) {
    // No challenge flow is configured, so this means the pool changed under us.
    throw new AppError('internal', 'This account needs a step we do not support yet', {
      detail: `Cognito asked for ${response.ChallengeName}.`,
    });
  }
  const result = response.AuthenticationResult;
  if (!result?.IdToken || !result.AccessToken) {
    throw new AppError('internal', 'Sign-in did not return a session');
  }
  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken ?? null,
    expiresIn: result.ExpiresIn ?? 3600,
  };
}

export async function signUp(email: string, password: string): Promise<void> {
  await call('SignUp', {
    ClientId: clientId(),
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  // No confirmation step. The pool's PreSignUp trigger auto-confirms, so there
  // is no verification email to wait for and no code to enter.
}

export async function signIn(email: string, password: string): Promise<Tokens> {
  const response = await call<AuthResponse>('InitiateAuth', {
    ClientId: clientId(),
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  return tokensFrom(response);
}

export async function refresh(refreshToken: string): Promise<Tokens> {
  const response = await call<AuthResponse>('InitiateAuth', {
    ClientId: clientId(),
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  const tokens = tokensFrom(response);
  // A refresh response omits the refresh token; the caller keeps the one it has.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export type { Tokens };
