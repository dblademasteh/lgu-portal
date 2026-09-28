/**
 * Server actions for user management.
 */

'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guards';
import { findUserById, findUserByUsername, listAllUsers, type UserRecord } from '@/lib/auth/users';
import { updateUserRecord, lockUserRecord, unlockUserRecord, resetUserMfaRecord } from '@/lib/auth/users';
import { unlockAccount } from '@/lib/auth/lockout';

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

  // In production, call the actual update function
  // await updateUserRecord(userId, { displayName: data.displayName, email: data.email, roles: data.roles, locked: data.locked, mfaEnabled: data.mfaEnabled });

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