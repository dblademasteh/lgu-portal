/**
 * POST /api/oidc/consent — record the user's consent and continue authorization.
 *
 * The consent page POSTs here after the user approves the requested scopes.
 * The original authorize request is replayed verbatim from a single `request`
 * field and returned with consent=approved, so the authorize endpoint sees
 * exactly the request it originally received — including response_type and the
 * PKCE challenge — and can issue the code.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { recordConsent, hasConsent } from '@/lib/auth/consent';
import { replayAuthorizeRequest } from '@/lib/auth/consent-replay';
import { record } from '@/lib/auth/audit';

export async function POST(request: NextRequest) {
  const sessionId = readSessionCookie(request);
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.redirect(new URL('/login?next=/consent', request.url));
  }

  const body = await request.formData();

  // The consent page replays the authorize request verbatim in a single field.
  // Rebuilding it from individual fields is what previously dropped
  // response_type and the PKCE challenge, so approval always came back as
  // error=unsupported_response_type. Replaying the original query cannot lose a
  // parameter, and authorize re-validates all of them.
  const replay = String(body.get('request') ?? '');
  if (!replay) {
    return NextResponse.redirect(new URL('/consent?error=missing_params', request.url));
  }

  const replayParams = new URLSearchParams(replay);
  const clientId = replayParams.get('client_id') ?? '';
  const scope = replayParams.get('scope') ?? '';
  const redirectUri = replayParams.get('redirect_uri') ?? '';

  if (!clientId || !scope || !redirectUri) {
    return NextResponse.redirect(new URL('/consent?error=missing_params', request.url));
  }

  const scopes = scope.split(/\s+/).filter(Boolean);
  recordConsent(session.userId, clientId, scopes);

  record('oidc.token.issued', 'success', {
    actorId: session.userId,
    target: clientId,
    detail: `consent granted for scopes: ${scopes.join(', ')}`,
    sessionId: session.id,
  });

  const authorizeUrl = new URL(
    `/api/oidc/authorize?${replayAuthorizeRequest(replay, 'approved')}`,
    request.url,
  );

  return NextResponse.redirect(authorizeUrl, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
