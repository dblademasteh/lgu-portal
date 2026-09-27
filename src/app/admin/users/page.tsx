/**
 * Users Management — list, roles, lock/unlock, MFA reset.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { findUserById, findUserByUsername, listAllUsers, type UserRecord } from '@/lib/auth/users';
import { updateUser, lockUser, unlockUser, resetUserMfa } from '@/lib/admin/users';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill, GrantPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import type { IconKey } from '@/lib/systems';
import { clsx } from 'clsx';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Users',
};

export default async function UsersPage() {
  const admin = await requireAdmin();
  const users = await listAllUsers();

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Users</h1>
          <p className="text-body text-meta">Manage portal accounts, roles, and access.</p>
        </div>
      </header>

      {users.length === 0 ? (
        <EmptyState
          icon="users"
          title="No users"
          description="No user accounts exist in the portal."
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" role="grid">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Roles</th>
                <th scope="col">MFA</th>
                <th scope="col">Status</th>
                <th scope="col">Last Sign-in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <div>
                        <span className="user-name">{user.displayName}</span>
                          <span className="user-meta mono">{user.username} &lt;{user.email}&gt;</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="role-list">
                      {user.roles.map((role) => (
                        <GrantPill key={role}>{role}</GrantPill>
                      ))}
                    </div>
                  </td>
                  <td>
                    {user.mfaEnabled ? (
                      <StatusPill status="operational" label="Enabled" />
                    ) : (
                      <StatusPill status="degraded" label="Disabled" />
                    )}
                  </td>
                  <td>
                    {user.locked ? (
                      <StatusPill status="maintenance" label="Locked" />
                    ) : (
                      <StatusPill status="operational" label="Active" />
                    )}
                  </td>
                  <td className="mono text-meta">
                    {user.lastSignIn ? new Date(user.lastSignIn).toLocaleString() : 'Never'}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <a href={`/admin/users/${user.id}/edit`} className="btn btn-ghost btn-sm">
                        <Icon name="edit" size={14} />
                        <span>Edit</span>
                      </a>
                      {!user.locked && (
                        <form action={lockUser} method="post">
                          <input type="hidden" name="userId" value={user.id} />
                          <ConfirmSubmit
                            message={`Lock ${user.displayName}?`}
                            className="btn btn-ghost btn-sm btn-warning"
                          >
                            <Icon name="lock" size={14} />
                            <span>Lock</span>
                          </ConfirmSubmit>
                        </form>
                      )}
                      {user.locked && (
                        <form action={unlockUser} method="post">
                          <input type="hidden" name="userId" value={user.id} />
                          <ConfirmSubmit
                            message={`Unlock ${user.displayName}?`}
                            className="btn btn-ghost btn-sm btn-success"
                          >
                            <Icon name="unlock" size={14} />
                            <span>Unlock</span>
                          </ConfirmSubmit>
                        </form>
                      )}
                      {user.mfaEnabled && (
                        <form action={resetUserMfa} method="post">
                          <input type="hidden" name="userId" value={user.id} />
                          <ConfirmSubmit
                            message={`Reset MFA for ${user.displayName}? They will need to re-enroll.`}
                            className="btn btn-ghost btn-sm"
                          >
                            <Icon name="refresh-cw" size={14} />
                            <span>Reset MFA</span>
                          </ConfirmSubmit>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconKey;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={28} />
      </div>
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
    </div>
  );
}
