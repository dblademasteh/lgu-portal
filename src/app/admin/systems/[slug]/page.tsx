/**
 * System Create/Edit form.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { getSystem, listSystems, type System } from '@/lib/systems';
import { createSystem, updateSystem } from '@/lib/admin/systems';

/** Wrap server actions to satisfy Next.js form action typing */
const createSystemAction = async (formData: FormData) => {
  await createSystem(formData);
}

const updateSystemAction = async (formData: FormData) => {
  await updateSystem(formData);
}
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { Icon } from '@/components/Icon';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
}

const VALID_ICONS = [
  'server', 'database', 'users', 'briefcase', 'book-open',
  'heart', 'shopping-bag', 'help-circle', 'bar-chart', 'shield',
  'key', 'file-text', 'globe', 'credit-card', 'monitor',
] as const;

const VALID_STATUSES = ['operational', 'degraded', 'maintenance'] as const;
const VALID_ROLES = ['admin', 'supervisor', 'employee', 'auditor'] as const;
const SCOPE_SUGGESTIONS = [
  'profile:read', 'profile:write',
  'leave:read', 'leave:write',
  'payroll:read', 'payroll:write',
  'documents:read', 'documents:write',
  'reports:read', 'reports:write',
  'analytics:read', 'analytics:write',
  'admin:read', 'admin:write',
] as const;

interface PageData {
  system: System | null;
  isNew: boolean;
  created: boolean;
  updated: boolean;
}

export const metadata: Metadata = {
  title: { default: 'System', template: '%s · Systems' },
};

export default async function SystemFormPage({ params, searchParams }: PageProps) {
  const admin = await requireAdmin();
  const { slug } = await params;
  const params_search = await searchParams;
  const created = params_search.created === '1';
  const updated = params_search.updated === '1';
  const isNew = slug === 'new';

  let system: System | null = null;
  if (!isNew) {
    system = getSystem(slug);
    if (!system) notFound();
  }

  const pageData: PageData = { system, isNew, created, updated };

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">{isNew ? 'New System' : `Edit ${system?.name}`}</h1>
          <p className="text-body text-meta">
            {isNew
              ? 'Register a new downstream system for single sign-on access.'
              : `Configure ${system?.name} (${system?.slug}).`}
          </p>
        </div>
        <a href="/admin/systems" className="btn btn-secondary">
          <Icon name="arrow-left" size={16} />
          <span>Back to Systems</span>
        </a>
      </header>

      {created && <Toast message="System created successfully" type="success" />}
      {updated && <Toast message="System updated successfully" type="success" />}

      <form className="admin-form" action={isNew ? createSystemAction : updateSystemAction} method="post">
        <input type="hidden" name="originalSlug" value={system?.slug ?? ''} />

        <section className="admin-form-section">
          <h2 className="admin-form-section-title">Basic Information</h2>

          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="slug">Slug</label>
              <input
                className="admin-form-input"
                id="slug"
                name="slug"
                type="text"
                value={system?.slug ?? ''}
                placeholder="hris"
                pattern="[a-z0-9-]+"
                maxLength={32}
                required={true}
                disabled={!isNew}
                autoComplete="off"
              />
              <p className="admin-form-help">
                Unique identifier. Lowercase, alphanumeric with hyphens only. Cannot be changed after creation.
              </p>
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="name">Name</label>
              <input
                className="admin-form-input"
                id="name"
                name="name"
                type="text"
                value={system?.name ?? ''}
                placeholder="Human Resource Information System"
                maxLength={64}
                required={true}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="admin-form-field">
            <label className="admin-form-label" htmlFor="description">Description</label>
            <textarea
              className="admin-form-input admin-form-textarea"
              id="description"
              name="description"
              required={true}
              defaultValue={system?.description ?? ''}
            />
            <p className="admin-form-help">Shown in the system directory and launch page.</p>
          </div>
        </section>

        <section className="admin-form-section">
          <h2 className="admin-form-section-title">Visual Identity</h2>

          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="icon">Icon</label>
              <select className="admin-form-select" id="icon" name="icon" defaultValue={system?.icon ?? 'server'} required>
                {VALID_ICONS.map((icon) => (
                  <option key={icon} value={icon}>
                    {icon.charAt(0).toUpperCase() + icon.slice(1).replace('-', ' ')}
                  </option>
                ))}
              </select>
              <p className="admin-form-help">Choose a Lucide icon name for the system card.</p>
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="accent">Accent Hue (0-360)</label>
              <input
                className="admin-form-input"
                id="accent"
                name="accent"
                type="number"
                min="0"
                max="360"
                step="1"
                value={system?.accent ?? 200}
                required={true}
              />
              <p className="admin-form-help">HSL hue for the system's accent color (0=red, 120=green, 240=blue).</p>
            </div>
          </div>

          <div className="admin-form-field">
            <label className="admin-form-label" htmlFor="status">Status</label>
            <select className="admin-form-select" id="status" name="status" defaultValue={system?.status ?? 'operational'} required>
              <option value="operational">Operational</option>
              <option value="degraded">Degraded</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <p className="admin-form-help">
              <strong>Operational:</strong> Fully available.{' '}
              <strong>Degraded:</strong> Limited functionality.{' '}
              <strong>Maintenance:</strong> Temporarily unavailable (only admins can launch).
            </p>
          </div>
        </section>

        <section className="admin-form-section">
          <h2 className="admin-form-section-title">Access Control</h2>

          <div className="admin-form-field">
            <label className="admin-form-label">Allowed Roles</label>
            <div className="role-checkboxes">
              {VALID_ROLES.map((role) => (
                <label key={role} className="checkbox-label">
                  <input
                    type="checkbox"
                    name="allowedRoles"
                    value={role}
                    defaultChecked={system?.allowedRoles.includes(role) ?? false}
                  />
                  <span className="checkbox-text">{role.charAt(0).toUpperCase() + role.slice(1)}</span>
                </label>
              ))}
            </div>
            <p className="admin-form-help">Users must have at least one of these roles to launch this system.</p>
          </div>

          <div className="admin-form-field">
            <label className="admin-form-label">OAuth Scopes</label>
            <div className="scope-multiselect">
              <div className="scope-suggestions">
                {SCOPE_SUGGESTIONS.map((scope) => (
                  <label key={scope} className="checkbox-label">
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      defaultChecked={system?.scopes.includes(scope) ?? false}
                    />
                    <span className="checkbox-text mono">{scope}</span>
                  </label>
                ))}
              </div>
              <div className="custom-scope-input">
                <input
                  className="admin-form-input"
                  type="text"
                  placeholder="Add custom scope (e.g., custom:action)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const input = e.currentTarget as HTMLInputElement;
                      if (input.value.trim()) {
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.name = 'scopes';
                        checkbox.value = input.value.trim();
                        checkbox.checked = true;
                        checkbox.id = `scope-${Date.now()}`;
                        const label = document.createElement('label');
                        label.className = 'checkbox-label';
                        label.appendChild(checkbox);
                        label.appendChild(document.createTextNode(input.value.trim()));
                        input.parentElement?.insertBefore(label, input);
                        input.value = '';
                      }
                    }
                  }}
                />
              </div>
              <p className="admin-form-help">Scopes granted to this system. Use suggested scopes or add custom ones.</p>
            </div>
          </div>
        </section>

        <div className="admin-form-actions">
          <a href="/admin/systems" className="btn btn-secondary">Cancel</a>
          <button type="submit" className="btn btn-primary">
            <Icon name={isNew ? 'plus' : 'save'} size={16} />
            <span>{isNew ? 'Create System' : 'Save Changes'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`toast toast--${type}`} role="alert">
      <div className="toast-content">
        <p className="toast-title">{type === 'success' ? 'Success' : 'Error'}</p>
        <p className="toast-message">{message}</p>
      </div>
      <button className="toast-close" onClick={(e) => e.currentTarget.parentElement?.remove()}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}