import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the admin `updateUser` server action.
 *
 * The action validated the submitted form, then had the real update call
 * commented out and redirected with `?updated=1` regardless. Admins saw a
 * success banner while none of their changes were persisted. These tests mock
 * the persistence layer so the wiring itself — the thing that was broken — is
 * what gets asserted.
 */

const redirectMock = vi.fn();
const updateUserRecord = vi.fn();
const lockUserRecord = vi.fn();
const unlockUserRecord = vi.fn();
const unlockAccount = vi.fn();
const findUserById = vi.fn();
const isDisabled = vi.fn();

const ADMIN_ID = 'usr_admin';

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectMock(url);
    throw new RedirectError(url);
  },
}));

vi.mock('@/lib/admin/guards', () => ({
  requireAdmin: async () => ({ user: { id: ADMIN_ID } }),
}));

vi.mock('@/lib/auth/lockout', () => ({
  unlockAccount: (...args: unknown[]) => unlockAccount(...args),
}));

vi.mock('@/lib/auth/users', () => ({
  findUserById: (...args: unknown[]) => findUserById(...args),
  updateUserRecord: (...args: unknown[]) => updateUserRecord(...args),
  lockUserRecord: (...args: unknown[]) => lockUserRecord(...args),
  unlockUserRecord: (...args: unknown[]) => unlockUserRecord(...args),
  isDisabled: (...args: unknown[]) => isDisabled(...args),
  findUserByUsername: vi.fn(),
  listAllUsers: vi.fn(() => []),
}));

function form(over: Record<string, string | string[] | undefined> = {}) {
  const fd = new FormData();
  fd.set('userId', 'usr_target');
  fd.set('displayName', 'Updated Name');
  fd.set('email', 'updated@lgu.gov.ph');
  for (const r of (over.roles as string[]) ?? ['employee', 'auditor']) fd.append('roles', r);
  for (const [k, v] of Object.entries(over)) {
    if (k === 'roles' || v === undefined) continue;
    fd.set(k, v as string);
  }
  return fd;
}

async function run(fd: FormData) {
  const mod = await import('./users');
  try {
    await mod.updateUser(fd);
  } catch (err) {
    if (err instanceof RedirectError) return err.url;
    throw err;
  }
  return null;
}

describe('admin updateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUserById.mockResolvedValue({ id: 'usr_target', displayName: 'Old', email: 'old@lgu.gov.ph' });
    isDisabled.mockReturnValue(false);
    updateUserRecord.mockResolvedValue(undefined);
  });

  it('persists the submitted changes', async () => {
    const url = await run(form());

    expect(updateUserRecord).toHaveBeenCalledTimes(1);
    const [userId, patch] = updateUserRecord.mock.calls[0] as [string, Record<string, unknown>];
    expect(userId).toBe('usr_target');
    expect(patch).toMatchObject({
      displayName: 'Updated Name',
      email: 'updated@lgu.gov.ph',
      roles: ['employee', 'auditor'],
    });
    expect(url).toBe('/admin/users/usr_target/edit?updated=1');
  });

  it('does not report success when the update throws', async () => {
    updateUserRecord.mockRejectedValue(new Error('db down'));

    const url = await run(form());

    expect(url).toBe('/admin/users/usr_target/edit?error=Update%20failed%2C%20please%20try%20again');
    expect(url).not.toContain('updated=1');
  });

  it('does not write anything when validation fails', async () => {
    const url = await run(form({ email: 'not-an-email' }));

    expect(updateUserRecord).not.toHaveBeenCalled();
    expect(url).toContain('error=');
    expect(url).not.toContain('updated=1');
  });

  it('rejects an unknown user instead of writing', async () => {
    findUserById.mockResolvedValue(null);

    const url = await run(form());

    expect(updateUserRecord).not.toHaveBeenCalled();
    expect(url).toBe('/admin/users?error=not_found');
  });

  it('prevents an admin locking their own account through the edit form', async () => {
    findUserById.mockResolvedValue({ id: ADMIN_ID, displayName: 'Admin' });

    const url = await run(form({ locked: 'on' }));

    expect(lockUserRecord).not.toHaveBeenCalled();
    expect(url).toContain('cannot%20lock%20your%20own%20account');
  });

  it('locks a previously unlocked account', async () => {
    isDisabled.mockReturnValue(false);

    const url = await run(form({ locked: 'on' }));

    expect(lockUserRecord).toHaveBeenCalledWith('usr_target');
    expect(unlockUserRecord).not.toHaveBeenCalled();
    expect(url).toContain('updated=1');
  });

  it('unlocks a previously locked account and clears lockout counters', async () => {
    isDisabled.mockReturnValue(true);

    const url = await run(form({ locked: undefined }));

    expect(unlockUserRecord).toHaveBeenCalledWith('usr_target');
    expect(unlockAccount).toHaveBeenCalledWith('usr_target');
    expect(lockUserRecord).not.toHaveBeenCalled();
    expect(url).toContain('updated=1');
  });

  it('does not re-issue a lock that is already in place', async () => {
    isDisabled.mockReturnValue(true);

    await run(form({ locked: 'on' }));

    expect(lockUserRecord).not.toHaveBeenCalled();
    expect(unlockUserRecord).not.toHaveBeenCalled();
  });
});
