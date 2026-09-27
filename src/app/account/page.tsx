/**
 * /account — identity, session state and the authentication audit trail.
 *
 * The audit table is filtered to the viewer's own entries. Administrators see
 * everything, which is why the `admin` role check is here rather than only in
 * the launch path.
 */

import type { Metadata } from 'next';
import { requireViewer } from '@/lib/auth/guards';
import { listUserSessions, SESSION_POLICY } from '@/lib/auth/sessions';
import { recent } from '@/lib/auth/audit';
import { PortalNav } from '@/components/PortalNav';
import { SessionTimer } from '@/components/SessionTimer';
import { SignOutButton } from '@/components/SignOutButton';
import { Avatar } from '@/components/Avatar';
import { GrantPill } from '@/components/Pills';
import { OIDC_ISSUER } from '@/lib/oidc';
import { formatDateTime, formatRelative } from '@/lib/format';
import { CATEGORIES } from '@/lib/systems';

export const metadata: Metadata = {
  title: 'My account',
  description: 'Your LGU Portal identity, active sessions and sign-in history.',
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const viewer = await requireViewer('/account');
  const { user, lifetime } = viewer;

  const isAdmin = user.roles.includes('admin');
  const entries = recent(30, isAdmin ? undefined : user.id);
  const activeSessions = await listUserSessions(user.id);

  return (
    <div className="page-shell">
      <PortalNav viewer={viewer} active="/account" />

      <main className="container page-body" id="main">
        <header className="page-head">
          <div className="page-head-text">
            <p className="eyebrow">My account</p>
            <h1 className="display-1">{user.displayName}</h1>
            <p className="text-body">
              {user.title} · {user.department}
            </p>
          </div>
        </header>

        <div className="panel-grid">
          <section className="glass panel" aria-labelledby="identity-title">
            <div className="panel-head">
              <h2 className="panel-title" id="identity-title">
                Directory identity
              </h2>
            </div>

            <div className="account-identity">
              <Avatar name={user.displayName} hue={user.avatarHue} size="lg" />
              <dl className="definition-list">
                <dt>Employee no.</dt>
                <dd className="mono">{user.employeeId}</dd>

                <dt>Email</dt>
                <dd>{user.email}</dd>

                <dt>Username</dt>
                <dd className="mono">{user.username}</dd>

                <dt>Office</dt>
                <dd>{user.office}</dd>

                <dt>Time zone</dt>
                <dd>{user.timeZone}</dd>

                <dt>Roles</dt>
                <dd>
                  <span className="role-list">
                    {user.roles.map((role) => (
                      <GrantPill key={role}>{role}</GrantPill>
                    ))}
                  </span>
                </dd>
              </dl>
            </div>
          </section>

          <section className="glass panel" aria-labelledby="session-title">
            <div className="panel-head">
              <h2 className="panel-title" id="session-title">
                Current session
              </h2>
              <SignOutButton next="/account" />
            </div>

            <SessionTimer
              remainingMs={
                lifetime.idleIsBinding ? lifetime.idleRemainingMs : lifetime.absoluteRemainingMs
              }
              binding={lifetime.idleIsBinding ? 'idle' : 'absolute'}
              idleMinutes={Math.round(SESSION_POLICY.idleTtlMs / 60_000)}
            />

            <dl className="definition-list">
              <dt>Signed in</dt>
              <dd>{formatDateTime(viewer.authTime)}</dd>

              <dt>Time since</dt>
              <dd>{formatRelative(viewer.authTime)}</dd>

              <dt>Second factor</dt>
              <dd>
                {viewer.mfaVerified
                  ? 'Verified'
                  : user.mfaEnabled
                    ? 'Not verified this session'
                    : 'Not enrolled'}
              </dd>

              <dt>Methods</dt>
              <dd>
                <span className="role-list">
                  {viewer.amr.map((method) => (
                    <span key={method} className="pill" data-tone="accent">
                      {method}
                    </span>
                  ))}
                </span>
              </dd>

              <dt>Active sessions</dt>
              <dd>
                {activeSessions.length}
                {activeSessions.length > 1 ? ' · this device and others' : ' · this device only'}
              </dd>
            </dl>

            <p className="text-meta">
              Idle timeout {Math.round(SESSION_POLICY.idleTtlMs / 60_000)} minutes, maximum
              lifetime {Math.round(SESSION_POLICY.absoluteTtlMs / 3_600_000)} hours.
            </p>
          </section>
        </div>

        <section className="glass panel" aria-labelledby="endpoints-title">
          <div className="panel-head">
            <h2 className="panel-title" id="endpoints-title">
              Authorisation endpoints
            </h2>
          </div>
          <p className="text-body">
            Any connected system can enrol against these. Each is a public client and must use PKCE.
          </p>
          <dl className="definition-list">
            <dt>Issuer</dt>
            <dd className="mono">{OIDC_ISSUER}</dd>
            <dt>Discovery</dt>
            <dd className="mono">{OIDC_ISSUER}/.well-known/openid-configuration</dd>
            <dt>Authorize</dt>
            <dd className="mono">{OIDC_ISSUER}/api/oidc/authorize</dd>
            <dt>Token</dt>
            <dd className="mono">{OIDC_ISSUER}/api/oidc/token</dd>
            <dt>Userinfo</dt>
            <dd className="mono">{OIDC_ISSUER}/api/oidc/userinfo</dd>
            <dt>JWKS</dt>
            <dd className="mono">{OIDC_ISSUER}/api/oidc/jwks</dd>
          </dl>
        </section>

        <section className="glass panel" aria-labelledby="audit-title">
          <div className="panel-head">
            <h2 className="panel-title" id="audit-title">
              Sign-in activity
            </h2>
            <span className="text-meta">
              {isAdmin ? 'All accounts (administrator view)' : 'Your account only'}
            </span>
          </div>

          {entries.length === 0 ? (
            <p className="text-body">No activity recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="visually-hidden">
                  Recent authentication events, most recent first
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Event</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Detail</th>
                    <th scope="col">Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-align="end" title={formatDateTime(entry.at)}>
                        {formatRelative(entry.at)}
                      </td>
                      <td className="mono">{entry.event}</td>
                      <td>
                        <span className="outcome" data-outcome={entry.outcome}>
                          {entry.outcome}
                        </span>
                      </td>
                      <td>{entry.detail ?? entry.target ?? '—'}</td>
                      <td className="mono">{entry.traceId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass panel" aria-labelledby="scope-title">
          <div className="panel-head">
            <h2 className="panel-title" id="scope-title">
              What your role can reach
            </h2>
            <span className="text-meta">{CATEGORIES.length} categories</span>
          </div>
          <p className="text-body">
            Authorisation is evaluated on the server for every launch. Granting access here does not
            change what the authorisation server will permit.
          </p>
        </section>
      </main>
    </div>
  );
}
