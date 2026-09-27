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
      // Even if the request failed, send them to sign in: the cookie may or may
      // not have been cleared, and the login page redirects onward if it was.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm signout-button"
      onClick={signOut}
      disabled={pending}
    >
      <span className="btn-label">{pending ? 'Signing out…' : 'Sign out'}</span>
    </button>
  );
}
