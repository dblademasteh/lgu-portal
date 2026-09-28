/**
 * POST /api/auth/logout — end the SSO session.
 *
 * Also revokes any unspent authorization codes for the user. Without that, a
 * code captured before sign-out would still be redeemable afterwards, which
 * would let a stale grant outlive the session that produced it.
 *
 * Accepts POST only. A GET logout is trivially triggerable cross-site, which is
 * a nuisance at best and a forced-logout vector at worst.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie, destroySession, getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { record } from '@/lib/auth/audit';
import { invalidateCodesForUser } from '@/lib/oidc';

export async function POST(request: NextRequest) {
  const sessionId = readSessionCookie(request);
  const session = await getSession(sessionId);

  if (session) {
    await destroySession(session.id);
    // Revoke unspent codes issued under this session's user, so a code captured
    // before sign-out cannot be redeemed after it.
    const revokedCodes = await invalidateCodesForUser(session.userId);

    record('auth.logout', 'success', {
      actorId: session.userId,
      sessionId: session.id,
      detail: revokedCodes > 0 ? `revoked ${revokedCodes} pending code(s)` : undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
  } else if (sessionId) {
    // A valid signature on an id the store does not know: already expired or
    // already revoked. Still clear the cookie.
    await destroySession(sessionId);
  }

  await clearSessionCookie();

  // Redirect targets are validated as same-origin relative paths.
  const next = request.nextUrl.searchParams.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/login';

  return NextResponse.json(
    { ok: true as const, status: 'signed_out' as const, redirectTo: target },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
