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
import { BrandLockup } from '@/components/BrandMark';
import { LoginForm } from '@/components/LoginForm';
import { TrustSignals } from '@/components/TrustSignals';
import { OIDC_ISSUER } from '@/lib/oidc';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the LGU Portal single sign-on gateway.',
};

type SearchParams = Promise<{ next?: string | string[]; client?: string | string[] }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstValue(params.next));

  // Already authenticated — nothing to do here.
  const viewer = await getViewer();
  if (viewer) redirect(nextPath);

  // If the flow began as a request for a specific client, name it, so the user
  // knows what they are signing in to.
  const clientId = firstValue(params.client);
  const serviceName = clientId?.startsWith('lgu-')
    ? prettyClientName(clientId.slice(4))
    : undefined;

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <main className="auth-layout" id="main">
        <section className="auth-pitch" aria-labelledby="pitch-title">
          <BrandLockup />
          <div className="auth-pitch-text">
            <p className="eyebrow">Single sign-on gateway</p>
            <h1 className="display-1" id="pitch-title">
              One credential.
              <br />
              Every system.
            </h1>
            <p className="text-body auth-pitch-lede">
              Sign in once and reach every connected LGU system with your existing
              account. No separate logins, no shared passwords, no re-entry.
            </p>
          </div>
          <TrustSignals />
        </section>

        <section className="auth-card glass" aria-labelledby="signin-title">
          <header className="auth-card-head">
            <h2 className="display-2" id="signin-title">
              Sign in
            </h2>
            <p className="text-meta">Use your LGU directory account.</p>
          </header>

          <LoginForm nextPath={nextPath} serviceName={serviceName} />

          <footer className="auth-card-foot">
            <p className="text-meta">
              Authorisation server
              <br />
              <span className="mono">{OIDC_ISSUER}</span>
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
