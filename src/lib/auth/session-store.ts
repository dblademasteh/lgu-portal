/**
 * Session store contract and backend-independent rules.
 *
 * This module is the seam the README always promised. It holds everything that
 * must behave identically no matter where sessions live: the record shape, the
 * TTL policy, the cookie crypto, and the `SessionStore` interface that both the
 * in-memory and Redis backends implement.
 *
 * It deliberately imports no I/O: no `next/headers`, no `redis`, no `node:crypto`
 * beyond the signing helpers. That keeps it safe to import from anywhere,
 * including code paths where a Redis client would be inappropriate.
 *
 * The single most important thing in this file is `isSessionLive()`. The two
 * previous implementations each re-derived the expiry rule by hand and drifted:
 * the Redis path checked only `expiresAt` (so the 30-minute idle timeout was
 * never enforced server-side) and its touch script rewrote the key with a fresh
 * 8-hour expiry (so the absolute cap could be extended forever by touching).
 * One shared predicate, used by every backend, makes that class of bug
 * impossible to reintroduce.
 */

import { hmac, verifySigned } from './crypto';

export const SESSION_COOKIE = 'lgu_sso_session';

/** Absolute lifetime: a session dies this long after creation, no matter how
 *  often it is renewed. Bounds the damage from an indefinitely-refreshed id. */
export const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
/** Idle timeout: a session dies this long after the last request. */
export const IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** Sliding renewal window: refresh `lastSeenAt` at most this often. */
export const RENEW_AFTER_MS = 60 * 1000; // 1 minute

export const SESSION_POLICY = {
  absoluteTtlMs: ABSOLUTE_TTL_MS,
  idleTtlMs: IDLE_TTL_MS,
  renewAfterMs: RENEW_AFTER_MS,
} as const;

export type Session = {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** Chained on privilege elevation so we can revoke sessions created before it. */
  authTime: number;
  amr: string[]; // authentication methods used, OIDC-style
  mfaVerified: boolean;
  ip?: string;
  userAgent?: string;
};

export type SessionStats = {
  total: number;
  active: number;
  idle: number;
  expired: number;
};

export type SessionLifetime = {
  /** Remaining absolute lifetime. */
  absoluteRemainingMs: number;
  /** Remaining idle budget. */
  idleRemainingMs: number;
  /** Whether the idle timer is the binding constraint. */
  idleIsBinding: boolean;
};

/* ------------------------------------------------------------------ */
/* Lifetime rules — the single source of truth                        */
/* ------------------------------------------------------------------ */

/**
 * Whether a session is still usable, and if not, whether it is worth deleting.
 * Every backend must funnel reads through this. Both constraints apply
 * independently: a session fails on whichever expires first.
 */
export function isSessionLive(session: Session, now: number): boolean {
  if (now >= session.expiresAt) return false;
  if (now - session.lastSeenAt >= IDLE_TTL_MS) return false;
  return true;
}

/**
 * Apply a sliding renewal. The absolute lifetime is a hard ceiling: renewing a
 * session never grants time beyond `createdAt + ABSOLUTE_TTL_MS`.
 */
export function renewSession(session: Session, now: number): Session {
  session.lastSeenAt = now;
  session.expiresAt = Math.min(session.expiresAt, session.createdAt + ABSOLUTE_TTL_MS);
  return session;
}

export function sessionLifetime(session: Session, now = Date.now()): SessionLifetime {
  const absoluteRemainingMs = Math.max(0, session.expiresAt - now);
  const idleRemainingMs = Math.max(0, IDLE_TTL_MS - (now - session.lastSeenAt));
  return {
    absoluteRemainingMs,
    idleRemainingMs,
    idleIsBinding: idleRemainingMs <= absoluteRemainingMs,
  };
}

/** Bucket a session for the admin dashboard. */
export function classifySession(session: Session, now: number): 'active' | 'idle' | 'expired' {
  if (!isSessionLive(session, now)) return 'expired';
  return now - session.lastSeenAt < 5 * 60 * 1000 ? 'active' : 'idle';
}

/* ------------------------------------------------------------------ */
/* Cookie value format: <sessionId>.<hmac>                             */
/* ------------------------------------------------------------------ */

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be set to a random string of at least 32 characters in production.',
    );
  }
  // Development fallback. Deterministic so dev-server HMR keeps sessions valid.
  return 'lgu-portal-development-only-secret-do-not-ship';
}

export function sealSessionCookie(sessionId: string): string {
  return `${sessionId}.${hmac(sessionId, sessionSecret())}`;
}

export function openSessionCookie(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  // Verify before the store lookup: a forged id never reaches the store.
  return verifySigned(id, signature, sessionSecret()) ? id : null;
}

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export type CreateSessionParams = {
  userId: string;
  amr: string[];
  mfaVerified: boolean;
  ip?: string;
  userAgent?: string;
};

export type StoreKind = 'memory' | 'redis';

/**
 * Raised by a backend that cannot serve a request. Lives here rather than in
 * `store-redis.ts` so the facade can catch it without statically importing the
 * Redis client, which would pull `redis` into every route bundle.
 */
export class SessionStoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionStoreUnavailableError';
  }
}

export type StoreProbe = {
  ok: boolean;
  message: string;
  latencyMs: number;
};

export interface SessionStore {
  /** Which backend this is, for logs, metrics, and the readiness payload. */
  readonly kind: StoreKind;
  create(params: CreateSessionParams): Promise<Session>;
  /** Returns null when absent, expired, or idle-timed-out. */
  get(id: string | null | undefined): Promise<Session | null>;
  /** Sliding renewal, clamped to the absolute ceiling. No-op if not live. */
  touch(id: string): Promise<void>;
  destroy(id: string | null | undefined): Promise<void>;
  /** Revoke every session for a user. Returns how many were removed. */
  destroyUserSessions(userId: string): Promise<number>;
  /**
   * Drop sessions that are past their absolute or idle deadline. Returns how
   * many were removed. Backs the admin maintenance control; the stores already
   * self-heal on read, so this only reclaims memory/keyspace eagerly.
   */
  purgeExpired(): Promise<number>;
  listUserSessions(userId: string): Promise<Session[]>;
  stats(): Promise<SessionStats>;
  /** Health check for the readiness endpoint. Must not throw. */
  probe(): Promise<StoreProbe>;
  close(): Promise<void>;
}
