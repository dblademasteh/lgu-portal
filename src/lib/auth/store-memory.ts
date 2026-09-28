/**
 * In-memory session backend.
 *
 * The default when no `REDIS_URL` is configured. Correct for local development
 * and single-instance demos; NOT correct for production, because it is
 * non-durable (a restart signs everyone out) and per-instance (a load balancer
 * needs sticky sessions). `REDIS_URL` switches the facade to the Redis backend,
 * which removes both limitations.
 */

import {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  classifySession,
  isSessionLive,
  renewSession,
  type CreateSessionParams,
  type Session,
  type SessionStats,
  type SessionStore,
  type StoreProbe,
} from './session-store';
import { randomToken } from './crypto';

const sessions = new Map<string, Session>();

/** How often the lazy sweeper runs, in writes. */
const SWEEP_EVERY = 50;
let writesSinceSweep = 0;

/** Drop dead sessions so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [id, session] of sessions) {
    if (!isSessionLive(session, now)) sessions.delete(id);
  }
}

function maybeSweep(now: number): void {
  writesSinceSweep += 1;
  if (writesSinceSweep < SWEEP_EVERY) return;
  writesSinceSweep = 0;
  sweep(now);
}

export const memoryStore: SessionStore = {
  kind: 'memory',

  async create(params: CreateSessionParams): Promise<Session> {
    const now = Date.now();
    maybeSweep(now);
    const session: Session = {
      id: randomToken(32),
      userId: params.userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ABSOLUTE_TTL_MS,
      authTime: now,
      amr: params.amr,
      mfaVerified: params.mfaVerified,
      ip: params.ip,
      userAgent: params.userAgent,
    };
    sessions.set(session.id, session);
    return session;
  },

  async get(id: string | null | undefined): Promise<Session | null> {
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    if (!isSessionLive(session, Date.now())) {
      sessions.delete(id);
      return null;
    }
    return session;
  },

  async touch(id: string): Promise<void> {
    const session = sessions.get(id);
    if (!session) return;
    const now = Date.now();
    if (!isSessionLive(session, now)) {
      sessions.delete(id);
      return;
    }
    renewSession(session, now);
  },

  async destroy(id: string | null | undefined): Promise<void> {
    if (id) sessions.delete(id);
  },

  async destroyUserSessions(userId: string): Promise<number> {
    let removed = 0;
    for (const [id, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(id);
        removed++;
      }
    }
    return removed;
  },

  async purgeExpired(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, session] of sessions) {
      if (!isSessionLive(session, now)) {
        sessions.delete(id);
        removed++;
      }
    }
    return removed;
  },

  async listUserSessions(userId: string): Promise<Session[]> {
    const now = Date.now();
    return [...sessions.values()]
      .filter((session) => session.userId === userId && isSessionLive(session, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },

  async listAllSessions(): Promise<Session[]> {
    const now = Date.now();
    return [...sessions.values()]
      .filter((session) => isSessionLive(session, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },

  async stats(): Promise<SessionStats> {
    const now = Date.now();
    let active = 0;
    let idle = 0;
    let expired = 0;
    for (const session of sessions.values()) {
      const bucket = classifySession(session, now);
      if (bucket === 'active') active += 1;
      else if (bucket === 'idle') idle += 1;
      else expired += 1;
    }
    return { total: active + idle + expired, active, idle, expired };
  },

  async probe(): Promise<StoreProbe> {
    const start = Date.now();
    sweep(Date.now());
    return {
      ok: true,
      message: `in-memory store (${sessions.size} sessions, idle TTL ${IDLE_TTL_MS / 60000}m, non-durable)`,
      latencyMs: Date.now() - start,
    };
  },

  async close(): Promise<void> {
    sessions.clear();
  },
};
