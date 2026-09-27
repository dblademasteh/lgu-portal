/**
 * Brand mark and wordmark.
 *
 * The glyph is a shield enclosing a chevron: the shield is the trust boundary
 * of the gateway, the chevron is a launch/forward arrow. Drawn on the token
 * accent so it stays legible on both the login and portal surfaces.
 */

import Link from 'next/link';

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="lgu-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--semantic-color-primary)" />
          <stop offset="100%" stopColor="var(--semantic-color-accent)" />
        </linearGradient>
      </defs>
      <path
        d="M20 2.5 5.5 8v11.6C5.5 27.6 11.4 34.2 20 37.5c8.6-3.3 14.5-9.9 14.5-17.9V8L20 2.5Z"
        stroke="url(#lgu-brand)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M14 20.5 18.6 25 26 16.5"
        stroke="url(#lgu-brand)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLockup({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="brand-lockup"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--semantic-space-gap-md)',
        fontFamily: 'var(--semantic-font-family-display)',
        fontSize: 'var(--semantic-nav-brand-size)',
        fontWeight: 'var(--semantic-text-weight-bold)',
        letterSpacing: 'var(--semantic-text-tracking-tight)',
        color: 'var(--semantic-color-foreground)',
      }}
    >
      <BrandMark />
      <span className="brand-text">
        LGU<span style={{ color: 'var(--semantic-color-accent)' }}>Portal</span>
      </span>
    </Link>
  );
}
