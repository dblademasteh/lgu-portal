/**
 * Settings — rate limits, session policy, OIDC config, feature flags.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { Icon } from '@/components/Icon';
import { rotateSigningKeysAction } from '@/lib/admin/keys-actions';
import {
  clearExpiredSessionsAction,
  clearRateLimitsAction,
  saveSessionPolicy,
  saveRateLimits,
  saveOidcConfig,
  saveFeatureFlags,
} from '@/lib/admin/settings-actions';
import { ConfirmSubmit } from '@/components/ConfirmSubmit';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
};

interface SettingsPageProps {
  searchParams: Promise<{ saved?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const saved = params.saved;

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Settings</h1>
          <p className="text-body text-meta">Configure portal behavior, security policies, and integrations.</p>
        </div>
      </header>

      {saved && <Toast message={`Settings saved: ${saved}`} type="success" />}

      <section className="dashboard-card" aria-labelledby="session-heading">
        <h2 id="session-heading" className="panel-title">Session Policy</h2>
        <form className="admin-form" action={saveSessionPolicy} method="post">
          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="absoluteTtl">Absolute Lifetime (hours)</label>
              <input className="admin-form-input" id="absoluteTtl" name="absoluteTtl" type="number" min="1" max="168" step="1" defaultValue={8} />
              <p className="admin-form-help">Maximum session lifetime regardless of activity.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="idleTtl">Idle Timeout (minutes)</label>
              <input className="admin-form-input" id="idleTtl" name="idleTtl" type="number" min="5" max="480" step="5" defaultValue={30} />
              <p className="admin-form-help">Session expires after this many minutes of inactivity.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="renewAfter">Renewal Window (minutes)</label>
              <input className="admin-form-input" id="renewAfter" name="renewAfter" type="number" min="1" max="60" step="1" defaultValue={1} />
              <p className="admin-form-help">Minimum interval between session renewals.</p>
            </div>
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="btn btn-primary">Save Session Policy</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card" aria-labelledby="ratelimit-heading">
        <h2 id="ratelimit-heading" className="panel-title">Rate Limiting</h2>
        <form className="admin-form" action={saveRateLimits} method="post">
          <p className="text-body text-meta" style={{ marginBottom: 'var(--semantic-space-gap-lg)' }}>
            Configure per-identity and per-client rate limits for authentication endpoints.
          </p>
          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="identityMax">Per-Account Max Attempts</label>
              <input className="admin-form-input" id="identityMax" name="identityMax" type="number" min="3" max="50" step="1" defaultValue={8} />
              <p className="admin-form-help">Failed attempts per username per window.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="clientMax">Per-Client (IP) Max Attempts</label>
              <input className="admin-form-input" id="clientMax" name="clientMax" type="number" min="10" max="500" step="5" defaultValue={30} />
              <p className="admin-form-help">Failed attempts per IP per window.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="mfaMax">MFA Max Attempts</label>
              <input className="admin-form-input" id="mfaMax" name="mfaMax" type="number" min="3" max="20" step="1" defaultValue={6} />
              <p className="admin-form-help">Failed MFA code attempts per challenge.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="windowMs">Window (minutes)</label>
              <input className="admin-form-input" id="windowMs" name="windowMs" type="number" min="5" max="120" step="5" defaultValue={15} />
              <p className="admin-form-help">Rate limit window duration.</p>
            </div>
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="btn btn-primary">Save Rate Limits</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card" aria-labelledby="oidc-heading">
        <h2 id="oidc-heading" className="panel-title">OIDC Configuration</h2>
        <form className="admin-form" action={saveOidcConfig} method="post">
          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="issuer">Issuer URL</label>
              <input className="admin-form-input" id="issuer" name="issuer" type="url" defaultValue="http://localhost:3000" required />
              <p className="admin-form-help">Must match the public origin clients use. Changing this invalidates all active tokens.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="accessTokenTtl">Access Token TTL (seconds)</label>
              <input className="admin-form-input" id="accessTokenTtl" name="accessTokenTtl" type="number" min="300" max="3600" step="60" defaultValue={900} />
              <p className="admin-form-help">Lifetime of issued access tokens.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="refreshTokenTtl">Refresh Token TTL (days)</label>
              <input className="admin-form-input" id="refreshTokenTtl" name="refreshTokenTtl" type="number" min="1" max="90" step="1" defaultValue={30} />
              <p className="admin-form-help">Lifetime of refresh tokens.</p>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label" htmlFor="codeTtl">Auth Code TTL (seconds)</label>
              <input className="admin-form-input" id="codeTtl" name="codeTtl" type="number" min="60" max="600" step="30" defaultValue={600} />
              <p className="admin-form-help">Authorization code lifetime (PKCE flow).</p>
            </div>
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="btn btn-primary">Save OIDC Config</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card" aria-labelledby="features-heading">
        <h2 id="features-heading" className="panel-title">Feature Flags</h2>
        <form className="admin-form" action={saveFeatureFlags} method="post">
          <div className="admin-form-row">
            <div className="admin-form-field">
              <label className="admin-form-label">MFA Enforcement</label>
              <div className="toggle-group">
                <label className="toggle-label">
                  <input type="checkbox" name="mfaRequiredForAdmins" defaultChecked />
                  <span>Require MFA for admin accounts</span>
                </label>
                <label className="toggle-label">
                  <input type="checkbox" name="mfaRequiredForSupervisors" defaultChecked />
                  <span>Require MFA for supervisor accounts</span>
                </label>
                <label className="toggle-label">
                  <input type="checkbox" name="mfaOptionalForEmployees" defaultChecked />
                  <span>Allow optional MFA for employees</span>
                </label>
              </div>
            </div>
            <div className="admin-form-field">
              <label className="admin-form-label">Session Security</label>
              <div className="toggle-group">
                <label className="toggle-label">
                  <input type="checkbox" name="strictSessionBinding" defaultChecked />
                  <span>Bind sessions to IP/User-Agent</span>
                </label>
                <label className="toggle-label">
                  <input type="checkbox" name="revokeOnPasswordChange" defaultChecked />
                  <span>Revoke all sessions on password change</span>
                </label>
                <label className="toggle-label">
                  <input type="checkbox" name="revokeOnMfaDisable" defaultChecked />
                  <span>Revoke sessions when MFA is disabled</span>
                </label>
              </div>
            </div>
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="btn btn-primary">Save Feature Flags</button>
          </div>
        </form>
      </section>

      <section className="dashboard-card" aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading" className="panel-title">Maintenance</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--semantic-space-gap-md)', alignItems: 'center' }}>
          <form action={clearRateLimitsAction}>
            <input type="hidden" name="confirm" value="clear-rate-limits" />
            <ConfirmSubmit
              message="Clear every rate-limit bucket? Active lockouts will be lifted on this instance only."
              className="btn btn-warning"
            >
              <Icon name="shield-off" size={16} />
              <span>Clear All Rate Limits</span>
            </ConfirmSubmit>
          </form>
          <form action={clearExpiredSessionsAction}>
            <input type="hidden" name="confirm" value="clear-sessions" />
            <ConfirmSubmit
              message="Purge sessions past their absolute or idle deadline? Live sessions are untouched."
              className="btn btn-warning"
            >
              <Icon name="trash" size={16} />
              <span>Clear Expired Sessions</span>
            </ConfirmSubmit>
          </form>
          <form action={rotateSigningKeysAction}>
            <input type="hidden" name="confirm" value="rotate" />
            <button type="submit" className="btn btn-danger">
              <Icon name="rotate-cw" size={16} />
              <span>Rotate Signing Keys</span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`toast toast--${type}`} role="alert" style={{ marginBottom: 'var(--semantic-space-gap-lg)' }}>
      <div className="toast-content">
        <p className="toast-title">{type === 'success' ? 'Success' : 'Error'}</p>
        <p className="toast-message">{message}</p>
      </div>
    </div>
  );
}


