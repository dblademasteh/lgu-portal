/**
 * Database migrations.
 *
 * Runs SQL files from the migrations directory against the configured
 * PostgreSQL database. Each file is executed in a transaction; failures
 * roll back the transaction but do not block subsequent files.
 *
 * Usage:
 *   npm run db:migrate
 *
 * The migration state is tracked in a `schema_migrations` table; each file
 * is run at most once.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool, query } from './client';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'lib', 'db', 'migrations');

export async function ensureSchema(): Promise<void> {
  const p = await getPool();
  if (!p) return;

  const client = await p.connect();
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

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        console.log(`[db] migration applied: ${file}`);
      } catch (error) {
        console.error(`[db] migration failed: ${file}`, error);
        throw error;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
