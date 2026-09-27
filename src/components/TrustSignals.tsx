/**
 * Trust signals shown beneath the sign-in form.
 *
 * Deliberately factual rather than reassuring. On an authentication surface,
 * vague security claims ("bank-grade encryption") do more harm than good —
 * these state the specific mechanisms a user can verify, so someone deciding
 * whether to trust this form has something real to reason about.
 */

const SIGNALS = [
  {
    title: 'OIDC authorization code + PKCE',
    body: 'Tokens are issued per system, per launch, and never travel in a URL.',
  },
  {
    title: 'Server-side sessions',
    body: 'The cookie is an opaque identifier. Signing out revokes it immediately.',
  },
  {
    title: 'Role-scoped access',
    body: 'Each system checks your role on the server, on every launch.',
  },
] as const;

export function TrustSignals() {
  return (
    <ul className="trust-signals">
      {SIGNALS.map((signal) => (
        <li key={signal.title} className="trust-signal">
          <span className="trust-signal-mark" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
            </svg>
          </span>
          <span className="trust-signal-text">
            <strong>{signal.title}</strong>
            <span>{signal.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
