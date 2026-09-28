/**
 * GET /api/oidc/consent/deny — user declined consent.
 *
 * Redirects back to /api/oidc/authorize with consent=denied so the authorize
 * endpoint can return an access_denied error to the client.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { replayAuthorizeRequest } from '@/lib/auth/consent-replay';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Same replay contract as the approve path: the original authorize request is
  // carried through intact so the denial reaches the client as access_denied
  // rather than being rejected first for a missing response_type.
  const replay = params.get('request') ?? '';
  if (!replay) {
    return NextResponse.redirect(new URL('/consent?error=missing_params', request.url));
  }

  const authorizeUrl = new URL(
    `/api/oidc/authorize?${replayAuthorizeRequest(replay, 'denied')}`,
    request.url,
  );

  return NextResponse.redirect(authorizeUrl, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
