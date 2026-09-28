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

// Mock the db client
vi.mock('./client', () => ({
  getPool: vi.fn(() => Promise.resolve(null)),
}));

describe('db users', () => {
  beforeEach(() => {
    vi.resetModules();
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
