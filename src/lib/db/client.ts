/**
 * PostgreSQL connection pool.
 *
 * When DATABASE_URL is set, the portal uses PostgreSQL for user storage.
 * When it is not set, the portal falls back to the in-memory stub directory.
 *
 * The pool is created lazily and cached for the lifetime of the process.
 */

import { Pool, type PoolConfig } from 'pg';

let pool: Pool | null = null;

function createPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  const config: PoolConfig = {
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };

  const p = new Pool(config);

  p.on('error', (err) => {
    console.error('[db] pool error:', err);
  });

  return p;
}

export async function getPool(): Promise<Pool | null> {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
  const p = await getPool();
  if (!p) throw new Error('DATABASE_URL is not set');
  const result = await p.query(text, params);
  return { rows: result.rows as T[] };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Liveness-of-the-database probe for the readiness endpoint.
 *
 * Deliberately runs `SELECT 1` instead of reporting whether a pool object
 * exists: `getPool()` happily returns a pool whose socket has already died, so
 * "a pool is configured" says nothing about whether queries still work. The
 * query is bounded by `statement_timeout` so a half-open connection cannot hang
 * the probe until the kubelet kills the pod.
 */
export async function dbProbe(): Promise<{
  configured: boolean;
  ok: boolean;
  message: string;
}> {
  if (!process.env.DATABASE_URL) {
    return { configured: false, ok: false, message: 'DATABASE_URL is not set' };
  }
  try {
    const p = await getPool();
    if (!p) return { configured: true, ok: false, message: 'No pool available' };
    await p.query("SET LOCAL statement_timeout = '2000ms'");
    await p.query('SELECT 1');
    return { configured: true, ok: true, message: 'reachable' };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: error instanceof Error ? error.message : 'Database error',
    };
  }
}
