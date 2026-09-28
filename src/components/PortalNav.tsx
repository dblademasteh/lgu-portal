'use client';

/**
 * Portal navigation.
 *
 * Client component to avoid server-side serialization issues with template literals
 * in CSS custom properties and client component props.
 */

import Link from 'next/link';
import { BrandMark } from './BrandMark';
import { SignOutButton } from './SignOutButton';
import { Avatar } from './Avatar';
import { clsx } from 'clsx';

const LINKS = [
  { href: '/portal', label: 'Systems' },
  { href: '/account', label: 'My account' },
] as const;

/** Same test as `requireAdmin`, so the link appears exactly when it would work. */
function isAdmin(roles: readonly string[]): boolean {
  return roles.includes('admin');
}

interface PortalNavProps {
  viewer: {
    user: {
      displayName: string;
      email: string;
      avatarHue: number;
      roles: string[];
    };
  };
  active?: string;
}

export function PortalNav({ viewer, active }: { viewer: { user: { displayName: string; email: string; avatarHue: number; roles: string[] } }; active?: string }) {
  const activePath = active ?? '/portal';
  const links = isAdmin(viewer.user.roles)
    ? [...LINKS, { href: '/admin', label: 'Admin' } as const]
    : LINKS;

  return (
    <header className="nav portal-appbar" role="banner">
      <div className="container nav-inner">
        <Link href="/portal" className="portal-brand">
          <BrandMark size={28} />
          <span className="portal-brand-text">
            LGU<span className="portal-brand-accent">Portal</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="nav-links">
          {links.map((link) => {
            const isActive = active === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link"
                data-active={isActive ? 'true' : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="nav-identity">
          <Link href="/account" className="user-chip" data-hue={String(viewer.user.avatarHue)}>
            <Avatar name={viewer.user.displayName} hue={viewer.user.avatarHue} size="sm" />
            <span className="user-chip-text">
              <span className="user-chip-name">{viewer.user.displayName}</span>
              <span className="user-chip-role">{viewer.user.roles[0] ?? 'employee'}</span>
            </span>
          </Link>
          <SignOutButton next="/portal" />
        </div>
      </div>
    </header>
  );
}