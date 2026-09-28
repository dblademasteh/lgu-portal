/**
 * Edit a user account.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { findUserById } from '@/lib/auth/users';
import { isDisabled } from '@/lib/auth/users';
import { updateUser, lockUser, unlockUser, resetUserMfa } from '@/lib/admin/users';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Edit User',
};

const ALL_ROLES = ['admin', 'supervisor', 'employee', 'auditor'] as const;

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; updated?: string; mfa_reset?: string; locked?: string; unlocked?: string }>;
}) {
  const admin = await requireAdmin();
  const resolvedParams = await params;
  const user = await findUserById(resolvedParams.id);
  if (!user) {
    redirect('/admin/users?error=not_found');
  }

  const query = await searchParams;

  const locked = isDisabled(user.id);

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Edit User</h1>
          <p className="text-body text-meta">{user.displayName} ({user.username})</p>
        </div>
        <a href="/admin/users" className="btn btn-secondary">
          <Icon name="x" size={16} />
          <span>Cancel</span>
        </a>
      </header>

      {query.error && (
        <div className="alert alert-danger" role="alert">
          {query.error}
        </div>
      )}
      {query.updated && (
        <div className="alert alert-success" role="status">
          User updated successfully.
        </div>
      )}
      {query.mfa_reset && (
        <div className="alert alert-success" role="status">
          MFA reset successfully. The user will need to re-enroll.
        </div>
      )}

      <div className="form-card">
        <form action={updateUser} method="post">
          <input type="hidden" name="userId" value={user.id} />

          <div className="form-group">
            <label htmlFor="displayName" className="form-label">Display Name</label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              required
              className="form-input"
              defaultValue={user.displayName}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email" className="form-label">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="form-input"
              defaultValue={user.email}
            />
          </div>

          <div className="form-group">
            <fieldset>
              <legend className="form-label">Roles</legend>
              <div className="scope-checkboxes">
                {ALL_ROLES.map((role) => (
                  <label key={role} className="checkbox-label">
                    <input
                      type="checkbox"
                      name="roles"
                      value={role}
                      defaultChecked={user.roles.includes(role)}
                    />
                    <span>{role}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" name="locked" defaultChecked={locked} />
              <span>Account Locked</span>
            </label>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" name="mfaEnabled" defaultChecked={user.mfaEnabled} />
              <span>MFA Enabled</span>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <Icon name="save" size={16} />
              <span>Save Changes</span>
            </button>
            <a href="/admin/users" className="btn btn-secondary">
              Cancel
            </a>
          </div>
        </form>
      </div>

      <div className="form-card" style={{ marginTop: 'var(--semantic-space-gap-lg)' }}>
        <h2 className="panel-title">Actions</h2>
        <div className="action-grid">
          {!locked ? (
            <form action={lockUser} method="post">
              <input type="hidden" name="userId" value={user.id} />
              <ConfirmSubmit
                message={`Lock ${user.displayName}? They will not be able to sign in.`}
                className="btn btn-ghost btn-warning"
              >
                <Icon name="lock" size={16} />
                <span>Lock Account</span>
              </ConfirmSubmit>
            </form>
          ) : (
            <form action={unlockUser} method="post">
              <input type="hidden" name="userId" value={user.id} />
              <ConfirmSubmit
                message={`Unlock ${user.displayName}?`}
                className="btn btn-ghost btn-success"
              >
                <Icon name="unlock" size={16} />
                <span>Unlock Account</span>
              </ConfirmSubmit>
            </form>
          )}
          {user.mfaEnabled && (
            <form action={resetUserMfa} method="post">
              <input type="hidden" name="userId" value={user.id} />
              <ConfirmSubmit
                message={`Reset MFA for ${user.displayName}? They will need to re-enroll.`}
                className="btn btn-ghost"
              >
                <Icon name="refresh-cw" size={16} />
                <span>Reset MFA</span>
              </ConfirmSubmit>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
