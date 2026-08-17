/**
 * Migration runner.
 *
 * Numbered SQL files in ./migrations, applied once, in filename order, each
 * inside a transaction. A ledger table records what ran, with a checksum, so
 * editing an already-applied migration is detected and refused rather than
 * quietly leaving two environments different.
 *
 * Runs against either driver. The embedded one is not a special case worth
 * skipping: if migrations only ever ran against the TCP driver, the SQL would be
 * unverified on the path most likely to be used first.
 *
 * `pnpm --filter @glowdays/api db:migrate`, or add `--status` to list.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', '..', 'migrations');

const PGLITE_SCHEME = 'pglite://';

interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** The narrow surface both drivers are wrapped down to. */
interface Runner {
  /** Statements with no parameters. May contain several separated by `;`. */
  exec(sql: string): Promise<void>;
  applied(): Promise<Map<string, string>>;
  record(name: string, checksum: string): Promise<void>;
  transaction(run: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS _migration (
    name       text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

async function embeddedRunner(url: string): Promise<Runner> {
  const { PGlite } = await import('@electric-sql/pglite');
  const path = url.slice(PGLITE_SCHEME.length) || '.pgdata';
  const client = new PGlite(path);
  await client.waitReady;

  return {
    exec: async (sql) => {
      await client.exec(sql);
    },
    applied: async () => {
      const res = await client.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM _migration',
      );
      return new Map(res.rows.map((r) => [r.name, r.checksum]));
    },
    record: async (name, checksum) => {
      await client.query('INSERT INTO _migration (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
    },
    // PGlite exposes an explicit transaction handle; BEGIN/COMMIT around the
    // whole unit gives the same guarantee without threading it through.
    transaction: async (run) => {
      await client.exec('BEGIN');
      try {
        await run();
        await client.exec('COMMIT');
      } catch (err) {
        await client.exec('ROLLBACK');
        throw err;
      }
    },
    close: () => client.close(),
  };
}

async function tcpRunner(url: string): Promise<Runner> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  return {
    exec: async (statement) => {
      await sql.unsafe(statement);
    },
    applied: async () => {
      const rows = await sql<{ name: string; checksum: string }[]>`
        SELECT name, checksum FROM _migration
      `;
      return new Map(rows.map((r) => [r.name, r.checksum]));
    },
    record: async (name, checksum) => {
      await sql`INSERT INTO _migration (name, checksum) VALUES (${name}, ${checksum})`;
    },
    transaction: async (run) => {
      await sql.unsafe('BEGIN');
      try {
        await run();
        await sql.unsafe('COMMIT');
      } catch (err) {
        await sql.unsafe('ROLLBACK');
        throw err;
      }
    },
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

async function loadMigrations(): Promise<Migration[]> {
  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const out: Migration[] = [];
  for (const name of entries) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    out.push({
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }

  const embedded = url.startsWith(PGLITE_SCHEME);
  console.log(`[migrate] ${embedded ? 'embedded Postgres' : 'Postgres over TCP'}`);

  const runner = embedded ? await embeddedRunner(url) : await tcpRunner(url);

  try {
    await runner.exec(LEDGER);
    const appliedBy = await runner.applied();
    const migrations = await loadMigrations();

    if (process.argv.includes('--status')) {
      for (const m of migrations) {
        const was = appliedBy.get(m.name);
        const state = !was ? 'pending' : was === m.checksum ? 'applied' : 'CHANGED';
        console.log(`${state.padEnd(8)} ${m.name}`);
      }
      return;
    }

    for (const m of migrations) {
      const was = appliedBy.get(m.name);
      if (was === m.checksum) continue;
      if (was) {
        throw new Error(
          `${m.name} has already run but its contents changed. ` +
            'Add a new migration rather than editing this one.',
        );
      }
      console.log(`applying ${m.name}`);
      await runner.transaction(async () => {
        await runner.exec(m.sql);
        await runner.record(m.name, m.checksum);
      });
    }

    console.log(`up to date (${migrations.length} migration(s))`);
  } finally {
    await runner.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
