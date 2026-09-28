import { requireAdmin } from '@/lib/admin/guards';
import { getSigningKeys, exportJwks, isSigningKeyProvisioned } from '@/lib/admin/keys';
import { rotateSigningKeysAction, revokeSigningKeyAction } from '@/lib/admin/keys-actions';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { Icon } from '@/components/Icon';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Signing Keys' };

function readFlag(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const [keys, jwks, params] = await Promise.all([getSigningKeys(), exportJwks(), searchParams]);
  const provisioned = isSigningKeyProvisioned();

  const notice = readFlag(params, 'rotated')
    ? 'A new key is now active. The previous key stays published for 30 days so existing tokens still verify.'
    : readFlag(params, 'revoked')
      ? 'Key revoked and withdrawn from the published JWKS.'
      : null;
  const error = readFlag(params, 'error');

  return (
    <div className="page-shell">
      <AuroraBackdrop />
      <header className="page-header">
        <div>
          <h1 className="display-1">Signing Keys</h1>
          <p className="text-body text-meta">
            RS256 key pairs for the OIDC signing migration. Rotating mints a real 2048-bit RSA pair
            and retires the current one.
          </p>
        </div>
      </header>

      {notice ? (
        <p className="text-body">
          <span className="pill" data-tone="success">
            {notice}
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="text-body">
          <span className="pill pill--danger">{error}</span>
        </p>
      ) : null}

      <section className="dashboard-card" aria-labelledby="keyring-heading">
        <div className="card-header">
          <h2 id="keyring-heading" className="panel-title">
            Key Ring
          </h2>
          {provisioned ? (
            <p className="text-body text-meta">
              Signing keys come from <code>OIDC_SIGNING_PRIVATE_KEY</code>, so they are shared by every
              replica and cannot be rotated here. Update the secret and roll the deployment; the previous
              key stays published for the grace window so outstanding tokens keep verifying.
            </p>
          ) : (
            <form action={rotateSigningKeysAction}>
              <input type="hidden" name="confirm" value="rotate" />
              <button type="submit" className="btn btn-primary">
                <Icon name="rotate-cw" size={16} />
                <span>Rotate signing keys</span>
              </button>
            </form>
          )}
        </div>

        {keys.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No keys generated</p>
            <p className="empty-state-description">Rotate to mint the first key pair.</p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Key ID</th>
                  <th scope="col">State</th>
                  <th scope="col">Created</th>
                  <th scope="col">Retires</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.kid}>
                    <td>
                      <code className="mono">{key.kid}</code>
                    </td>
                    <td>
                      {key.active ? (
                        <span className="pill" data-tone="success">
                          Active
                        </span>
                      ) : (
                        <span className="pill" data-tone="neutral">
                          Retired
                        </span>
                      )}
                    </td>
                    <td className="mono">{new Date(key.createdAt).toISOString()}</td>
                    <td className="mono">
                      {key.expiresAt ? new Date(key.expiresAt).toISOString() : '—'}
                    </td>
                    <td>
                      {key.active ? null : (
                        <form action={revokeSigningKeyAction}>
                          <input type="hidden" name="kid" value={key.kid} />
                          <button type="submit" className="btn btn-danger btn-sm">
                            <Icon name="shield-off" size={14} />
                            <span>Revoke</span>
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="definition-list">
          <dt>Signed in as</dt>
          <dd>{admin.user.displayName}</dd>
          <dt>Audit</dt>
          <dd>Rotations and revocations are written to the audit log.</dd>
        </dl>
      </section>

      <section className="dashboard-card" aria-labelledby="jwks-heading">
        <h2 id="jwks-heading" className="panel-title">
          JWKS Endpoint
        </h2>
        <p className="text-body text-meta">
          The key set a relying party would fetch. This is a real JWK Set: <code>n</code> and{' '}
          <code>e</code> are lifted from the public key, so a standard JWT verifier can check a
          signature against it.
        </p>
        <pre className="mono">{JSON.stringify(jwks, null, 2)}</pre>
      </section>
    </div>
  );
}
