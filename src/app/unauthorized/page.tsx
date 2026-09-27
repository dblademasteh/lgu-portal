/**
 * /unauthorized — an explicit denial.
 *
 * Distinct from a 404 on purpose. "You do not have access" and "this does not
 * exist" are different answers, and collapsing them into one either leaks
 * existence or leaves staff unable to tell a genuine misconfiguration from a
 * missing link. This page names the system, the roles it needs, and what to do
 * next.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer } from '@/lib/auth/guards';
import { getSystem } from '@/lib/systems';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { BrandLockup } from '@/components/BrandMark';
import { GrantPill } from '@/components/Pills';


export const metadata: Metadata = {
  title: 'Access not permitted',
  robots: { index: false, follow: false },
};

const REASONS: Record<string, string> = {
  maintenance: 'This system is in a scheduled maintenance window and cannot be launched right now.',
  access_denied: 'Your role does not include this system.',
  invalid_grant: 'That sign-on request expired or was already used. Start again from the portal.',
  state_mismatch: 'The sign-on request could not be verified. Start again from the portal.',
  login_required: 'Your session ended before the sign-on completed.',
  unauthorized_client: 'That system is not registered with the portal.',
  invalid_request: 'The sign-on request was malformed.',
  token_bad_signature: 'The issued token failed verification and was rejected.',
  token_audience_mismatch: 'The token was issued for a different system and was rejected.',
  token_expired: 'The issued token had already expired.',
};

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ system?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const system = params.system ? getSystem(params.system) : null;
  const reasonKey = params.reason ?? 'access_denied';
  const explanation = REASONS[reasonKey] ?? 'This request was not permitted.';

  // Signed-out visitors get the sign-in wall instead; there is no point showing
  // them a role they do not have. redirect() returns never, so viewer is
  // narrowed to non-null below.
  if (!viewer) redirect(`/login${system ? `?next=${encodeURIComponent(`/launch/${system.slug}`)}` : ''}`);

  return (
    <div className="page-shell">
      <AuroraBackdrop />
      <PortalNavLite name={viewer.user.displayName} />

      <main className="container page-body" id="main">
        <section className="glass panel denial" role="alert">
          <p className="eyebrow">Access not permitted</p>
          <h1 className="display-1">
            {system ? system.name : 'That request was declined'}
          </h1>
          <p className="text-body">{explanation}</p>

          {system ? (
            <dl className="definition-list">
              <dt>System</dt>
              <dd>{system.name}</dd>

              <dt>Owning office</dt>
              <dd>{system.owner}</dd>

              <dt>Your roles</dt>
              <dd>
                <span className="role-list">
                  {viewer.user.roles.map((role) => (
                    <GrantPill key={role}>{role}</GrantPill>
                  ))}
                </span>
              </dd>

              <dt>Requires</dt>
              <dd>
                <span className="role-list">
                  {system.allowedRoles.map((role) => (
                    <span key={role} className="pill" data-tone="neutral">
                      {role}
                    </span>
                  ))}
                </span>
              </dd>

              {system.ticketQueue ? (
                <>
                  <dt>Request access</dt>
                  <dd className="mono">{system.ticketQueue}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          <div className="denial-actions">
            <Link className="btn btn-primary btn-md" href="/portal">
              <span className="btn-label">Back to systems</span>
            </Link>
            <Link className="btn btn-secondary btn-md" href="/account">
              <span className="btn-label">Review my roles</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Minimal chrome: enough to orient, without pretending to be the portal. */
function PortalNavLite({ name }: { name: string }) {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <BrandLockup href="/portal" />
        <div className="nav-identity">
          <span className="text-meta">{name}</span>
        </div>
      </div>
    </header>
  );
}
