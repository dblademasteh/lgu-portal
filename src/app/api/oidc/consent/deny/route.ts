/**
 * GET /api/oidc/consent/deny — user declined consent.
 *
 * Redirects back to /api/oidc/authorize with consent=denied so the authorize
 * endpoint can return an access_denied error to the client.
 */

import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';

  const authorizeUrl = new URL('/api/oidc/authorize', request.url);
  authorizeUrl.searchParams.set('consent', 'denied');
  if (state) authorizeUrl.searchParams.set('state', state);
  if (redirectUri) authorizeUrl.searchParams.set('redirect_uri', redirectUri);

  return NextResponse.redirect(authorizeUrl, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
