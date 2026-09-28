/**
 * /consent — OIDC consent screen.
 *
 * Shown when a user has not previously approved the scopes requested by a
 * client. The user can approve (which records consent and continues the
 * authorize flow) or deny (which returns access_denied to the client).
 */

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/guards';
import { getSystem } from '@/lib/systems';
import { clientIdFor } from '@/lib/oidc';
import { describeScope } from '@/lib/auth/consent';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Consent',
  description: 'Review the permissions requested by the system.',
};

type SearchParams = Promise<{
  client_id?: string | string[];
  scope?: string | string[];
  state?: string | string[];
  redirect_uri?: string | string[];
  error?: string | string[];
}>;

export default async function ConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const clientId = firstValue(params.client_id);
  const scope = firstValue(params.scope) ?? '';
  const state = firstValue(params.state) ?? '';
  const redirectUri = firstValue(params.redirect_uri) ?? '';
  const error = firstValue(params.error);

  if (!clientId || !redirectUri) {
    return (
      <div className="page-shell">
        <AuroraBackdrop />
        <main className="auth-layout">
          <section className="auth-card glass">
            <h2 className="display-2">Invalid consent request</h2>
            <p className="text-body">Missing client_id or redirect_uri.</p>
          </section>
        </main>
      </div>
    );
  }

  const system = clientId.startsWith('lgu-')
    ? getSystem(clientId.slice(4))
    : null;
  const systemName = system?.name ?? clientId;
  const scopes = scope.split(/\s+/).filter(Boolean);

  return (
    <div className="page-shell">
      <AuroraBackdrop />
      <main className="auth-layout" id="main">
        <section className="auth-pitch" aria-labelledby="consent-title">
          <h1 className="display-1" id="consent-title">
            Consent requested
          </h1>
          <p className="text-body auth-pitch-lede">
            <strong>{systemName}</strong> is requesting access to your account.
          </p>
        </section>

        <section className="auth-card glass" aria-labelledby="consent-details">
          <header className="auth-card-head">
            <h2 className="display-2" id="consent-details">
              Permissions
            </h2>
            <p className="text-meta">
              Approving will allow this system to access the following:
            </p>
          </header>

          {error && (
            <p className="text-body" style={{ color: 'var(--semantic-color-danger)', marginBottom: '1rem' }}>
              {error}
            </p>
          )}

          <ul className="consent-scopes" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {scopes.map((s) => (
              <li key={s} className="consent-scope-item" style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'var(--semantic-glass-surface)',
                borderRadius: 'var(--primitive-radius-md)',
                border: '1px solid var(--semantic-glass-border)',
              }}>
                <span className="mono" style={{
                  fontSize: 'var(--semantic-text-size-sm)',
                  color: 'var(--semantic-color-accent)',
                  fontWeight: 600,
                }}>
                  {s}
                </span>
                <span style={{ fontSize: 'var(--semantic-text-size-sm)', color: 'var(--semantic-color-muted)' }}>
                  {describeScope(s)}
                </span>
              </li>
            ))}
          </ul>

          <form method="POST" action="/api/oidc/consent" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="state" value={state} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />

            <button type="submit" className="button button-primary button-block">
              Approve
            </button>
            <a
              href={`/api/oidc/consent/deny?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`}
              className="button button-ghost button-block"
              style={{ textAlign: 'center' }}
            >
              Deny
            </a>
          </form>
        </section>
      </main>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
