/**
 * OIDC Clients Management — register, rotate secrets, manage redirect URIs.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { findClient, type OidcClient } from '@/lib/oidc';
import { registerClient, rotateClientSecretAction, deleteClientAction } from '@/lib/admin/clients';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill, GrantPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import type { IconKey } from '@/lib/systems';
import { clsx } from 'clsx';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OIDC Clients',
};

export default async function ClientsPage() {
  const admin = await requireAdmin();

  // Get all clients from the OIDC registry
  const { listClients } = await import('@/lib/oidc');
  const clients = listClients();

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">OIDC Clients</h1>
          <p className="text-body text-meta">Manage relying party clients for OpenID Connect.</p>
        </div>
        <a href="/admin/clients/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          <span>Register Client</span>
        </a>
      </header>

      {clients.length === 0 ? (
        <EmptyState
          icon="key"
          title="No clients registered"
          description="Register your first OIDC relying party client."
          action={{ label: 'Register Client', href: '/admin/clients/new' }}
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" role="grid">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">System</th>
                <th scope="col">Redirect URIs</th>
                <th scope="col">Scopes</th>
                <th scope="col">Created</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.clientId}>
                  <td>
                    <div className="client-cell">
                      <span className="client-id mono">{client.clientId}</span>
                    </div>
                  </td>
                  <td>
                    <span className="system-name">{client.system?.name ?? client.clientId}</span>
                  </td>
                  <td>
                    <div className="uri-list">
                      {client.redirectUris.map((uri, idx) => (
                        <span key={idx} className="mono text-meta" style={{ fontSize: 'var(--semantic-text-size-xs)' }}>
                          {uri}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="scope-list">
                      {client.allowedScopes.map((scope) => (
                        <span key={scope} className="pill pill--info">{scope}</span>
                      ))}
                    </div>
                  </td>
                  <td className="mono text-meta">
                    {client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <a href={`/admin/clients/${client.clientId}/edit`} className="btn btn-ghost btn-sm">
                        <Icon name="edit" size={14} />
                        <span>Edit</span>
                      </a>
                      <form action={rotateClientSecretAction} method="post">
                        <input type="hidden" name="clientId" value={client.clientId} />
                        <ConfirmSubmit
                          message={`Rotate secret for ${client.clientId}? The old secret will be invalidated immediately.`}
                          className="btn btn-ghost btn-sm"
                        >
                          <Icon name="rotate-cw" size={14} />
                          <span>Rotate Secret</span>
                        </ConfirmSubmit>
                      </form>
                      <form action={deleteClientAction} method="post">
                        <input type="hidden" name="clientId" value={client.clientId} />
                        <ConfirmSubmit
                          message={`Delete ${client.clientId}? This cannot be undone.`}
                          className="btn btn-ghost btn-sm btn-danger"
                        >
                          <Icon name="trash" size={14} />
                          <span>Delete</span>
                        </ConfirmSubmit>
                      </form>
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
  action,
}: {
  icon: IconKey;
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={28} />
      </div>
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
      {action && (
        <a href={action.href} className="btn btn-primary" style={{ marginTop: 'var(--semantic-space-gap-md)' }}>
          <Icon name="plus" size={14} />
          <span>{action.label}</span>
        </a>
      )}
    </div>
  );
}