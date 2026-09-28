/**
 * Redis-backed session store.
 *
 * Selected automatically when `REDIS_URL` is set (see `sessions.ts`). This is
 * the production backend: it survives restarts and is shared across replicas,
 * which removes both the durability and the sticky-session problems of the
 * in-memory default.
 *
 * Differences from the previous `sessions-redis.ts`, all of them bug fixes:
 *
 *  1. Idle timeout is enforced. The old `get` only checked `expiresAt`, so a
 *     session that was abandoned still validated for its full 8 hours.
 *  2. Touch can no longer extend the absolute lifetime. The old Lua script
 *     rewrote the key with a fresh 8-hour `EX` on every request, so an
 *     indefinitely-refreshed id never died — defeating the whole point of the
 *     absolute cap. The renewal is now clamped to `createdAt + ABSOLUTE_TTL_MS`.
 *  3. Key TTL tracks remaining absolute lifetime rather than a constant, so
 *     Redis evicts on its own instead of accumulating dead records.
 *  4. Per-user index (`sess:user:<id>`) replaces a full-keyspace `SCAN` on
 *     every list/revoke. The old code read every session in the database to
 *     answer "what does this user have open?".
 *
 * Both constraints are delegated to `isSessionLive`/`renewSession` so this file
 * cannot drift from the in-memory backend again.
 */

import { createClient } from 'redis';
import { randomToken } from './crypto';
import {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  classifySession,
  isSessionLive,
  SessionStoreUnavailableError,
  type CreateSessionParams,
  type Session,
  type SessionStats,
  type SessionStore,
  type StoreProbe,
} from './session-store';

const SESSION_PREFIX = 'sess:session:';
const USER_INDEX_PREFIX = 'sess:user:';

/** The client type `createClient` actually returns, without the modular generics. */
type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;
let connecting: Promise<RedisClient> | null = null;

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new SessionStoreUnavailableError('REDIS_URL is not set');
  return url;
}

/**
 * Atomic sliding renewal. Enforces the idle timeout, clamps the absolute
 * lifetime, and sets a TTL matching the remaining absolute time. Runs server-side
 * so concurrent requests cannot interleave a read-modify-write.
 */
const TOUCH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local session = cjson.decode(raw)
local now = tonumber(ARGV[1])
local idleTtl = tonumber(ARGV[2])
local absoluteTtl = tonumber(ARGV[3])

if now >= session.expiresAt or (now - session.lastSeenAt) >= idleTtl then
  redis.call('DEL', KEYS[1])
  return nil
end

session.lastSeenAt = now
local ceiling = session.createdAt + absoluteTtl
if session.expiresAt > ceiling then
  session.expiresAt = ceiling
end

local ttl = math.floor((session.expiresAt - now) / 1000)
if ttl < 1 then ttl = 1 end
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ttl)
return cjson.encode(session)
`;

/**
 * Ceiling for a single Redis round trip. node-redis has no command timeout of
 * its own: without this a half-open socket (peer gone, no RST) parks the
 * request until the client is torn down, and the caller never reaches the
 * memory fallback in the facade.
 */
const OPERATION_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SessionStoreUnavailableError(`${label} timed out after ${OPERATION_TIMEOUT_MS}ms`)),
      OPERATION_TIMEOUT_MS,
    );
    // The losing promise can still settle after we have rejected; keep a
    // handler attached so it never becomes an unhandled rejection.
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Drop a client that timed out so the next call reconnects from scratch. */
function discardClient(): void {
  const stale = client;
  client = null;
  if (stale?.isOpen) void stale.disconnect().catch(() => {});
}

async function getClient(): Promise<RedisClient> {
  // Reuse a client that is still open even while node-redis reconnects it.
  // Requiring `isReady` here allocated a fresh client on every call during an
  // outage, leaking a socket per request; with `disableOfflineQueue` the
  // reused client rejects instead, which `guard` turns into a fallback.
  if (client?.isOpen) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const created = createClient({
      url: redisUrl(),
      // Without this, commands issued while disconnected are queued and only
      // flushed on reconnect — so a dead Redis hangs requests forever instead
      // of failing fast into the memory fallback.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        // Bounded backoff; the facade falls back to memory if this never lands.
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
      },
    });
    // Without a listener, an emitted error is an unhandled 'error' event.
    created.on('error', () => {
      /* surfaced through probe() instead */
    });
    try {
      await withTimeout(created.connect(), 'Redis connect');
    } catch (error) {
      // Tear the half-open socket down; `disconnect` exists in redis v4 where
      // `destroy` does not.
      await created.disconnect().catch(() => {});
      throw error instanceof SessionStoreUnavailableError
        ? error
        : new SessionStoreUnavailableError(
            error instanceof Error ? error.message : 'Redis connection failed',
            { cause: error },
          );
    }
    client = created;
    return created;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

function sessionKey(id: string): string {
  return `${SESSION_PREFIX}${id}`;
}

function userIndexKey(userId: string): string {
  return `${USER_INDEX_PREFIX}${userId}`;
}

/** Wrap a Redis call so failures surface as "unavailable" rather than 500s. */
async function guard<T>(operation: string, run: (redis: RedisClient) => Promise<T>): Promise<T> {
  let redis: RedisClient;
  try {
    redis = await getClient();
  } catch (error) {
    throw error instanceof SessionStoreUnavailableError
      ? error
      : new SessionStoreUnavailableError(`Redis unreachable for ${operation}`, { cause: error });
  }
  try {
    return await withTimeout(run(redis), `Redis ${operation}`);
  } catch (error) {
    // A timeout means the socket may be wedged rather than merely busy, so
    // discard the client and let the next call rebuild the connection.
    if (error instanceof SessionStoreUnavailableError) discardClient();
    throw error instanceof SessionStoreUnavailableError
      ? error
      : new SessionStoreUnavailableError(`Redis ${operation} failed`, { cause: error });
  }
}

export const redisStore: SessionStore = {
  kind: 'redis',

  async create(params: CreateSessionParams): Promise<Session> {
    const now = Date.now();
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
    const ttlSec = Math.ceil(ABSOLUTE_TTL_MS / 1000);
    await guard('createSession', async (redis) => {
      const index = userIndexKey(session.userId);
      await redis.setEx(sessionKey(session.id), ttlSec, JSON.stringify(session));
      await redis.sAdd(index, session.id);
      // The index only needs to outlive the longest session it points at.
      await redis.expire(index, ttlSec);
    });
    return session;
  },

  async get(id: string | null | undefined): Promise<Session | null> {
    if (!id) return null;
    const raw = await guard('getSession', (redis) => redis.get(sessionKey(id)));
    if (!raw) return null;
    let session: Session;
    try {
      session = JSON.parse(raw) as Session;
    } catch {
      return null;
    }
    if (!isSessionLive(session, Date.now())) {
      // Self-healing: evict anything that outlived its policy.
      await redisStore.destroy(id);
      return null;
    }
    return session;
  },

  async touch(id: string): Promise<void> {
    await guard('touchSession', async (redis) => {
      await redis.eval(TOUCH_SCRIPT, {
        keys: [sessionKey(id)],
        arguments: [String(Date.now()), String(IDLE_TTL_MS), String(ABSOLUTE_TTL_MS)],
      });
    });
  },

  async destroy(id: string | null | undefined): Promise<void> {
    if (!id) return;
    await guard('destroySession', async (redis) => {
      const raw = await redis.get(sessionKey(id));
      await redis.del(sessionKey(id));
      if (!raw) return;
      try {
        const session = JSON.parse(raw) as Session;
        await redis.sRem(userIndexKey(session.userId), id);
      } catch {
        /* unparseable record: the session key is gone, which is what matters */
      }
    });
  },

  async destroyUserSessions(userId: string): Promise<number> {
    return guard('destroyUserSessions', async (redis) => {
      const index = userIndexKey(userId);
      const ids = await redis.sMembers(index);
      if (ids.length === 0) return 0;
      const keys = ids.map(sessionKey);
      await redis.del(keys);
      await redis.del(index);
      return ids.length;
    });
  },

  async listUserSessions(userId: string): Promise<Session[]> {
    const now = Date.now();
    return guard('listUserSessions', async (redis) => {
      const index = userIndexKey(userId);
      const ids = await redis.sMembers(index);
      if (ids.length === 0) return [];
      const rows = await redis.mGet(ids.map(sessionKey));
      const live: Session[] = [];
      const dead: string[] = [];
      ids.forEach((id, i) => {
        const raw = rows[i];
        if (!raw) {
          dead.push(id);
          return;
        }
        try {
          const session = JSON.parse(raw) as Session;
          if (isSessionLive(session, now)) live.push(session);
          else dead.push(id);
        } catch {
          dead.push(id);
        }
      });
      if (dead.length > 0) {
        await redis.sRem(index, dead);
        await redis.del(dead.map(sessionKey));
      }
      return live.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    });
  },

  async listAllSessions(): Promise<Session[]> {
    const now = Date.now();
    return guard('listAllSessions', async (redis) => {
      let cursor = 0;
      const live: Session[] = [];
      const dead: string[] = [];
      do {
        const page = await redis.scan(cursor, { MATCH: `${SESSION_PREFIX}*`, COUNT: 200 });
        cursor = page.cursor;
        for (const key of page.keys) {
          const raw = await redis.get(key);
          if (!raw) continue;
          try {
            const session = JSON.parse(raw) as Session;
            if (isSessionLive(session, now)) live.push(session);
            else dead.push(key.slice(SESSION_PREFIX.length));
          } catch {
            dead.push(key.slice(SESSION_PREFIX.length));
          }
        }
      } while (cursor !== 0);
      if (dead.length > 0) {
        await redis.del(dead.map(sessionKey));
      }
      return live.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    });
  },

  async purgeExpired(): Promise<number> {
    const now = Date.now();
    return guard('purgeExpiredSessions', async (redis) => {
      let cursor = 0;
      const dead: string[] = [];
      do {
        const page = await redis.scan(cursor, { MATCH: `${SESSION_PREFIX}*`, COUNT: 200 });
        cursor = page.cursor;
        for (const key of page.keys) {
          const raw = await redis.get(key);
          // A key with no value expired on its own between the SCAN and the
          // GET; Redis reaps it, so there is nothing left to delete.
          if (!raw) continue;
          try {
            const session = JSON.parse(raw) as Session;
            if (!isSessionLive(session, now)) dead.push(session.id);
          } catch {
            // Unparseable record: reclaim it, it can never be used again.
            dead.push(key.slice(SESSION_PREFIX.length));
          }
        }
      } while (cursor !== 0);
      if (dead.length === 0) return 0;
      // Drop the records and their index members together, otherwise the
      // per-user sets accumulate ids that no longer resolve.
      const byUser = new Map<string, string[]>();
      for (const id of dead) {
        const raw = await redis.get(sessionKey(id));
        if (!raw) continue;
        try {
          const session = JSON.parse(raw) as Session;
          const list = byUser.get(session.userId) ?? [];
          list.push(id);
          byUser.set(session.userId, list);
        } catch {
          /* unknown owner; the record is still deleted below */
        }
      }
      await redis.del(dead.map(sessionKey));
      for (const [userId, ids] of byUser) {
        await redis.sRem(userIndexKey(userId), ids);
      }
      return dead.length;
    });
  },

  async stats(): Promise<SessionStats> {
    const now = Date.now();
    return guard('getSessionStats', async (redis) => {
      let cursor = 0;
      let active = 0;
      let idle = 0;
      let expired = 0;
      do {
        // Match only session records; the `sess:user:*` index sets are skipped.
        const page = await redis.scan(cursor, { MATCH: `${SESSION_PREFIX}*`, COUNT: 200 });
        cursor = page.cursor;
        for (const key of page.keys) {
          const raw = await redis.get(key);
          if (!raw) continue;
          try {
            const bucket = classifySession(JSON.parse(raw) as Session, now);
            if (bucket === 'active') active += 1;
            else if (bucket === 'idle') idle += 1;
            else expired += 1;
          } catch {
            expired += 1;
          }
        }
      } while (cursor !== 0);
      return { total: active + idle + expired, active, idle, expired };
    });
  },

  async probe(): Promise<StoreProbe> {
    const start = Date.now();
    try {
      const redis = await getClient();
      // Bounded: an unreachable Redis must report `degraded`, never hang the
      // readiness probe and with it the whole liveness/readiness contract.
      await withTimeout(redis.ping(), 'Redis ping');
      return {
        ok: true,
        message: `Redis reachable at ${redisUrl().replace(/\/\/[^@]*@/, '//***@')}`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError) discardClient();
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Redis unreachable',
        latencyMs: Date.now() - start,
      };
    }
  },

  async close(): Promise<void> {
    if (client?.isOpen) await client.quit();
    client = null;
  },
};
