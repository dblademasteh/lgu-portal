/**
 * Admin authorisation guards.
 *
 * These are stricter than the regular viewer guards: they require the `admin`
 * role and are used for all `/admin/*` pages and API routes.
 */

import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getViewer } from '@/lib/auth/guards';
import { type Viewer } from '@/lib/auth/guards';

export type AdminViewer = Viewer & { user: { roles: string[] } };

/**
 * Resolve the current viewer and verify they have the `admin` role.
 * Memoised per request so multiple checks in one render only hit the store once.
 */
export const getAdminViewer = cache(async (): Promise<AdminViewer | null> => {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (!viewer.user.roles.includes('admin')) return null;
  return viewer as AdminViewer;
});

/**
 * Guard for admin pages. Redirects to /unauthorized if not an admin.
 */
export async function requireAdmin(): Promise<AdminViewer> {
  const viewer = await getAdminViewer();
  if (!viewer) {
    redirect('/unauthorized?reason=admin_required');
  }
  return viewer;
}

/**
 * Guard for admin API routes. Returns null if not authorised (caller must respond).
 */
export async function getAdminOrNull(): Promise<AdminViewer | null> {
  return getAdminViewer();
}