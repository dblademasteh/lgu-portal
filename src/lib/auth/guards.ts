/**
 * Page-level authorisation guards.
 *
 * These run in the server layer and are authoritative: they resolve the session,
 * load the user, and redirect. `middleware.ts` only does a fast cookie-presence
 * check to avoid rendering protected pages for signed-out users — it never
 * treats itself as the source of truth.
 */

import { redirect } from 'next/navigation';
import { readSession } from './sessions';
import { findUserById, type UserRecord } from './users';
import { canAccess, getSystem, type System } from '../systems';
import { sessionLifetime, type SessionLifetime } from './sessions';

export type Viewer = {
  user: UserRecord;
  sessionId: string;
  authTime: number;
  mfaVerified: boolean;
  amr: string[];
  lifetime: SessionLifetime;
};

export type ViewerWithSystems = Viewer & {
  /** Systems this viewer may launch, plus the ones they may not, for the UI. */
  available: System[];
  restricted: System[];
};

/**
 * Resolve the current viewer, or null.
 * Not cached because it calls `readSession` which uses `cookies()` - a dynamic function.
 */
export async function getViewer(): Promise<Viewer | null> {
  const session = await readSession();
  if (!session) return null;

  const user = await findUserById(session.userId);
  // A session whose user has since been deleted is not a valid session.
  if (!user) return null;

  return {
    user,
    sessionId: session.id,
    authTime: session.authTime,
    mfaVerified: session.mfaVerified,
    amr: session.amr,
    lifetime: sessionLifetime(session),
  };
}

/** Guard for pages that require any authenticated session. */
export async function requireViewer(returnTo?: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/login${next}`);
  }
  return viewer;
}

/**
 * Guard for a page scoped to one system. Three distinct failures, three
 * distinct responses: signed out -> sign in, unknown system -> 404, no role ->
 * an explicit denial page rather than a bare redirect.
 */
export async function requireSystemAccess(
  slug: string,
): Promise<{ viewer: Viewer; system: System }> {
  const system = getSystem(slug);
  if (!system) {
    redirect('/not-found');
  }

  const viewer = await requireViewer(`/launch/${slug}`);
  if (!canAccess(system, viewer.user.roles)) {
    redirect(`/unauthorized?system=${encodeURIComponent(slug)}`);
  }

  return { viewer, system };
}

export async function requireViewerWithSystems(): Promise<ViewerWithSystems> {
  const viewer = await requireViewer('/portal');
  const { listSystems } = await import('../systems');
  const all = listSystems();

  return {
    ...viewer,
    available: all.filter((system) => canAccess(system, viewer.user.roles)),
    restricted: all.filter((system) => !canAccess(system, viewer.user.roles)),
  };
}
