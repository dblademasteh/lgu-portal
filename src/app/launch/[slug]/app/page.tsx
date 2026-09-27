/**
 * /launch/[slug]/app — the simulated downstream application.
 *
 * Stands in for the system the user would actually land on. Its job in this demo
 * is to prove the handoff worked: it renders the claims that came back from the
 * token endpoint, decoded and verified server-side, plus the exact flow that
 * produced them.
 *
 * The handoff ticket is single-use, so reloading this page lands back on the
 * portal with a note rather than silently showing a stale grant.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { requireViewer } from '@/lib/auth/guards';
import { getSystem } from '@/lib/systems';
import { HANDOFF_COOKIE, openTicket, consumeHandoff } from '@/lib/handoff';
import { verifyAccessToken } from '@/lib/oidc';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { BrandLockup } from '@/components/BrandMark';
import { PortalNav } from '@/components/PortalNav';
import { Icon } from '@/components/Icon';
import { GrantPill, StatusPill } from '@/components/Pills';
import { statusLabel } from '@/lib/systems';
import { decodeJwtPayload } from '@/lib/jwt-view';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug} — session` };
}

export default async function LaunchedAppPage({ params }: { params: Params }) {
  const { slug } = await params;
  const viewer = await requireViewer();

  const system = getSystem(slug);
  if (!system) redirect('/not-found');

  // Redeem the single-use ticket. Anything already spent or expired means the
  // user arrived without a fresh grant.
  const raw = (await cookies()).get(HANDOFF_COOKIE)?.value;
  const ticket = openTicket(raw);
  const handoff = consumeHandoff(ticket);

  if (!handoff || handoff.slug !== slug) {
    redirect(`/portal?relaunch=${encodeURIComponent(slug)}`);
  }

  // Verify the access token the authorisation server issued for this client.
  // A tampered or mis-audienced token stops here rather than rendering claims.
   const verified = await verifyAccessToken(handoff.tokens.access_token, handoff.clientId);
  if (!verified.ok) {
    redirect(`/unauthorized?system=${encodeURIComponent(slug)}&reason=token_${verified.error.replace(/\s+/g, '_')}`);
  }

  const claims = verified.claims;
  const idClaims = decodeJwtPayload(handoff.tokens.id_token);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <div className="page-shell">
      <AuroraBackdrop />
      <PortalNav viewer={viewer} active="/portal" />

      <main className="container page-body" id="main">
        <header className="launch-head">
          <div className="launch-identity">
            <span className="launch-mark" style={{ '--tile-hue': String(system.accent) } as React.CSSProperties}>
              <Icon name={system.icon} size={26} />
            </span>
            <div className="launch-identity-text">
              <p className="eyebrow">Signed in to</p>
              <h1 className="display-1">{system.name}</h1>
              <p className="text-body">
                You were issued a single-use grant for this system. No password was entered.
              </p>
            </div>
          </div>
          <StatusPill status={system.status} label={statusLabel(system.status)} />
        </header>

        <section className="launch-grid">
          <div className="glass panel">
            <div className="panel-head">
              <h2 className="panel-title">What this system received</h2>
              <span className="pill" data-tone="success">Verified</span>
            </div>

            <dl className="definition-list">
              <dt>Subject</dt>
              <dd className="mono">{claims.sub}</dd>

              <dt>Employee no.</dt>
              <dd className="mono">{claims.employee_id ?? viewer.user.employeeId}</dd>

              <dt>Name</dt>
              <dd>{claims.name}</dd>

              <dt>Email</dt>
              <dd>{claims.email}</dd>

              <dt>Office</dt>
              <dd>{claims.department}</dd>

              <dt>Roles</dt>
              <dd>
                <span className="role-list">
                  {(claims.roles ?? []).map((role) => (
                    <GrantPill key={role}>{role}</GrantPill>
                  ))}
                </span>
              </dd>

              <dt>Scopes</dt>
              <dd>
                <span className="role-list">
                  {handoff.scopes.map((scope) => (
                    <span key={scope} className="pill" data-tone="info">
                      {scope}
                    </span>
                  ))}
                </span>
              </dd>

              <dt>Second factor</dt>
              <dd>{handoff.mfaVerified ? 'Verified this session' : 'Not required for this account'}</dd>
            </dl>
          </div>

          <div className="glass panel">
            <div className="panel-head">
              <h2 className="panel-title">Token details</h2>
            </div>

            <dl className="definition-list">
              <dt>Client</dt>
              <dd className="mono">{handoff.clientId}</dd>

              <dt>Access token</dt>
              <dd>
                <TokenShape token={handoff.tokens.access_token} />
              </dd>

              <dt>ID token</dt>
              <dd>
                <TokenShape token={handoff.tokens.id_token} />
              </dd>

              <dt>Audience</dt>
              <dd className="mono">{Array.isArray(claims.aud) ? claims.aud.join(', ') : claims.aud}</dd>

              <dt>Issuer</dt>
              <dd className="mono">{claims.iss}</dd>

              <dt>Expires in</dt>
              <dd>
                {Math.max(0, (claims.exp ?? nowSeconds) - nowSeconds)}s
              </dd>

              <dt>Session binding</dt>
              <dd className="mono">{claims.sid ?? 'detached'}</dd>
            </dl>

            <div className="launch-actions">
              <a className="btn btn-primary btn-md" href={system.url} rel="noreferrer noopener">
                <span className="btn-label">Continue to {system.shortName}</span>
              </a>
              <a className="btn btn-secondary btn-md" href="/portal">
                <span className="btn-label">Back to systems</span>
              </a>
            </div>
          </div>
        </section>

        <section className="glass panel">
          <div className="panel-head">
            <h2 className="panel-title">Flow that got you here</h2>
          </div>
          <ol className="flow-steps">
            <FlowStep
              n={1}
              title="Portal verified your role for this system"
              detail="requireSystemAccess checked your roles server-side against the catalogue."
            />
            <FlowStep
              n={2}
              title="PKCE challenge created"
              detail="A 384-bit verifier stayed on the server. Only its SHA-256 hash was sent."
            />
            <FlowStep
              n={3}
              title="Authorization endpoint issued a code"
              detail="state was echoed back and matched, blocking a cross-site request forgery."
            />
            <FlowStep
              n={4}
              title="Code redeemed for tokens"
              detail="The code was single-use, bound to this client and redirect URI, and PKCE-verified."
            />
            <FlowStep
              n={5}
              title="Tokens parked behind a one-time ticket"
              detail="Nothing sensitive travelled in a URL. The ticket was consumed to render this page."
            />
          </ol>
        </section>

        {idClaims ? (
          <details className="glass panel launch-details">
            <summary className="panel-title">Raw ID token claims</summary>
            <pre className="token-dump mono">{JSON.stringify(idClaims, null, 2)}</pre>
          </details>
        ) : null}
      </main>
    </div>
  );
}

function FlowStep({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <li className="flow-step">
      <span className="flow-step-n" aria-hidden="true">
        {n}
      </span>
      <span className="flow-step-text">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
    </li>
  );
}

/** Show shape and lifetime of a token without printing the whole secret. */
function TokenShape({ token }: { token: string }) {
  const parts = token.split('.');
  return (
    <span className="token-shape">
      {parts.map((part, index) => (
        <span key={index} className="token-shape-part">
          <span className="token-shape-label">
            {index === 0 ? 'header' : index === 1 ? 'payload' : 'signature'}
          </span>
          <span className="mono">{part.slice(0, 12)}…{part.length - 8} chars</span>
        </span>
      ))}
    </span>
  );
}
