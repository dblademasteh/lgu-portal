import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findUserByUsernameDb,
  findUserByIdDb,
  listUsersDb,
  authenticateDb,
  updateUserRecordDb,
  lockUserRecordDb,
  unlockUserRecordDb,
  resetUserMfaRecordDb,
  syncIdPUserDb,
} from './users';

// Mock the db client. `dbProbe` is what decides whether a database is usable;
// `getPool` is kept for the callers that still use it.
vi.mock('./client', () => ({
  getPool: vi.fn(() => Promise.resolve(null)),
  dbProbe: vi.fn(() => Promise.resolve({ configured: false, ok: false, message: 'not set' })),
}));

import { dbProbe } from './client';
const probeMock = vi.mocked(dbProbe);

describe('db users', () => {
  beforeEach(() => {
    vi.resetModules();
    probeMock.mockReset();
    probeMock.mockResolvedValue({ configured: false, ok: false, message: 'not set' });
    delete process.env.DATABASE_URL;
  });

  it('returns null when DATABASE_URL is not set', async () => {
    const result = await findUserByUsernameDb('admin');
    expect(result).toBeNull();
  });

  it('findUserById returns null when DATABASE_URL is not set', async () => {
    const result = await findUserByIdDb('usr_8f2a41c7');
    expect(result).toBeNull();
  });

  it('listUsers returns empty array when DATABASE_URL is not set', async () => {
    const result = await listUsersDb();
    expect(result).toEqual([]);
  });

  it('authenticate returns null when DATABASE_URL is not set', async () => {
    const result = await authenticateDb('admin', 'password');
    expect(result).toBeNull();
  });

  it('updateUserRecord does not throw when DATABASE_URL is not set', async () => {
    await expect(updateUserRecordDb('usr_8f2a41c7', { locked: true })).resolves.toBeUndefined();
  });

  it('lockUserRecord does not throw when DATABASE_URL is not set', async () => {
    await expect(lockUserRecordDb('usr_8f2a41c7')).resolves.toBeUndefined();
  });

  it('unlockUserRecord does not throw when DATABASE_URL is not set', async () => {
    await expect(unlockUserRecordDb('usr_8f2a41c7')).resolves.toBeUndefined();
  });

  it('resetUserMfaRecord does not throw when DATABASE_URL is not set', async () => {
    await expect(resetUserMfaRecordDb('usr_8f2a41c7')).resolves.toBeUndefined();
  });

  it('syncIdPUser throws when DATABASE_URL is not set', async () => {
    await expect(syncIdPUserDb({ sub: 'test-sub', email: 'test@example.com' })).rejects.toThrow('Database not available');
  });
});

/**
 * Regression guard for the demo-directory auth bypass.
 *
 * Every `*Db` helper returns null when the database is unusable, and the caller
 * in `lib/auth/users.ts` treats null as "not found" and then answers from the
 * seeded demo directory. With `DATABASE_URL` configured but the database down,
 * that meant every lookup missed and anyone who knew the shared demo password
 * was handed an authenticated admin session — taking the database offline was
 * enough to bypass authentication. Verified end to end: login returned 200 with
 * `status: authenticated` before this guard.
 */
describe('when a database is configured but unreachable', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
    probeMock.mockReset();
    probeMock.mockResolvedValue({ configured: true, ok: false, message: 'connect ECONNREFUSED' });
  });

  it('refuses to serve the demo directory on a username lookup', async () => {
    await expect(findUserByUsernameDb('admin')).rejects.toThrow(/Refusing to serve the demo directory/);
  });

  it('refuses on an id lookup', async () => {
    await expect(findUserByIdDb('usr_8f2a41c7')).rejects.toThrow(/Refusing to serve the demo directory/);
  });

  it('refuses on listUsers', async () => {
    await expect(listUsersDb()).rejects.toThrow(/Refusing to serve the demo directory/);
  });

  it('refuses on authenticate rather than falling through to the seed', async () => {
    await expect(authenticateDb('admin', 'any-password')).rejects.toThrow(
      /Refusing to serve the demo directory/,
    );
  });

  it('refuses writes too, so a failed admin save is not silently dropped', async () => {
    await expect(updateUserRecordDb('usr_8f2a41c7', { locked: true })).rejects.toThrow(
      /Refusing to serve the demo directory/,
    );
  });

  it('re-probes after the cache TTL so a recovered database is noticed', async () => {
    // A probe result cached for the process lifetime would mean one transient
    // blip pinned the portal to the demo directory forever. Drive the clock
    // instead of sleeping so the TTL boundary is actually exercised.
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);

    probeMock.mockResolvedValue({ configured: true, ok: true, message: 'reachable' });
    vi.resetModules();
    const mod = await import('./users');

    await mod.listUsersDb();
    const afterFirst = probeMock.mock.calls.length;

    // Database goes down, but inside the TTL the cached result is reused.
    probeMock.mockResolvedValue({ configured: true, ok: false, message: 'down' });
    now += 1_000;
    await mod.listUsersDb();
    expect(probeMock.mock.calls.length).toBe(afterFirst);
    await expect(mod.listUsersDb()).resolves.toEqual([]);

    // Past the TTL the result is re-read, and the outage is now visible.
    now += 6_000;
    await expect(mod.listUsersDb()).rejects.toThrow(/Refusing to serve the demo directory/);
    expect(probeMock.mock.calls.length).toBe(afterFirst + 1);

    clock.mockRestore();
  });
});
