/**
 * Edit an existing OIDC client.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { findClient } from '@/lib/oidc';
import { listSystems } from '@/lib/systems';
import { rotateClientSecretAction, deleteClientAction } from '@/lib/admin/clients';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import { record } from '@/lib/auth/audit';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Edit Client',
};

const ALL_SCOPES = ['openid', 'profile', 'email', 'employee_id', 'roles'] as const;

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; rotated?: string; updated?: string; deleted?: string }>;
}) {
  const admin = await requireAdmin();
  const resolvedParams = await params;
  const client = findClient(resolvedParams.id);
  if (!client) {
    redirect('/admin/clients?error=not_found');
  }

  const query = await searchParams;
  const systems = listSystems();

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Edit Client</h1>
          <p className="text-body text-meta">{client.clientId}</p>
        </div>
        <a href="/admin/clients" className="btn btn-secondary">
          <Icon name="x" size={16} />
          <span>Cancel</span>
        </a>
      </header>

      {query.error && (
        <div className="alert alert-danger" role="alert">
          {query.error}
        </div>
      )}
      {query.rotated && (
        <div className="alert alert-success" role="status">
          Client secret rotated successfully.
        </div>
      )}

      <div className="form-card">
        <form action={updateClientAction} method="post">
          <input type="hidden" name="clientId" value={client.clientId} />

          <div className="form-group">
            <label htmlFor="name" className="form-label">Display Name</label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="form-input"
              defaultValue={client.system?.name ?? client.clientId}
            />
          </div>

          <div className="form-group">
            <label htmlFor="systemSlug" className="form-label">System</label>
            <select id="systemSlug" name="systemSlug" required className="form-input" defaultValue={client.system?.slug ?? ''}>
              <option value="">Select a system…</option>
              {systems.map((system) => (
                <option key={system.slug} value={system.slug}>{system.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Redirect URIs</label>
            {client.redirectUris.map((uri, idx) => (
              <input
                key={idx}
                name="redirectUris"
                type="url"
                required
                className="form-input"
                defaultValue={uri}
                style={{ marginBottom: 'var(--semantic-space-gap-sm)' }}
              />
            ))}
            <input
              name="redirectUris"
              type="url"
              className="form-input"
              placeholder="Add another redirect URI…"
            />
          </div>

          <div className="form-group">
            <fieldset>
              <legend className="form-label">Scopes</legend>
              <div className="scope-checkboxes">
                {ALL_SCOPES.map((scope) => (
                  <label key={scope} className="checkbox-label">
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      defaultChecked={client.allowedScopes.includes(scope)}
                    />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <Icon name="save" size={16} />
              <span>Save Changes</span>
            </button>
            <a href="/admin/clients" className="btn btn-secondary">
              Cancel
            </a>
          </div>
        </form>
      </div>

      <div className="form-card" style={{ marginTop: 'var(--semantic-space-gap-lg)' }}>
        <h2 className="panel-title">Danger Zone</h2>
        <div className="action-grid">
          <form action={rotateClientSecretAction} method="post">
            <input type="hidden" name="clientId" value={client.clientId} />
            <ConfirmSubmit
              message={`Rotate secret for ${client.clientId}? The old secret will be invalidated immediately.`}
              className="btn btn-ghost"
            >
              <Icon name="rotate-cw" size={16} />
              <span>Rotate Secret</span>
            </ConfirmSubmit>
          </form>
          <form action={deleteClientAction} method="post">
            <input type="hidden" name="clientId" value={client.clientId} />
            <ConfirmSubmit
              message={`Delete ${client.clientId}? This cannot be undone.`}
              className="btn btn-ghost btn-danger"
            >
              <Icon name="trash" size={16} />
              <span>Delete Client</span>
            </ConfirmSubmit>
          </form>
        </div>
      </div>
    </div>
  );
}

async function updateClientAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const clientId = String(formData.get('clientId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const redirectUris = formData.getAll('redirectUris').map(String).filter(Boolean);
  const scopes = formData.getAll('scopes').map(String).filter(Boolean);
  const systemSlug = String(formData.get('systemSlug') ?? '').trim();

  if (!clientId || !name || redirectUris.length === 0 || scopes.length === 0 || !systemSlug) {
    return redirect(`/admin/clients/${clientId}/edit?error=missing_fields`);
  }

  // Delete and re-register with new values
  const { deleteClient, registerClient } = await import('@/lib/oidc');
  await deleteClient(clientId);
  await registerClient({ clientId, name, redirectUris, scopes, systemSlug });

  record('admin.client.updated', 'success', {
    actorId: admin.user.id,
    target: clientId,
    detail: `updated client ${clientId}`,
  });

  redirect(`/admin/clients/${clientId}/edit?updated=1`);
}
