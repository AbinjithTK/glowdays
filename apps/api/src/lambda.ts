/**
 * Lambda entry point.
 *
 * Why Lambda rather than a container: this machine has no Docker, so App Runner
 * from ECR and ECS Fargate are both unavailable, and App Runner's source-repo
 * path needs a GitHub connection authorised in the console. A bundled Lambda
 * behind a Function URL is the one target that is fully scriptable with the AWS
 * CLI alone.
 *
 * The connection is opened at module scope so it survives between invocations on
 * a warm container. Opening one per request would exhaust Postgres the moment
 * concurrency rose.
 *
 * But it is deliberately not awaited here. Awaiting at module scope means a
 * database that is briefly unreachable turns into a cold start that throws, and
 * a throwing initialiser produces an opaque Lambda error with no route left to
 * explain it - /ready could never report the cause, because /ready would never
 * run. Instead the connection is attempted in the background and awaited only by
 * the requests that need it, so liveness still answers and readiness reports the
 * real reason with a 503.
 *
 * There is no VPC. Putting Lambda in one to reach RDS privately would require
 * NAT for the outbound calls to the analysis provider: an extra failure point and
 * a standing cost. The database is reached over TLS instead, which is why env.ts
 * refuses a remote connection string that does not demand it.
 */

import { handle } from 'hono/aws-lambda';

import { initDb } from './db/client.js';
import { config, describeConfig } from './env.js';
import { createApp } from './server.js';

console.log('[glowdays] cold start', describeConfig());
if (config().ENABLE_DEV_ROUTES) {
  console.warn('[glowdays] dev routes are enabled in a deployed function');
}

// Start connecting immediately, so a warm container has it ready, but do not
// block module evaluation on it. initDb() is idempotent and clears its cached
// attempt on failure, so a later request retries rather than inheriting the
// first rejection.
void initDb().catch((err: unknown) => {
  console.error(
    '[glowdays] initial database connection failed, will retry on demand:',
    err instanceof Error ? err.message : err,
  );
});

export const handler = handle(createApp());
