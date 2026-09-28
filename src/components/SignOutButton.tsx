'use client';

/**
 * Sign-out control.
 *
 * POST, never a link. A GET logout is reachable by any image tag or link on any
 * page, which is a forced-logout nuisance at best. This posts to /api/auth/logout
 * and follows the server's redirect with router.replace, so the portal does not
 * sit in the back-button history of a signed-out session.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SignOutButton({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const response = await fetch(`/api/auth/logout?next=${encodeURIComponent(next ?? '/login')}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = (await response.json()) as { redirectTo?: string };
      router.replace(data.redirectTo ?? '/login');
      router.refresh();
    } catch {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="btn btn-ghost signout-button"
      onClick={signOut}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span className="btn-label">{pending ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
