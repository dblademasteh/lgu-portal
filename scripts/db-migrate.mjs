/**
 * Database migration runner for Docker/production.
 *
 * This script runs migrations without requiring tsx. It reads SQL files from
 * src/lib/db/migrations/ and applies them using a plain PostgreSQL connection.
 *
 * Usage:
 *   node scripts/db-migrate.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'lib', 'db', 'migrations');

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[db] DATABASE_URL not set, skipping migrations');
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
