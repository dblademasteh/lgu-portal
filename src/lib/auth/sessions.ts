/**
 * Server-side session store (public API).
 *
 * This is the module the rest of the app imports. It owns the cookie helpers and
 * delegates every record operation to a `SessionStore` backend chosen at
 * startup, so the session layer no longer assumes an in-process `Map`.
 *
 * Backend selection:
 *   SESSION_STORE=memory  -> in-memory, regardless of REDIS_URL (explicit pin)
 *   REDIS_URL set         -> Redis (durable, shared across replicas)
 *   neither               -> in-memory (development default)
 *
 * Failure policy: if the Redis backend errors, the call degrades to the
 * in-memory store rather than 500ing. That is deliberately fail-closed — a
 * session we cannot look up cannot be checked against revocations, so an
 * in-flight request is treated as signed out rather than trusted. Users are
 * asked to sign in again; nobody is admitted on an unverifiable session. Every
 * degradation is logged and reflected by `storeProbe()` for the readiness
 * endpoint.
 *
 * Degradation is not permanent. After a failure the store retries Redis on a
 * bounded exponential backoff (2s doubling to 30s), driven by incoming requests
 * rather than a timer, and promotes itself back to the durable backend as soon
 * as a probe succeeds. Sessions created in memory during the outage are not
 * migrated, so those users sign in again.
 *
 * What is real here and should be preserved in production:
 *  - opaque 256-bit session ids (no data or identity in the cookie)
 *  - HMAC-SHA256 signed cookies, so a tampered id is rejected before any
 *    store lookup happens
 *  - httpOnly + SameSite=Lax + Secure, so the cookie is not readable by script
 *    and is not sent on cross-site POSTs
 *  - absolute lifetime plus sliding renewal, both enforced in the store
 *  - server-side revocation on logout
 */

import { cookies } from 'next/headers';
import { logger } from '@/lib/logging';
import {
  ABSOLUTE_TTL_MS,
  SESSION_COOKIE,
  SessionStoreUnavailableError,
  type CreateSessionParams,
  type Session,
  type SessionStats,
  type SessionStore,
  type StoreKind,
  type StoreProbe,
  sealSessionCookie,
  openSessionCookie,
} from './session-store';
import { memoryStore } from './store-memory';

export {
  SESSION_COOKIE,
  SESSION_POLICY,
  sessionLifetime,
  sealSessionCookie,
  openSessionCookie,
  sessionSecret,
  isSessionLive,
} from './session-store';
export type { Session, SessionStats, SessionLifetime, StoreKind, StoreProbe } from './session-store';

/* ------------------------------------------------------------------ */
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

let storePromise: Promise<SessionStore> | null = null;
/**
 * Set when Redis failed. This must not latch: a transient Redis blip would
 * otherwise pin the process to non-durable memory until it is restarted, so a
 * bounded backoff re-attempts the connection on later requests instead.
 */
let degraded = false;
let degradeAttempts = 0;
let nextDegradeRetryAt = 0;
let recovering: Promise<SessionStore | null> | null = null;

const DEGRADE_RETRY_BASE_MS = 2_000;
const DEGRADE_RETRY_MAX_MS = 30_000;

function wantsRedis(): boolean {
  const pinned = process.env.SESSION_STORE?.toLowerCase();
  if (pinned === 'memory') return false;
  if (pinned === 'redis') return true;
  return Boolean(process.env.REDIS_URL);
}

function scheduleDegradeRetry(): void {
  degradeAttempts += 1;
  const delay = Math.min(
    DEGRADE_RETRY_BASE_MS * 2 ** (degradeAttempts - 1),
    DEGRADE_RETRY_MAX_MS,
  );
  nextDegradeRetryAt = Date.now() + delay;
}

function markDegraded(context: Record<string, unknown>, message: string, reason: string): void {
  degraded = true;
  scheduleDegradeRetry();
  logger.error(
    { ...context, reason, retryInMs: Math.max(0, nextDegradeRetryAt - Date.now()) },
    message,
  );
}

/**
 * Re-attempt Redis once per backoff window, so the store heals itself after a
 * transient outage instead of staying degraded until the process restarts.
 * Single-flight: concurrent requests share one probe. Returns null while Redis
 * is still down or the next attempt is not yet due.
 */
function recoverIfDue(): Promise<SessionStore | null> | null {
  if (!degraded || !wantsRedis()) return null;
  if (Date.now() < nextDegradeRetryAt) return null;
  if (recovering) return recovering;

  const attempt = (async (): Promise<SessionStore | null> => {
    try {
      const { redisStore } = await import('./store-redis');
      const probe = await redisStore.probe();
      if (!probe.ok) throw new Error(probe.message);
      degraded = false;
      degradeAttempts = 0;
      storePromise = Promise.resolve(redisStore);
      logger.info(
        { backend: 'redis' },
        'Redis recovered; session store back on durable backend (in-memory sessions from the outage are not migrated, affected users must sign in again)',
      );
      return redisStore;
    } catch (error) {
      scheduleDegradeRetry();
      logger.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'Redis still unavailable; staying on in-memory sessions',
      );
      return null;
    }
  })();

  recovering = attempt;
  void attempt.finally(() => {
    if (recovering === attempt) recovering = null;
  });
  return attempt;
}

async function resolveStore(): Promise<SessionStore> {
  if (!wantsRedis()) return memoryStore;

  try {
    // Imported lazily so memory-only deployments never load the Redis client.
    const { redisStore } = await import('./store-redis');
    // Force a connection now rather than on the first user request, so a
    // misconfigured REDIS_URL surfaces at boot instead of at sign-in.
    const probe = await redisStore.probe();
    if (!probe.ok) throw new Error(probe.message);
    logger.info({ backend: 'redis' }, 'session store ready');
    return redisStore;
  } catch (error) {
    markDegraded(
      { backend: 'memory' },
      'Redis unavailable at startup; degrading sessions to non-durable in-memory store',
      error instanceof Error ? error.message : String(error),
    );
    return memoryStore;
  }
}

async function store(): Promise<SessionStore> {
  if (degraded) {
    const recovered = await recoverIfDue();
    return recovered ?? memoryStore;
  }
  if (!storePromise) storePromise = resolveStore();
  return storePromise;
}

/**
 * Run `operation` against the active store, degrading to memory if Redis fails.
 * `onDegrade` labels the log line with what was attempted.
 */
async function withFallback<T>(
  operation: string,
  run: (active: SessionStore) => Promise<T>,
  onDegrade: (active: SessionStore) => Promise<T>,
): Promise<T> {
  const active = await store();
  try {
    return await run(active);
  } catch (error) {
    if (!(error instanceof SessionStoreUnavailableError) || active.kind === 'memory') throw error;
    markDegraded(
      { operation },
      'session store unavailable mid-request; degrading to in-memory for this operation',
      error.message,
    );
    return onDegrade(memoryStore);
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function createSession(params: CreateSessionParams): Promise<Session> {
  return withFallback('createSession', (s) => s.create(params), (s) => s.create(params));
}

export async function getSession(id: string | null | undefined): Promise<Session | null> {
  return withFallback('getSession', (s) => s.get(id), (s) => s.get(id));
}

export async function touchSession(id: string): Promise<void> {
  return withFallback('touchSession', (s) => s.touch(id), (s) => s.touch(id));
}

export async function destroySession(id: string | null | undefined): Promise<void> {
  return withFallback('destroySession', (s) => s.destroy(id), (s) => s.destroy(id));
}

/** Revoke every session for a user. Used on password change / account disable. */
export async function destroyUserSessions(userId: string): Promise<number> {
  return withFallback(
    'destroyUserSessions',
    (s) => s.destroyUserSessions(userId),
    (s) => s.destroyUserSessions(userId),
  );
}

export async function listUserSessions(userId: string): Promise<Session[]> {
  return withFallback('listUserSessions', (s) => s.listUserSessions(userId), (s) =>
    s.listUserSessions(userId),
  );
}

/* ------------------------------------------------------------------ */
/* Stats + health (admin, readiness)                                   */
/* ------------------------------------------------------------------ */

export async function getSessionStats(): Promise<SessionStats> {
  return withFallback('getSessionStats', (s) => s.stats(), (s) => s.stats());
}

/** Reclaim sessions past their absolute or idle deadline. */
export async function purgeExpiredSessions(): Promise<number> {
  return withFallback('purgeExpiredSessions', (s) => s.purgeExpired(), (s) => s.purgeExpired());
}

/** Which backend is actually serving, and is it degraded? */
export async function storeProbe(): Promise<
  StoreProbe & { kind: StoreKind; degraded: boolean; configured: 'redis' | 'memory' }
> {
  const configured: 'redis' | 'memory' = wantsRedis() ? 'redis' : 'memory';
  const active = await store();
  if (active.kind === 'memory') {
    return {
      ok: configured === 'memory',
      kind: 'memory',
      degraded: configured === 'redis',
      configured,
      message:
        configured === 'redis'
          ? 'degraded: Redis configured but unavailable, serving non-durable in-memory sessions'
          : 'in-memory store (non-durable; set REDIS_URL for production)',
      latencyMs: 0,
    };
  }
  const probe = await active.probe();
  return { ...probe, kind: 'redis', degraded: false, configured };
}

/* ------------------------------------------------------------------ */
/* Cookie access                                                       */
/* ------------------------------------------------------------------ */

export async function setSessionCookie(session: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sealSessionCookie(session.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Read and validate the current session from the request cookies. */
export async function readSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const id = openSessionCookie(cookieStore.get(SESSION_COOKIE)?.value);
  const session = await getSession(id);
  if (session) await touchSession(session.id);
  return session;
}
