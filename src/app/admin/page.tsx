/**
 * Admin Dashboard.
 *
 * Control-room overview: system health, traffic, and quick actions.
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

  const overallHealth: 'healthy' | 'warning' | 'critical' =
    degradedSystems > 0 ? 'warning' : 'healthy';

  return (
    <div className="page-shell">
      <div className="admin-dashboard">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-eyebrow">Administration</p>
            <h1 className="dashboard-title">Control room</h1>
            <p className="dashboard-subtitle">
              Signed in as <strong>{admin.user.displayName}</strong>
            </p>
          </div>
          <a href="/portal" className="btn btn-secondary btn-sm">
            <Icon name="external-link" size={16} />
            <span>View portal</span>
          </a>
        </header>

        <section className="dashboard-metrics" aria-label="Key metrics">
          <Metric label="Systems" value={String(systems.length)} tone="default" />
          <Metric label="Sessions" value={`${sessionStats.active} active`} tone="success" />
          <Metric label="Clients" value={String(oidcClients.length)} tone="default" />
          <Metric label="Audit (24h)" value={String(auditStats.last24h)} tone={auditStats.failure > 0 ? 'warning' : 'default'} />
        </section>

        <section className="dashboard-panels">
          <div className={clsx('dashboard-panel', `dashboard-panel--${overallHealth}`)}>
            <header className="panel-header">
              <h2 className="panel-title">System health</h2>
              <a href="/admin/systems" className="panel-link">View all</a>
            </header>
            <SystemDirectory
              available={systems.filter((s) => admin.user.roles.includes('admin') || s.allowedRoles.some((r) => admin.user.roles.includes(r)))}
              restricted={systems.filter((s) => !admin.user.roles.includes('admin') && !s.allowedRoles.some((r) => admin.user.roles.includes(r)))}
            />
          </div>

          <div className="dashboard-panel">
            <header className="panel-header">
              <h2 className="panel-title">Rate limiting</h2>
              <a href="/admin/settings#rate-limits" className="panel-link">Configure</a>
            </header>
            <dl className="metric-list">
              <div className="metric-row">
                <dt>Active buckets</dt>
                <dd className="mono">{rateLimitStats.activeBuckets}</dd>
              </div>
              <div className="metric-row">
                <dt>Blocked (5m)</dt>
                <dd className={clsx('mono', rateLimitStats.blocked5m > 10 ? 'text-danger' : '')}>
                  {rateLimitStats.blocked5m}
                </dd>
              </div>
              <div className="metric-row">
                <dt>Total requests (5m)</dt>
                <dd className="mono">{rateLimitStats.total5m.toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          <div className="dashboard-panel">
            <header className="panel-header">
              <h2 className="panel-title">Audit trail</h2>
              <a href="/admin/audit" className="panel-link">View all</a>
            </header>
            <dl className="metric-list">
              <div className="metric-row">
                <dt>Last hour</dt>
                <dd className="mono">{auditStats.lastHour}</dd>
              </div>
              <div className="metric-row">
                <dt>Success</dt>
                <dd className="mono text-success">{auditStats.success}</dd>
              </div>
              <div className="metric-row">
                <dt>Denied</dt>
                <dd className="mono text-warning">{auditStats.denied}</dd>
              </div>
              <div className="metric-row">
                <dt>Failed</dt>
                <dd className="mono text-danger">{auditStats.failure}</dd>
              </div>
            </dl>
          </div>

          <div className="dashboard-panel">
            <header className="panel-header">
              <h2 className="panel-title">Quick actions</h2>
            </header>
            <div className="action-grid">
              <ActionCard
                label="Add system"
                href="/admin/systems/new"
                icon="plus"
              />
              <ActionCard
                label="Register client"
                href="/admin/clients/new"
                icon="key"
              />
              <ActionCard
                label="Rotate keys"
                href="/admin/keys"
                icon="refresh-cw"
              />
              <ActionCard
                label="Audit log"
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'success' | 'warning';
}) {
  return (
    <div className={clsx('metric', `metric--${tone}`)}>
      <span className="metric-value mono">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function ActionCard({
  label,
  href,
  icon,
}: {
  label: string;
  href: string;
  icon: IconKey;
}) {
  return (
    <a href={href} className="action-card">
      <span className="action-card-icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="action-card-label">{label}</span>
    </a>
  );
}