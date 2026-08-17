/**
 * Database client. Two drivers behind one function.
 *
 * `postgres://…`  - postgres.js over TCP. Neon locally, RDS in deployment.
 * `pglite://path` - Postgres compiled to WebAssembly, running in this process
 *                   and persisting to a directory.
 *
 * The embedded driver exists because the machine this was built on has no
 * Docker, no Postgres and nothing listening on 5432. Without it, getting from a
 * clean checkout to a clickable app requires a cloud signup first, which means
 * the app cannot be demonstrated offline and a reviewer hits a setup wall before
 * they see a screen.
 *
 * It is real Postgres, not a mock: the same SQL, the same partial unique index
 * on the active trial, the same enums. The one difference that matters is that
 * it is single-connection and in-process, so it is for development only and the
 * URL scheme makes that impossible to confuse with production.
 *
 * Note the import is dynamic. Production never loads the WebAssembly build.
 */

import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { config } from '../env.js';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzlePg<typeof schema>>;

export const PGLITE_SCHEME = 'pglite://';

export function isEmbedded(url: string): boolean {
  return url.startsWith(PGLITE_SCHEME);
}

/** `pglite://.pgdata` -> `.pgdata`. A relative path is resolved by PGlite. */
export function embeddedPath(url: string): string {
  const raw = url.slice(PGLITE_SCHEME.length);
  return raw === '' ? '.pgdata' : raw;
}

let closeCurrent: (() => Promise<void>) | null = null;
let database: Database | null = null;
let pending: Promise<Database> | null = null;

function poolSize(): number {
  // One connection per instance once this runs in Lambda. Many function
  // instances each holding a pool is the standard way to exhaust Postgres.
  return process.env['AWS_LAMBDA_FUNCTION_NAME'] ? 1 : 5;
}

async function connect(): Promise<Database> {
  const url = config().DATABASE_URL;

  if (isEmbedded(url)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite(embeddedPath(url));
    await client.waitReady;
    closeCurrent = () => client.close();
    // The two drivers produce structurally identical query builders; the cast
    // keeps one Database type for every caller rather than a union nobody wants.
    return drizzle(client, { schema }) as unknown as Database;
  }

  const sql = postgres(url, {
    max: poolSize(),
    idle_timeout: 20,
    connect_timeout: 10,
    // Required when a pooler such as PgBouncer sits in front in transaction mode.
    prepare: false,
    onnotice: () => {},
  });
  closeCurrent = async () => {
    await sql.end({ timeout: 5 });
  };
  return drizzlePg(sql, { schema });
}

/**
 * Open the connection. Async because the embedded driver has to boot WebAssembly
 * before it can answer, and pretending otherwise would mean a first request that
 * races the database into existence.
 */
export async function initDb(): Promise<Database> {
  if (database) return database;
  // Concurrent callers share one connection attempt rather than opening several.
  pending ??= connect().then(
    (db) => {
      database = db;
      pending = null;
      return db;
    },
    (err: unknown) => {
      // Clearing the cached attempt on failure is the whole point. Leaving a
      // rejected promise in place means one transient outage at startup poisons
      // the process permanently: every later call awaits the same rejection and
      // never retries, so a database that came back thirty seconds later would
      // never be noticed. On Lambda that is a container serving errors until it
      // is recycled.
      pending = null;
      throw err;
    },
  );
  return pending;
}

/**
 * The synchronous accessor every route uses. `initDb()` runs at boot, so by the
 * time a request arrives this is already resolved. Throwing rather than silently
 * connecting keeps the failure at startup, where it is legible.
 */
export function db(): Database {
  if (!database) {
    throw new Error('Database not initialised. Call initDb() during startup.');
  }
  return database;
}

export async function closeDb(): Promise<void> {
  if (closeCurrent) await closeCurrent();
  closeCurrent = null;
  database = null;
  pending = null;
}

export { schema };
