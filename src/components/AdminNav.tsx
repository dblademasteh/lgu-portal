'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutButton } from './SignOutButton';
import { Avatar } from './Avatar';
import { clsx } from 'clsx';

interface AdminNavProps {
  admin: {
    user: {
      displayName: string;
      email: string;
      roles: string[];
    };
  };
}

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: 'home' },
  { href: '/admin/systems', label: 'Systems', icon: 'server' },
  { href: '/admin/users', label: 'Users', icon: 'users' },
  { href: '/admin/clients', label: 'OIDC Clients', icon: 'key' },
  { href: '/admin/keys', label: 'Signing Keys', icon: 'shield' },
  { href: '/admin/audit', label: 'Audit Log', icon: 'activity' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
] as const;

export function AdminNav({ admin }: AdminNavProps) {
  const pathname = usePathname();

  return (
    <header className="admin-nav" role="banner">
      <div className="admin-nav-brand">
        <Link href="/admin" className="brand-lockup" aria-label="LGU Portal Admin">
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="lgu-brand-admin" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--semantic-color-primary)" />
                <stop offset="100%" stopColor="var(--semantic-color-accent)" />
              </linearGradient>
            </defs>
            <path
              d="M20 2.5 5.5 8v11.6C5.5 27.6 11.4 34.2 20 37.5c8.6-3.3 14.5-9.9 14.5-17.9V8L20 2.5Z"
              stroke="url(#lgu-brand-admin)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M14 20.5 18.6 25 26 16.5"
              stroke="url(#lgu-brand-admin)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="brand-text">LGU<span style={{ color: 'var(--semantic-color-accent)' }}>Portal</span> Admin</span>
        </Link>
      </div>

      <nav className="admin-nav-links" aria-label="Admin navigation">
        <ul role="list">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={clsx(
                  'admin-nav-link',
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? 'active'
                    : ''
                )}
                aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
              >
                <span className="admin-nav-link-icon" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="admin-nav-link-label">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="admin-nav-user">
        <Avatar
          name={admin.user.displayName}
          hue={((admin.user.email ?? 'user@example.com').split('@')[0] ?? '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360}
          size="sm"
        />
        <div className="admin-nav-user-info">
          <span className="admin-nav-user-name">{admin.user.displayName}</span>
          <span className="admin-nav-user-role">Administrator</span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}

// Inline icon component for nav items to avoid circular deps
import type { ReactElement } from 'react';
function Icon({ name, size }: { name: string; size: number }) {
  const icons: Record<string, ReactElement> = {
    home: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    server: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    users: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    key: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
      </svg>
    ),
    shield: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    activity: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 1 4.6 9a1.65 1.65 0 0 1 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 1-.33 1.82V9a1.65 1.65 0 0 1 1.51-1H9a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 1 1.82.33l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 1-.33-1.82V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2h.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 1 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 1-.33-1.82V9a1.65 1.65 0 0 1 1.51-1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1 1.51" />
      </svg>
    ),
  };

  return icons[name] || icons.home;
}