/**
 * Database migration runner for Docker/production.
 *
 * This script runs migrations without requiring tsx. It reads SQL files from
 * src/lib/db/migrations/ and applies them using a plain PostgreSQL connection.
 *
 * Usage:
 *   node scripts/db-migrate.mjs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'lib', 'db', 'migrations');

/**
 * Connect, retrying while the database is still coming up.
 *
 * Migrations are fatal now that the entrypoint does not swallow their exit
 * code, so a database that is not accepting connections yet would crash-loop
 * the pod. Bounded so a genuinely missing database still fails fast and lets
 * Kubernetes restart the pod rather than hanging here forever.
 */
async function connectWithRetry(pool, attempts = 30, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(`[db] not ready (${error.message}); retry ${attempt}/${attempts - 1}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[db] DATABASE_URL not set, skipping migrations');
    return;
  }

  // A missing migrations directory used to surface as a bare ENOENT from
  // readdirSync and, because the entrypoint ignored the exit code, the pod
  // booted against an empty database and served the seeded demo directory.
  // Name the actual cause so a bad image build is obvious.
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(
      `[db] FATAL: migrations directory not found at ${MIGRATIONS_DIR}. ` +
        'The image is missing src/lib/db/migrations -- check the Dockerfile COPY.',
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  const client = await connectWithRetry(pool);
  try {
    await client.query('BEGIN');

    // The deployment runs more than one replica, and every pod runs migrations
    // on boot. Without a lock two pods can both read `schema_migrations`, both
    // decide the same file is unapplied, and the second INSERT hits the primary
    // key and aborts. The advisory lock is transaction-scoped, so it is
    // released by the COMMIT/ROLLBACK below and cannot be orphaned.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('lgu_portal_migrations'))`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        console.log(`[db] migration applied: ${file}`);
        appliedCount++;
      } catch (error) {
        console.error(`[db] migration failed: ${file}`, error.message);
        throw error;
      }
    }

    await client.query('COMMIT');
    if (appliedCount === 0) {
      console.log('[db] no new migrations to apply');
    } else {
      console.log(`[db] applied ${appliedCount} migration(s)`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[db] migration error:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error('[db] fatal:', error);
  process.exit(1);
});
