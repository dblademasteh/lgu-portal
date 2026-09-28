import { describe, it, expect } from 'vitest';
import { ROLES, listUsers, findUserByUsername, findUserById, isDisabled, LOCKED_USER_ID } from './users';

describe('users module', () => {
  it('ROLES contains all expected roles', () => {
    expect(ROLES).toEqual(['employee', 'supervisor', 'admin', 'auditor']);
  });

  it('listUsers returns all seeded users without password hashes', async () => {
    const users = await listUsers();
    expect(users.length).toBeGreaterThanOrEqual(5);
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash');
    }
  });

  it('findUserByUsername returns the correct user', async () => {
    const found = await findUserByUsername('admin');
    expect(found).not.toBeNull();
    expect(found!.user.username).toBe('admin');
    expect(found!.disabled).toBe(false);
  });

  it('findUserByUsername returns null for unknown user', async () => {
    expect(await findUserByUsername('nonexistent')).toBeNull();
  });

  it('findUserById returns user by id', async () => {
    const user = await findUserById('usr_8f2a41c7');
    expect(user).not.toBeNull();
    expect(user!.username).toBe('admin');
  });

  it('isDisabled returns true for locked user', () => {
    expect(isDisabled(LOCKED_USER_ID)).toBe(true);
  });

  it('isDisabled returns false for active user', () => {
    expect(isDisabled('usr_8f2a41c7')).toBe(false);
  });
});
