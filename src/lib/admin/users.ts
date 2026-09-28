/**
 * Server actions for user management.
 */

'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guards';
import { findUserById, findUserByUsername, listAllUsers, isDisabled, type UserRecord } from '@/lib/auth/users';
import { updateUserRecord, lockUserRecord, unlockUserRecord, resetUserMfaRecord } from '@/lib/auth/users';
import { unlockAccount } from '@/lib/auth/lockout';
import type { Role } from '@/lib/auth/users';

/* ------------------------------------------------------------------ */
/* Type definitions                                                     */
/* ------------------------------------------------------------------ */

export type UserFormData = {
  userId: string;
  displayName: string;
  email: string;
  roles: string[];
  locked?: boolean;
  mfaEnabled?: boolean;
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const VALID_ROLES = ['admin', 'supervisor', 'employee', 'auditor'] as const;

function validateForm(data: UserFormData): { ok: true } | { ok: false; error: string; field?: string } {
  if (!data.displayName || data.displayName.length < 2 || data.displayName.length > 128) {
    return { ok: false, error: 'Display name must be 2-128 characters', field: 'displayName' };
  }

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return { ok: false, error: 'Invalid email address', field: 'email' };
  }

  if (!data.roles || data.roles.length === 0) {
    return { ok: false, error: 'At least one role is required', field: 'roles' };
  }
  for (const role of data.roles) {
    if (!VALID_ROLES.includes(role as any)) {
      return { ok: false, error: `Invalid role: ${role}`, field: 'roles' };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Server actions                                                      */
/* ------------------------------------------------------------------ */

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return redirect('/admin/users?error=missing_id');

  const data: UserFormData = {
    userId,
    displayName: String(formData.get('displayName') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim(),
    roles: formData.getAll('roles').map(String),
    locked: formData.get('locked') === 'on',
    mfaEnabled: formData.get('mfaEnabled') === 'on',
  };

  const validation = validateForm(data);
  if (!validation.ok) {
    return redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent(validation.error)}`);
  }

  const user = await findUserById(userId);
  if (!user) return redirect('/admin/users?error=not_found');

  // The form can set `locked`, so it needs the same guard the lockUser action
  // has. Without it an admin could lock themselves out via the edit form.
  if (data.locked && user.id === admin.user.id) {
    return redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent('You cannot lock your own account')}`);
  }

  // Account state is only ever changed through lockUserRecord/unlockUserRecord
  // (plus the lockout counters), so reuse those rather than writing `locked`
  // directly and letting the two ways of locking a user drift apart.
  const wantsLocked = data.locked === true;
  const wasLocked = isDisabled(userId);

  try {
    await updateUserRecord(userId, {
      displayName: data.displayName,
      email: data.email,
      roles: data.roles as Role[],
      mfaEnabled: data.mfaEnabled,
    });

    if (wantsLocked && !wasLocked) await lockUserRecord(userId);
    if (!wantsLocked && wasLocked) {
      await unlockUserRecord(userId);
      await unlockAccount(userId);
    }
  } catch (err) {
    console.error('[admin] updateUser failed', { userId, err });
    return redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent('Update failed, please try again')}`);
  }

  redirect(`/admin/users/${userId}/edit?updated=1`);
}

export async function lockUser(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return redirect('/admin/users?error=missing_id');

  const user = await findUserById(userId);
  if (!user) return redirect('/admin/users?error=not_found');

  // Prevent locking yourself
  if (user.id === admin.user.id) {
    return redirect('/admin/users?error=cannot_lock_self');
  }

  await lockUserRecord(userId);

  redirect('/admin/users?locked=1');
}

export async function unlockUser(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return redirect('/admin/users?error=missing_id');

  await unlockUserRecord(userId);
  await unlockAccount(userId);

  redirect('/admin/users?unlocked=1');
}

export async function resetUserMfa(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const userId = String(formData.get('userId') ?? '');
  if (!userId) return redirect('/admin/users?error=missing_id');

  const user = await findUserById(userId);
  if (!user) return redirect('/admin/users?error=not_found');

  await resetUserMfaRecord(userId);

  redirect(`/admin/users/${userId}/edit?mfa_reset=1`);
}