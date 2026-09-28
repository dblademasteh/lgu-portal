/**
 * POST /api/oidc/consent — record the user's consent and continue authorization.
 *
 * The consent page POSTs here after the user approves the requested scopes.
 * This endpoint records the decision and redirects back to /api/oidc/authorize
 * with consent=approved so the authorize endpoint can issue the code.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { recordConsent, hasConsent } from '@/lib/auth/consent';
import { record } from '@/lib/auth/audit';

export async function POST(request: NextRequest) {
  const sessionId = readSessionCookie(request);
  const session = await getSession(sessionId);
  if (!session) {
    return NextResponse.redirect(new URL('/login?next=/consent', request.url));
  }

  const body = await request.formData();
  const clientId = String(body.get('client_id') ?? '');
  const scope = String(body.get('scope') ?? '');
  const state = String(body.get('state') ?? '');
  const redirectUri = String(body.get('redirect_uri') ?? '');

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

  const authorizeUrl = new URL('/api/oidc/authorize', request.url);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('consent', 'approved');

  return NextResponse.redirect(authorizeUrl, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
