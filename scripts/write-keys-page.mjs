import { writeFileSync } from 'fs'

const content = `import { requireAdmin } from '@/lib/admin/guards'
import { getSigningKeys, exportJwks } from '@/lib/admin/keys'
import { AuroraBackdrop } from '@/components/AuroraBackdrop'
import { Icon } from '@/components/Icon'
import type { Metadata } from 'next'
import { EmptyState, StatusPill } from '@/components/Pills'
import { Icon } from '@/components/Icon'
import { rotateKeys, isRotating, revokeKey, copyToClipboard } from './utils'

export const metadata: Metadata = { title: 'Signing Keys' }

export default async function KeysPage() {
  const admin = await requireAdmin()
  const keys = await getSigningKeys()
  const jwks = await exportJwks()
  const rotating = isRotating()

  return (
    <div className="page-shell">
      <AuroraBackdrop />

      <header className="page-header">
        <div>
          <h1 className="display-1">Signing Keys</h1>
          <p className="text-body text-meta">Manage RS256 key pairs for OIDC token signing and JWKS publication.</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--semantic-space-gap-sm)' }}>
          <a href="/api/oidc/jwks" target="_blank" rel="noopener" className="btn btn-secondary">
            <Icon name="external-link" size={16} />
            <span>View JWKS</span>
          </a>
          <button className="btn btn-primary" onClick={rotateKeys} disabled={rotating}>
            <Icon name={rotating ? 'loader' : 'rotate-cw'} size={16} />
            <span>{rotating ? 'Rotating...' : 'Rotate Keys Now'}</span>
          </button>
        </div>
      </header>

      <section className="dashboard-card" aria-labelledby="keys-heading">
        <h2 id="keys-heading" className="panel-title">Active Key Pair</h2>

        {keys.length === 0 ? (
          <EmptyState
            icon="shield"
            title="No keys generated"
            description="Generate your first RS256 key pair to sign OIDC tokens."
            action={{ label: 'Generate Keys', href: '#' }}
          />
        ) : (
          <div className="key-grid">
            {keys.map((key, idx) => (
              <div key={key.kid} className="key-card">
                <header className="key-header">
                  <div>
                    <h3 className="key-title">Key #{idx + 1}</h3>
                    <span className="key-meta mono">{key.kid}</span>
                  </div>
                  <StatusPill status={key.active ? 'operational' : 'degraded'} label={key.active ? 'Active' : 'Retired'} />
                </header>

                <dl className="key-details">
                  <dt>Algorithm</dt>
                  <dd className="mono">{key.alg}</dd>

                  <dt>Use</dt>
                  <dd>{key.use}</dd>

                  <dt>Created</dt>
                  <dd className="mono">{new Date(key.createdAt).toLocaleString()}</dd>

                  <dt>Expires</dt>
                  <dd className="mono">{key.expiresAt ? new Date(key.expiresAt).toLocaleString() : 'Never'}</dd>

                  <dt>Public Key (PEM)</dt>
                  <dd>
                    <div className="key-pem">
                      <pre className="key-pem-text">{key.publicKeyPem}</pre>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => copyToClipboard(key.publicKeyPem)}
                      >
                        <Icon name="copy" size={14} />
                        <span>Copy</span>
                      </button>
                    </div>
                  </dd>

                  <dt>Private Key (PEM)</dt>
                  <dd>
                    <div className="key-pem">
                      <pre className="key-pem-text">{key.privateKeyPem}</pre>
                      <button
                        className="btn btn-ghost btn-sm btn-warning"
                        onClick={() => copyToClipboard(key.privateKeyPem)}
                      >
                        <Icon name="copy" size={14} />
                        <span>Copy (sensitive)</span>
                      </button>
                    </div>
                  </dd>
                </dl>

                <div className="key-actions">
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => revokeKey(key.kid)}
                    disabled={keys.length === 1}
                  >
                    <Icon name="trash" size={14} />
                    <span>Revoke</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      <section className="dashboard-card" aria-labelledby="jwks-heading">
        <h2 id="jwks-heading" className="panel-title">JWKS Endpoint</h2>
        <p className="text-body text-meta" style={{ marginBottom: 'var(--semantic-space-gap-md)' }}>
          The JSON Web Key Set is published at <code className="mono">/.well-known/openid-configuration</code>
          and <code className="mono">/api/oidc/jwks</code>. Clients use this to verify token signatures.
        </p>
        <div className="key-pem">
          <pre className="key-pem-text">{JSON.stringify(jwks, null, 2)}</pre>
          <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(JSON.stringify(jwks, null, 2))}>
            <Icon name="copy" size={14} />
            <span>Copy JWKS</span>
          </button>
        </div>
      </section>

      <section className="dashboard-card" aria-labelledby="rotation-heading">
        <h2 id="rotation-heading" className="panel-title">Key Rotation</h2>
        <p className="text-body text-meta" style={{ marginBottom: 'var(--semantic-space-gap-md)' }}>
          Rotating keys generates a new key pair, marks the current key as retired (but keeps it for
          verifying existing tokens), and makes the new key active. Schedule regular rotation
          (e.g., every 90 days) for production.
        </p>
        <button className="btn btn-primary" onClick={rotateKeys} disabled={rotating}>
          <Icon name={rotating ? 'loader' : 'rotate-cw'} size={16} />
          <span>{rotating ? 'Rotating...' : 'Rotate Keys Now'}</span>
        </button>
        <p className="text-meta" style={{ marginTop: 'var(--semantic-space-gap-sm)' }}>
          <strong>Note:</strong> Active tokens signed with the old key remain valid until expiry.
          The old key is retained for verification. Plan rotation during low-traffic periods.
        </p>
      </section>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={28} />
      </div>
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
    </div>
  )
}`

writeFileSync('D:\\\\Users\\\\EngrFire\\\\Desktop\\\\lgu-portal\\\\src\\\\app\\\\admin\\\\keys\\\\page.tsx', content, 'utf8')
console.log('File written successfully')