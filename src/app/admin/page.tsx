/**
 * Admin Dashboard.
 *
 * Overview of system health, key metrics, and quick actions.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { listSystems } from '@/lib/systems';
import { listClients } from '@/lib/oidc';
import { getSessionStats } from '@/lib/auth/sessions';
import { getRateLimitStats } from '@/lib/auth/rate-limit';
import { getAuditStats } from '@/lib/auth/audit';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { SystemDirectory } from '@/components/SystemDirectory';
import { StatusPill, GrantPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import { BrandLockup } from '@/components/BrandMark';
import { clsx } from 'clsx';
import type { Metadata } from 'next';
import type { IconKey } from '@/lib/systems';

export const metadata: Metadata = {
  title: 'Dashboard',
};

const oidcClients = listClients();

export default async function AdminDashboard() {
  const admin = await requireAdmin();
  const systems = listSystems();
  const sessionStats = await getSessionStats();
  const rateLimitStats = await getRateLimitStats();
  const auditStats = await getAuditStats();

  const operationalSystems = systems.filter((s) => s.status === 'operational').length;
  const degradedSystems = systems.filter((s) => s.status === 'degraded').length;
  const maintenanceSystems = systems.filter((s) => s.status === 'maintenance').length;

  return (
    <div className="page-shell">
      <div className="admin-dashboard">
        <header className="dashboard-header">
          <div>
            <h1 className="display-1">Admin Dashboard</h1>
            <p className="text-body text-meta">LGU Portal administration console. Signed in as <strong>{admin.user.displayName}</strong>.</p>
          </div>
          <div className="dashboard-header-actions">
            <a href="/portal" className="btn btn-secondary btn-sm">
              <Icon name="home" size={16} />
              <span>View Portal</span>
            </a>
          </div>
        </header>

        <section className="dashboard-stats" aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="sr-only">Key metrics</h2>
          <div className="stats-grid">
            <StatCard
              label="Systems"
              value={systems.length}
              subValue={`${operationalSystems} operational · ${degradedSystems} degraded · ${maintenanceSystems} maintenance`}
              href="/admin/systems"
              icon="server"
              tone="primary"
            />
            <StatCard
              label="Active Sessions"
              value={sessionStats.total}
              subValue={`${sessionStats.idle} idle · ${sessionStats.active} active`}
              href="/admin/sessions"
              icon="users"
              tone="success"
            />
            <StatCard
              label="OIDC Clients"
              value={oidcClients.length}
              subValue={`${oidcClients.length} registered`}
              href="/admin/clients"
              icon="key"
              tone="info"
            />
            <StatCard
              label="Audit Events (24h)"
              value={auditStats.last24h}
              subValue={`${auditStats.success} success · ${auditStats.denied} denied · ${auditStats.failure} failed`}
              href="/admin/audit"
              icon="activity"
              tone="warning"
            />
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="dashboard-card">
            <header className="card-header">
              <h2 className="panel-title">System Health</h2>
              <a href="/admin/systems" className="btn btn-link btn-sm">View all</a>
            </header>
            <SystemDirectory
            available={systems.filter((s) => admin.user.roles.includes('admin') || s.allowedRoles.some((r) => admin.user.roles.includes(r)))}
            restricted={systems.filter((s) => !admin.user.roles.includes('admin') && !s.allowedRoles.some((r) => admin.user.roles.includes(r)))}
          />
          </div>

          <div className="dashboard-card">
            <header className="card-header">
              <h2 className="panel-title">Rate Limiting</h2>
              <a href="/admin/settings#rate-limits" className="btn btn-link btn-sm">Configure</a>
            </header>
            <dl className="definition-list">
              <dt>Active buckets</dt>
              <dd>{rateLimitStats.activeBuckets}</dd>
              <dt>Blocked (5m)</dt>
              <dd className={rateLimitStats.blocked5m > 10 ? 'text-danger' : ''}>{rateLimitStats.blocked5m}</dd>
              <dt>Total requests (5m)</dt>
              <dd>{rateLimitStats.total5m}</dd>
            </dl>
          </div>

          <div className="dashboard-card">
            <header className="card-header">
              <h2 className="panel-title">Recent Audit Activity</h2>
              <a href="/admin/audit" className="btn btn-link btn-sm">View all</a>
            </header>
            <dl className="definition-list">
              <dt>Last hour</dt>
              <dd className="mono">{auditStats.lastHour}</dd>
              <dt>Success</dt>
              <dd className="text-success">{auditStats.success}</dd>
              <dt>Denied</dt>
              <dd className="text-warning">{auditStats.denied}</dd>
              <dt>Failed</dt>
              <dd className="text-danger">{auditStats.failure}</dd>
            </dl>
          </div>

          <div className="dashboard-card">
            <header className="card-header">
              <h2 className="panel-title">Quick Actions</h2>
            </header>
            <div className="action-grid">
              <ActionCard
                label="Add System"
                description="Register a new downstream system"
                href="/admin/systems/new"
                icon="plus"
              />
              <ActionCard
                label="Register Client"
                description="Add a new OIDC relying party"
                href="/admin/clients/new"
                icon="key"
              />
              <ActionCard
                label="Rotate Keys"
                description="Rotate signing keys (RS256)"
                href="/admin/keys"
                icon="refresh-cw"
              />
              <ActionCard
                label="View Audit Log"
                description="Search and export audit events"
                href="/admin/audit"
                icon="search"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subValue,
  href,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  subValue: string;
  href: string;
  icon: IconKey;
  tone: 'primary' | 'success' | 'info' | 'warning';
}) {
  return (
    <a href={href} className={clsx('stat-card', `stat-card--${tone}`)}>
      <div className="stat-card-icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="stat-card-content">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-sub">{subValue}</span>
      </div>
    </a>
  );
}

function ActionCard({
  label,
  description,
  href,
  icon,
}: {
  label: string;
  description: string;
  href: string;
  icon: IconKey;
}) {
  return (
    <a href={href} className="action-card">
      <div className="action-card-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="action-card-content">
        <span className="action-card-label">{label}</span>
        <span className="action-card-description">{description}</span>
      </div>
    </a>
  );
}