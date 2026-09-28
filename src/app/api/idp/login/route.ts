/**
 * GET /api/idp/login — redirect the browser to the external IdP.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getIdPConfig, generateCodeVerifier, generateState, setIdPStateCookie, generateCodeChallenge } from '@/lib/idp/client';

export async function GET(request: NextRequest) {
  const config = getIdPConfig();
  if (!config) {
    return NextResponse.json({ error: 'idp_not_configured' }, { status: 501 });
  }

  const verifier = generateCodeVerifier();
  const state = generateState();
  const challenge = generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: `${request.nextUrl.origin}/api/idp/callback`,
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  if (config.clientSecret) {
    // Some providers require client_secret in the authorization request.
    params.set('client_secret', config.clientSecret);
  }

  await setIdPStateCookie(state);

  return NextResponse.redirect(`${config.authorizationUrl}?${params.toString()}`, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
