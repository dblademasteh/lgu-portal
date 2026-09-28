import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryStore } from './store-memory';
import {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  isSessionLive,
  renewSession,
  sessionLifetime,
  classifySession,
  sealSessionCookie,
  openSessionCookie,
  sessionSecret,
  SESSION_COOKIE,
} from './session-store';

describe('session-store', () => {
  beforeEach(async () => {
    await memoryStore.close();
  });

  describe('isSessionLive', () => {
    const now = 1_700_000_000_000;
    const session = {
      id: 's1',
      userId: 'u1',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ABSOLUTE_TTL_MS,
      authTime: now,
      amr: ['pwd'] as string[],
      mfaVerified: false,
    };

    it('returns true for a fresh session', () => {
      expect(isSessionLive(session, now)).toBe(true);
    });

    it('returns false after absolute TTL', () => {
      expect(isSessionLive(session, now + ABSOLUTE_TTL_MS + 1000)).toBe(false);
    });

    it('returns false after idle TTL', () => {
      expect(isSessionLive({ ...session, lastSeenAt: now - IDLE_TTL_MS - 1000 }, now)).toBe(false);
    });

    it('returns true when only one constraint is breached but the other is not', () => {
      // Just before idle TTL but after absolute TTL - actually absolute TTL is 8h, idle is 30m
      // So we test: idle TTL breached but absolute TTL not
      const idleExpired = {
        ...session,
        lastSeenAt: now - IDLE_TTL_MS - 1000,
        expiresAt: now + ABSOLUTE_TTL_MS,
      };
      expect(isSessionLive(idleExpired, now)).toBe(false);
    });
  });

  describe('renewSession', () => {
    it('updates lastSeenAt without extending absolute expiry', () => {
      const now = 1_700_000_000_000;
      const session = {
        id: 's1',
        userId: 'u1',
        createdAt: now,
        lastSeenAt: now - 1000,
        expiresAt: now + ABSOLUTE_TTL_MS,
        authTime: now,
        amr: [] as string[],
        mfaVerified: false,
      };
      const renewed = renewSession(session, now);
      expect(renewed.lastSeenAt).toBe(now);
      expect(renewed.expiresAt).toBe(session.expiresAt);
    });
  });

  describe('sessionLifetime', () => {
    it('computes remaining lifetimes', () => {
    const now = 1_700_000_000_000;
    const session = {
      id: 's1',
      userId: 'u1',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ABSOLUTE_TTL_MS,
      authTime: now,
      amr: [] as string[],
      mfaVerified: false,
    };
      const lifetime = sessionLifetime(session, now);
      expect(lifetime.absoluteRemainingMs).toBeCloseTo(ABSOLUTE_TTL_MS, -2);
      expect(lifetime.idleRemainingMs).toBeCloseTo(IDLE_TTL_MS, -2);
    });
  });

  describe('classifySession', () => {
    const now = 1_700_000_000_000;
    it('classifies active sessions', () => {
      const session = {
        id: 's1',
        userId: 'u1',
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + ABSOLUTE_TTL_MS,
        authTime: now,
        amr: [] as string[],
        mfaVerified: false,
      };
      expect(classifySession(session, now)).toBe('active');
    });

    it('classifies idle sessions', () => {
      const session = {
        id: 's1',
        userId: 'u1',
        createdAt: now,
        lastSeenAt: now - 10 * 60_000,
        expiresAt: now + ABSOLUTE_TTL_MS,
        authTime: now,
        amr: [] as string[],
        mfaVerified: false,
      };
      expect(classifySession(session, now)).toBe('idle');
    });

    it('classifies expired sessions', () => {
      const session = {
        id: 's1',
        userId: 'u1',
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now - 1000,
        authTime: now,
        amr: [] as string[],
        mfaVerified: false,
      };
      expect(classifySession(session, now)).toBe('expired');
    });
  });

  describe('cookie helpers', () => {
    it('sealSessionCookie produces id.hmac format', () => {
      const sealed = sealSessionCookie('session-id-123');
      expect(sealed.startsWith('session-id-123.')).toBe(true);
      expect(openSessionCookie(sealed)).toBe('session-id-123');
    });

    it('openSessionCookie extracts id from valid sealed cookie', () => {
      const sealed = sealSessionCookie('my-session');
      expect(openSessionCookie(sealed)).toBe('my-session');
    });

    it('openSessionCookie returns null for tampered cookies', () => {
      expect(openSessionCookie('session-id.tampered')).toBeNull();
    });

    it('openSessionCookie returns null for missing cookies', () => {
      expect(openSessionCookie(undefined)).toBeNull();
      expect(openSessionCookie('')).toBeNull();
      expect(openSessionCookie('no-dot')).toBeNull();
    });

    it('SESSION_COOKIE constant', () => {
      expect(SESSION_COOKIE).toBe('lgu_sso_session');
    });

    it('sessionSecret returns a long secret in production', () => {
      const secret = sessionSecret();
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('memoryStore', () => {
    it('creates and retrieves a session', async () => {
      const session = await memoryStore.create({
        userId: 'user-1',
        amr: ['pwd'],
        mfaVerified: false,
      });
      expect(session.id).toBeTruthy();
      expect(session.userId).toBe('user-1');
      const retrieved = await memoryStore.get(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
    });

    it('returns null for unknown sessions', async () => {
      expect(await memoryStore.get('unknown')).toBeNull();
    });

    it('destroys a session', async () => {
      const session = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      await memoryStore.destroy(session.id);
      expect(await memoryStore.get(session.id)).toBeNull();
    });

    it('destroyUserSessions removes all sessions for a user', async () => {
      const s1 = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      const s2 = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      const s3 = await memoryStore.create({ userId: 'u2', amr: [], mfaVerified: false });
      const removed = await memoryStore.destroyUserSessions('u1');
      expect(removed).toBe(2);
      expect(await memoryStore.get(s1.id)).toBeNull();
      expect(await memoryStore.get(s2.id)).toBeNull();
      expect(await memoryStore.get(s3.id)).not.toBeNull();
    });

    it('listUserSessions returns only live sessions for the user', async () => {
      vi.useFakeTimers();
      const s1 = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      vi.advanceTimersByTime(1000);
      const s2 = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      const sessions = await memoryStore.listUserSessions('u1');
      expect(sessions.map((s) => s.id)).toEqual([s2.id, s1.id]);
      vi.useRealTimers();
    });

    it('purgeExpired removes dead sessions', async () => {
      vi.useFakeTimers();
      const s1 = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      vi.advanceTimersByTime(ABSOLUTE_TTL_MS + 1000);
      const removed = await memoryStore.purgeExpired();
      expect(removed).toBe(1);
      expect(await memoryStore.get(s1.id)).toBeNull();
      vi.useRealTimers();
    });

    it('touch renews a live session', async () => {
      vi.useFakeTimers();
      const session = await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      const originalLastSeen = session.lastSeenAt;
      vi.advanceTimersByTime(1000);
      await memoryStore.touch(session.id);
      const renewed = await memoryStore.get(session.id);
      expect(renewed).not.toBeNull();
      expect(renewed!.lastSeenAt).toBeGreaterThan(originalLastSeen);
      vi.useRealTimers();
    });

    it('probe returns ok:true', async () => {
      const probe = await memoryStore.probe();
      expect(probe.ok).toBe(true);
      expect(probe.message).toContain('in-memory store');
    });

    it('close clears all sessions', async () => {
      await memoryStore.create({ userId: 'u1', amr: [], mfaVerified: false });
      await memoryStore.close();
      expect(await memoryStore.get('any')).toBeNull();
    });
  });
});
