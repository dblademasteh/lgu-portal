/**
 * Systems Management — list, create, edit, delete.
 *
 * All mutations go through server actions so they work without client JS
 * and respect the admin guard.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { listSystems, getSystem, type System, statusLabel } from '@/lib/systems';
import { createSystem, updateSystem, deleteSystem } from '@/lib/admin/systems';
import type { IconKey } from '@/lib/systems';

/** Wrap server actions to satisfy Next.js form action typing */
const createSystemAction = async (formData: FormData) => {
  await createSystem(formData);
}

const updateSystemAction = async (formData: FormData) => {
  await updateSystem(formData);
}

const deleteSystemAction = async (formData: FormData) => {
  await deleteSystem(formData);
}
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import { clsx } from 'clsx';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Systems',
};

export default async function SystemsPage() {
  const admin = await requireAdmin();
  const systems = listSystems();

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Systems</h1>
          <p className="text-body text-meta">Manage connected downstream systems and their access policies.</p>
        </div>
        <a href="/admin/systems/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          <span>Add System</span>
        </a>
      </header>

      {systems.length === 0 ? (
        <EmptyState
          icon="server"
          title="No systems yet"
          description="Register your first downstream system to begin issuing grants."
          action={{ label: 'Add System', href: '/admin/systems/new' }}
        />
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" role="grid">
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">Status</th>
                <th scope="col">Allowed Roles</th>
                <th scope="col">Scopes</th>
                <th scope="col">Client ID</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((system) => (
                <tr key={system.slug}>
                  <td>
                    <div className="system-cell">
                      <span className="system-icon" style={{ '--tile-hue': String(system.accent) } as React.CSSProperties}>
                        <Icon name={system.icon} size={20} />
                      </span>
                      <div>
                        <span className="system-name">{system.name}</span>
                        <span className="system-slug mono">{system.slug}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={system.status} label={statusLabel(system.status)} />
                  </td>
                  <td>
                    <div className="role-list">
                      {system.allowedRoles.map((role) => (
                        <span key={role} className="pill pill--accent">{role}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="scope-list">
                      {system.scopes.map((scope) => (
                        <span key={scope} className="pill pill--info">{scope}</span>
                      ))}
                    </div>
                  </td>
                  <td className="mono">lgu-{system.slug}</td>
                  <td>
                    <div className="action-buttons">
                      <a href={`/admin/systems/${system.slug}`} className="btn btn-ghost btn-sm">
                        <Icon name="edit" size={14} />
                        <span>Edit</span>
                      </a>
                      <form action={deleteSystemAction} method="post">
                        <input type="hidden" name="slug" value={system.slug} />
                        <ConfirmSubmit
                          message={`Delete "${system.name}"? This cannot be undone.`}
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

function ScopeList({ scopes }: { scopes: string[] }) {
  return (
    <div className="scope-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--semantic-badge-gap)' }}>
      {scopes.map((scope) => (
        <span key={scope} className="pill pill--info">{scope}</span>
      ))}
    </div>
  );
}

function ActionButtons({ children }: { children: React.ReactNode }) {
  return <div className="action-buttons" style={{ display: 'flex', gap: 'var(--semantic-space-gap-sm)' }}>{children}</div>;
}