/**
 * /login — the SSO entry point.
 *
 * A signed-in visitor is sent straight to the portal, so the login page never
 * becomes a second home. `next` carries the original destination through the
 * sign-in, and is validated server-side before it is ever rendered or followed.
 */

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/guards';
import { safeNextPath } from '@/lib/redirect';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { LoginForm } from '@/components/LoginForm';
import { TrustSignals } from '@/components/TrustSignals';
import { OIDC_ISSUER } from '@/lib/oidc';
import { isIdPEnabled } from '@/lib/idp/client';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the LGU Portal single sign-on gateway.',
};

type SearchParams = Promise<{ next?: string | string[]; client?: string | string[] }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstValue(params.next));
  const idpEnabled = isIdPEnabled();
  const localLoginEnabled = process.env.LOCAL_LOGIN_ENABLED !== 'false';

  const viewer = await getViewer();
  if (viewer) redirect(nextPath);

  const clientId = firstValue(params.client);
  const serviceName = clientId?.startsWith('lgu-')
    ? prettyClientName(clientId.slice(4))
    : undefined;

  const showLocalForm = localLoginEnabled || !idpEnabled;
  const showIdPButton = idpEnabled;

  if (!showLocalForm && !showIdPButton) {
    return (
      <div className="page-shell">
        <AuroraBackdrop />
        <main className="auth-layout" id="main">
          <section className="auth-card" aria-labelledby="signin-title">
            <h2 className="display-2" id="signin-title">
              Sign in
            </h2>
            <p className="text-body">No sign-in method is configured. Contact your administrator.</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <main className="auth-layout" id="main">
        <div className="auth-hero">
          <div className="auth-brand" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="lgu-brand-login" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--semantic-color-primary)" />
                  <stop offset="100%" stopColor="var(--semantic-color-accent)" />
                </linearGradient>
              </defs>
              <path
                d="M20 2.5 5.5 8v11.6C5.5 27.6 11.4 34.2 20 37.5c8.6-3.3 14.5-9.9 14.5-17.9V8L20 2.5Z"
                stroke="url(#lgu-brand-login)"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M14 20.5 18.6 25 26 16.5"
                stroke="url(#lgu-brand-login)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="auth-title">Sign in to the portal</h1>
          <p className="auth-lede">
            One credential for every connected LGU system. Use your directory account below.
          </p>
          <TrustSignals />
        </div>

        <section className="auth-card" aria-labelledby="signin-title">
          <header className="auth-card-head">
            <h2 className="auth-card-title" id="signin-title">Enter your credentials</h2>
            {serviceName && (
              <p className="auth-card-service">
                Continuing to <strong>{serviceName}</strong>
              </p>
            )}
          </header>

          {showIdPButton && (
            <a
              href="/api/idp/login"
              className="btn btn-secondary btn-block"
              style={{ marginBottom: 'var(--semantic-space-gap-md)' }}
            >
              Sign in with External IdP
            </a>
          )}

          {showLocalForm && <LoginForm nextPath={nextPath} serviceName={serviceName} />}

          <footer className="auth-card-foot">
            <p>
              <span className="text-meta">Authorisation server</span>
              <span className="mono text-meta">{OIDC_ISSUER}</span>
            </p>
          </footer>
        </section>
      </main>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function prettyClientName(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
