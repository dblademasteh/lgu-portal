/**
 * Admin Sessions — view and manage all active sessions across the portal.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { destroySession, getSession, listAllSessions } from '@/lib/auth/sessions';
import { findUserById, listAllUsers } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Sessions',
};

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ revoked?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const sessions = await listAllSessions();
  const users = await listAllUsers();
  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Active Sessions</h1>
          <p className="text-body text-meta">{sessions.length} session{sessions.length !== 1 ? 's' : ''} currently active.</p>
        </div>
      </header>

      {params.revoked && (
        <div className="alert alert-success" role="status">
          Session revoked successfully.
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="users" size={28} />
          </div>
          <h2 className="empty-state-title">No active sessions</h2>
          <p className="empty-state-description">All sessions have expired or been revoked.</p>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" role="grid">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Session ID</th>
                <th scope="col">Created</th>
                <th scope="col">Last Seen</th>
                <th scope="col">MFA</th>
                <th scope="col">IP</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const user = userMap.get(session.userId);
                return (
                  <tr key={session.id}>
                    <td>
                      <div className="user-cell">
                        <span className="user-name">{user?.displayName ?? 'Unknown'}</span>
                        <span className="user-meta mono">{user?.username ?? session.userId}</span>
                      </div>
                    </td>
                    <td className="mono text-meta" style={{ fontSize: 'var(--semantic-text-size-xs)' }}>
                      {session.id.slice(0, 16)}…
                    </td>
                    <td className="mono text-meta">
                      {new Date(session.createdAt).toLocaleString()}
                    </td>
                    <td className="mono text-meta">
                      {new Date(session.lastSeenAt).toLocaleString()}
                    </td>
                    <td>
                      {session.mfaVerified ? (
                        <StatusPill status="operational" label="Verified" />
                      ) : (
                        <StatusPill status="degraded" label="None" />
                      )}
                    </td>
                    <td className="mono text-meta">{session.ip ?? '—'}</td>
                    <td>
                      <form action={revokeSessionAction} method="post">
                        <input type="hidden" name="sessionId" value={session.id} />
                        <ConfirmSubmit
                          message={`Revoke this session? The user will be signed out immediately.`}
                          className="btn btn-ghost btn-sm btn-danger"
                        >
                          <Icon name="x" size={14} />
                          <span>Revoke</span>
                        </ConfirmSubmit>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function revokeSessionAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) return redirect('/admin/sessions?error=missing_id');

  const session = await getSession(sessionId);
  if (session) {
    await destroySession(sessionId);
    record('admin.session.revoked', 'success', {
      actorId: admin.user.id,
      target: session.userId,
      detail: `revoked session ${sessionId.slice(0, 16)}`,
      sessionId,
    });
  }

  redirect('/admin/sessions?revoked=1');
}
