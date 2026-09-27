/**
 * GET /api/session — current session state.
 *
 * The client uses this to decide whether to show a sign-in affordance. It is
 * safe to expose at the volume the UI needs: id, display fields and roles only,
 * never the session id or any token.
 */

import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/guards';
import { canAccess, listSystems } from '@/lib/systems';

export async function GET() {
  const viewer = await getViewer();

  if (!viewer) {
    return NextResponse.json(
      { authenticated: false, systems: { available: 0, total: listSystems().length } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const all = listSystems();

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: viewer.user.id,
        displayName: viewer.user.displayName,
        email: viewer.user.email,
        department: viewer.user.department,
        roles: viewer.user.roles,
        mfaVerified: viewer.mfaVerified,
      },
      session: {
        // Which constraint actually ends this session, so the UI can be honest.
        binding: viewer.lifetime.idleIsBinding ? 'idle' : 'absolute',
        remainingMs: viewer.lifetime.idleIsBinding
          ? viewer.lifetime.idleRemainingMs
          : viewer.lifetime.absoluteRemainingMs,
        authTime: viewer.authTime,
      },
      systems: {
        available: all.filter((system) => canAccess(system, viewer.user.roles)).length,
        total: all.length,
      },
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
