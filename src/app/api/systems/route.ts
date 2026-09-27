/**
 * GET /api/systems — the catalogue, for a client that needs it.
 *
 * Returns only what a signed-in viewer is allowed to know: accessible systems in
 * full, restricted ones reduced to name/category/required-roles. The launch
 * endpoints re-check authorization regardless, so this response is a
 * convenience, never the control.
 */

import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/guards';
import { canAccess, listSystems } from '@/lib/systems';

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'A session is required to list systems.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const available = [];
  const restricted = [];

  for (const system of listSystems()) {
    if (canAccess(system, viewer.user.roles)) {
      available.push(system);
    } else {
      // Deliberately not the full record: no URL, no scopes, no owner.
      restricted.push({
        slug: system.slug,
        name: system.name,
        shortName: system.shortName,
        category: system.category,
        requiredRoles: system.allowedRoles,
      });
    }
  }

  return NextResponse.json(
    { available, restricted },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
