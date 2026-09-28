import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mock the db client. `dbProbe` decides whether the database is usable;
// `getPool` is kept for the callers that still use it, and `query` is what the
// repository actually issues once the probe succeeds.
vi.mock('./client', () => ({
  getPool: vi.fn(() => Promise.resolve(null)),
  dbProbe: vi.fn(() => Promise.resolve({ configured: false, ok: false, message: 'not set' })),
  query: vi.fn(() => Promise.resolve({ rows: [] })),
}));

import { dbProbe, query } from './client';
const probeMock = vi.mocked(dbProbe);
const queryMock = vi.mocked(query);

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

/**
 * Load a fresh copy of the module with its own probe cache.
 *
 * `isDbAvailable()` memoises for five seconds in module scope, and the static
 * import at the top of this file is shared by every test, so one describe's
 * probe result leaks into the next. Re-importing gives each block a clean
 * cache, and re-reading the mocked client from the same registry means the
 * mocks configured below are the ones the fresh module actually calls.
 */
async function loadFresh() {
  vi.resetModules();
  const users = await import('./users');
  const client = await import('./client');
  return { users, probe: vi.mocked(client.dbProbe), query: vi.mocked(client.query) };
}

const BASE_ROW = {
  id: 'usr_x',
  employee_id: 'E-1',
  username: 'someone',
  email: 'a@b.gov.ph',
  display_name: 'Some One',
  title: null,
  department: 'HRMO',
  roles: ['employee'],
  mfa_enabled: false,
  phone_last4: '0000',
  office: null,
  password_hash: 'scrypt$1$1$1$AAAA$AAAA',
  time_zone: 'Asia/Manila',
  avatar_hue: 0,
  last_sign_in: null,
  failed_attempts: 0,
  locked_until: null,
  disabled: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/**
 * Regression guard: a query error is not "no such user".
 *
 * The helpers already refuse to fall back when the database is *unreachable*,
 * because `requireUsableDb()` probes first. But past that probe they still
 * swallowed every error as `null`/`[]`, so an unmigrated schema, a missing
 * table, or a permissions problem all read as "user does not exist" and the
 * request was answered from the seeded demo directory.
 *
 * That is the state a failed migration leaves behind, and it was reachable in
 * production: with a reachable but empty `users` table, readiness reported
 * `database: pass` while `admin` still signed in on the shared demo password.
 */
describe('when a query fails against a reachable database', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
  });

  async function withFailingQuery() {
    const mod = await loadFresh();
    mod.probe.mockResolvedValue({ configured: true, ok: true, message: 'reachable' });
    mod.query.mockRejectedValue(new Error('relation "users" does not exist'));
    return mod;
  }

  it('does not report a missing table as an unknown user', async () => {
    const { users } = await withFailingQuery();
    await expect(users.findUserByUsernameDb('admin')).rejects.toThrow(/does not exist/);
  });

  it('does not report a missing table as no such id', async () => {
    const { users } = await withFailingQuery();
    await expect(users.findUserByIdDb('usr_8f2a41c7')).rejects.toThrow(/does not exist/);
  });

  it('does not turn a failed listing into an empty directory', async () => {
    const { users } = await withFailingQuery();
    await expect(users.listUsersDb()).rejects.toThrow(/does not exist/);
  });

  it('does not turn a failed authenticate into invalid credentials', async () => {
    const { users } = await withFailingQuery();
    await expect(users.authenticateDb('admin', 'anything')).rejects.toThrow(/does not exist/);
  });

  it('surfaces a failed admin write instead of reporting success', async () => {
    const { users } = await withFailingQuery();
    await expect(users.updateUserRecordDb('usr_8f2a41c7', { displayName: 'X' })).rejects.toThrow(
      /does not exist/,
    );
  });
});

/**
 * Regression guard: "Lock account" used to write nothing.
 *
 * `updateUserRecordDb` accepted a `locked` flag but never added a SET clause for
 * it, so `lockUserRecordDb` built an UPDATE with zero assignments and returned
 * early. The admin console reported "User updated" and the account carried on
 * signing in -- confirmed end to end against a real Postgres. There was also no
 * `disabled` column at all: `disabled` was computed as
 * `user.id === LOCKED_USER_ID`, a seeded demo id, so no real account could be
 * disabled by construction. Migration 003 adds the column.
 */
describe('locking an account', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
  });

  async function withRecordingQuery(rows: unknown[] = []) {
    const mod = await loadFresh();
    const issued: Array<{ text: string; params: unknown[] }> = [];
    mod.probe.mockResolvedValue({ configured: true, ok: true, message: 'reachable' });
    mod.query.mockImplementation((text: string, params?: unknown[]) => {
      issued.push({ text, params: params ?? [] });
      return Promise.resolve({ rows });
    });
    return { ...mod, issued };
  }

  const updateFor = (issued: Array<{ text: string }>) =>
    issued.find((q) => /UPDATE users SET/i.test(q.text));

  it('emits a real UPDATE for the disabled column', async () => {
    const { users, issued } = await withRecordingQuery();
    await users.lockUserRecordDb('usr_real001');
    const update = updateFor(issued);
    expect(update, 'lock must issue an UPDATE').toBeDefined();
    expect(update!.text).toMatch(/disabled\s*=\s*\$\d/);
    expect(issued.find((q) => q.params.includes(true))?.params).toContain('usr_real001');
  });

  it('clears the flag on unlock', async () => {
    const { users, issued } = await withRecordingQuery();
    await users.unlockUserRecordDb('usr_real001');
    expect(updateFor(issued)!.text).toMatch(/disabled\s*=\s*\$\d/);
    expect(issued.find((q) => q.params.includes(false))?.params).toContain('usr_real001');
  });

  it('leaves the flag alone when locked is not supplied', async () => {
    const { users, issued } = await withRecordingQuery();
    await users.updateUserRecordDb('usr_real001', { displayName: 'Renamed' });
    const update = updateFor(issued)!;
    expect(update.text).toMatch(/display_name/);
    expect(update.text).not.toMatch(/disabled/);
  });

  it('reports the disabled column as account state, not a hardcoded id', async () => {
    const { users } = await withRecordingQuery([{ ...BASE_ROW, disabled: true }]);
    const found = await users.findUserByUsernameDb('someone');
    expect(found?.disabled).toBe(true);
  });

  it('exposes disabled as locked in the admin listing', async () => {
    const { users } = await withRecordingQuery([{ ...BASE_ROW, disabled: true }]);
    const listed = await users.listUsersDb();
    expect(listed[0]?.locked).toBe(true);
  });
});

describe('dbIsConfigured', () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('is false with no DATABASE_URL so the demo directory may answer', async () => {
    delete process.env.DATABASE_URL;
    const mod = await loadFresh();
    expect(mod.users.dbIsConfigured()).toBe(false);
  });

  it('is true once DATABASE_URL is set, even if the table is empty', async () => {
    process.env.DATABASE_URL = 'postgres://nobody@127.0.0.1:1/none';
    const mod = await loadFresh();
    expect(mod.users.dbIsConfigured()).toBe(true);
  });
});
