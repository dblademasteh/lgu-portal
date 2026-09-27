/**
 * Audit Log Viewer — searchable, filterable, exportable.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { getAuditEntries, getAuditStats, type AuditEntry, type AuditEvent } from '@/lib/auth/audit';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { StatusPill, GrantPill } from '@/components/Pills';
import { Icon } from '@/components/Icon';
import type { IconKey } from '@/lib/systems';
import { clsx } from 'clsx';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

interface PageProps {
  searchParams: Promise<{
    event?: string;
    outcome?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
  }>;
}

export const metadata: Metadata = {
  title: 'Audit Log',
};

const OUTCOME_LABELS: Record<string, string> = {
  success: 'Success',
  failure: 'Failure',
  denied: 'Denied',
  challenge: 'Challenge',
};

const EVENT_LABELS: Record<string, string> = {
  'auth.login.attempt': 'Login Attempt',
  'auth.login.success': 'Login Success',
  'auth.login.failure': 'Login Failure',
  'auth.login.locked': 'Account Locked',
  'auth.mfa.required': 'MFA Required',
  'auth.mfa.success': 'MFA Success',
  'auth.mfa.failure': 'MFA Failure',
  'auth.logout': 'Logout',
  'auth.session.expired': 'Session Expired',
  'app.launch': 'App Launch',
  'app.launch.denied': 'Launch Denied',
  'oidc.token.issued': 'Token Issued',
  'oidc.token.denied': 'Token Denied',
  'rate_limit.blocked': 'Rate Limited',
};

export default async function AuditPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? '50', 10)));
  const offset = (page - 1) * limit;

  const { entries, total } = getAuditEntries({
    event: params.event,
    outcome: params.outcome,
    actor: params.actor,
    from: params.from ? new Date(params.from).getTime() : undefined,
    to: params.to ? new Date(params.to).getTime() : undefined,
    limit,
    offset,
  });

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Audit Log</h1>
          <p className="text-body text-meta">Search and review authentication and authorization events.</p>
        </div>
        <a
          href={`/api/admin/audit/export?${new URLSearchParams(params as any).toString()}`}
          className="btn btn-secondary"
        >
          <Icon name="download" size={16} />
          <span>Export CSV</span>
        </a>
      </header>

      {/* Filters */}
      <section className="dashboard-card" style={{ marginBottom: 'var(--semantic-space-gap-lg)' }}>
        <form className="admin-form" method="get" style={{ gap: 'var(--semantic-space-gap-md)' }}>
          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="event">Event</label>
              <select className="admin-form-select" id="event" name="event" defaultValue={params.event ?? ''}>
                <option value="">All events</option>
                {Object.entries(EVENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="outcome">Outcome</label>
              <select className="admin-form-select" id="outcome" name="outcome" defaultValue={params.outcome ?? ''}>
                <option value="">All outcomes</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="denied">Denied</option>
                <option value="challenge">Challenge</option>
              </select>
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="actor">Actor (username or ID)</label>
              <input
                className="admin-form-input"
                id="actor"
                name="actor"
                type="text"
                placeholder="j.delacruz"
                value={params.actor ?? ''}
              />
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="from">From</label>
              <input
                className="admin-form-input"
                id="from"
                name="from"
                type="datetime-local"
                value={params.from ?? ''}
              />
            </div>

            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="to">To</label>
              <input
                className="admin-form-input"
                id="to"
                name="to"
                type="datetime-local"
                value={params.to ?? ''}
              />
            </div>

            <div className="admin-form-field" style={{ alignSelf: 'flex-end' }}>
              <label className="admin-form-label" htmlFor="limit">Limit</label>
              <select className="admin-form-select" id="limit" name="limit" defaultValue={String(limit)}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          <div className="admin-form-actions" style={{ border: 'none', padding: 0, margin: 0 }}>
            <button type="submit" className="btn btn-primary">
              <Icon name="filter" size={16} />
              <span>Apply Filters</span>
            </button>
            <a href="/admin/audit" className="btn btn-secondary">
              <Icon name="x" size={16} />
              <span>Clear</span>
            </a>
          </div>
        </form>
      </section>

      {/* Results */}
      <section className="dashboard-card">
        <header className="card-header">
          <h2 className="panel-title">Results</h2>
          <span className="text-meta">{total} total entries</span>
        </header>

        {entries.length === 0 ? (
          <EmptyState
            icon="activity"
            title="No matching entries"
            description="Try adjusting your filters or expanding the date range."
          />
        ) : (
          <>
            <div className="admin-table-container">
              <table className="admin-table" role="grid">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Trace ID</th>
                    <th scope="col">Event</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Target</th>
                    <th scope="col">Detail</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono">
                        {new Date(entry.at).toLocaleString()}
                      </td>
                      <td className="mono">
                        <span className="trace-id" title={entry.traceId}>
                          {entry.traceId.slice(0, 16)}…
                        </span>
                      </td>
                      <td>
                        <span className="event-label">{EVENT_LABELS[entry.event] ?? entry.event}</span>
                      </td>
                      <td>
                        <OutcomeBadge outcome={entry.outcome} />
                      </td>
                      <td>
                        {entry.actorLabel && (
                          <span className="user-name">{entry.actorLabel}</span>
                        )}
                        {entry.actorId && (
                          <span className="user-meta mono">({entry.actorId})</span>
                        )}
                      </td>
                      <td className="mono text-meta">{entry.target ?? '—'}</td>
                      <td className="text-meta" style={{ maxWidth: '20rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.detail ?? '—'}
                      </td>
                      <td className="mono text-meta">{entry.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav className="pagination" aria-label="Audit log pagination">
                <ul className="pagination-list">
                  {page > 1 && (
                    <li>
                      <a
                        href={`?${new URLSearchParams({ ...params, page: String(page - 1) }).toString()}`}
                        className="btn btn-ghost btn-sm"
                      >
                        <Icon name="chevron-left" size={14} />
                      </a>
                    </li>
                  )}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                    return p > totalPages ? null : (
                      <li key={p}>
                        <a
                          href={`?${new URLSearchParams({ ...params, page: String(p) }).toString()}`}
                          className={clsx('btn btn-sm', p === page ? 'btn-primary' : 'btn-ghost')}
                          aria-current={p === page ? 'page' : undefined}
                        >
                          {p}
                        </a>
                      </li>
                    );
                  })}
                  {page < totalPages && (
                    <li>
                      <a
                        href={`?${new URLSearchParams({ ...params, page: String(page + 1) }).toString()}`}
                        className="btn btn-ghost btn-sm"
                      >
                        <Icon name="chevron-right" size={14} />
                      </a>
                    </li>
                  )}
                </ul>
              </nav>
            )}
          </>
        )}
      </section>
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

function OutcomeBadge({ outcome }: { outcome: string }) {
  const tones: Record<string, 'success' | 'failure' | 'denied' | 'challenge'> = {
    success: 'success',
    failure: 'failure',
    denied: 'denied',
    challenge: 'challenge',
  };

  const pillTones: Record<string, 'operational' | 'degraded' | 'maintenance'> = {
    success: 'operational',
    failure: 'degraded',
    denied: 'degraded',
    challenge: 'maintenance',
  };

  return (
    <StatusPill
      status={pillTones[outcome] ?? 'degraded'}
      label={OUTCOME_LABELS[outcome] ?? outcome}
    />
  );
}