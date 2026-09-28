/**
 * Register a new OIDC client.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { listSystems } from '@/lib/systems';
import { registerClientAction } from '@/lib/admin/clients';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { Icon } from '@/components/Icon';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Register Client',
};

const ALL_SCOPES = ['openid', 'profile', 'email', 'employee_id', 'roles'] as const;

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const systems = listSystems();

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Register OIDC Client</h1>
          <p className="text-body text-meta">Add a new relying party to the SSO federation.</p>
        </div>
        <a href="/admin/clients" className="btn btn-secondary">
          <Icon name="x" size={16} />
          <span>Cancel</span>
        </a>
      </header>

      {params.error && (
        <div className="alert alert-danger" role="alert">
          {params.error}
        </div>
      )}
      {params.created && (
        <div className="alert alert-success" role="status">
          Client registered successfully.
        </div>
      )}

      <div className="form-card">
        <form action={registerClientAction} method="post">
          <div className="form-group">
            <label htmlFor="clientId" className="form-label">Client ID</label>
            <input
              id="clientId"
              name="clientId"
              type="text"
              required
              className="form-input"
              placeholder="lgu-hrms"
              pattern="[a-z0-9-]+"
              title="Lowercase letters, numbers, and hyphens only"
            />
            <p className="form-hint">Unique identifier for this client. Must be lowercase.</p>
          </div>

          <div className="form-group">
            <label htmlFor="name" className="form-label">Display Name</label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="form-input"
              placeholder="LGU HRMS"
            />
          </div>

          <div className="form-group">
            <label htmlFor="systemSlug" className="form-label">System</label>
            <select id="systemSlug" name="systemSlug" required className="form-input">
              <option value="">Select a system…</option>
              {systems.map((system) => (
                <option key={system.slug} value={system.slug}>{system.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Redirect URIs</label>
            <div className="redirect-uri-list">
              <input
                name="redirectUris"
                type="url"
                required
                className="form-input"
                placeholder="https://hrms.lgu.gov.ph/api/oidc/callback"
              />
              <input
                name="redirectUris"
                type="url"
                className="form-input"
                placeholder="https://hrms.lgu.gov.ph/callback"
              />
            </div>
            <p className="form-hint">At least one redirect URI is required. Add more if needed.</p>
          </div>

          <div className="form-group">
            <fieldset>
              <legend className="form-label">Scopes</legend>
              <div className="scope-checkboxes">
                {ALL_SCOPES.map((scope) => (
                  <label key={scope} className="checkbox-label">
                    <input type="checkbox" name="scopes" value={scope} defaultChecked />
                    <span>{scope}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <Icon name="plus" size={16} />
              <span>Register Client</span>
            </button>
            <a href="/admin/clients" className="btn btn-secondary">
              Cancel
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
