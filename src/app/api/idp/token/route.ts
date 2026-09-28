/**
 * POST /api/idp/token — exchange an authorization code for tokens.
 *
 * Called by the portal's IdP callback route after the external provider
 * redirects back with a code. This endpoint exchanges the code for an access
 * token (and optionally a refresh token), fetches the user's profile from the
 * IdP's userinfo endpoint, and returns the claims to the caller.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getIdPConfig, generateCodeVerifier, generateState } from '@/lib/idp/client';

export async function POST(request: NextRequest) {
  const config = getIdPConfig();
  if (!config) {
    return NextResponse.json({ error: 'idp_not_configured' }, { status: 501 });
  }

  const body = await request.formData();
  const code = String(body.get('code') ?? '');
  const verifier = String(body.get('verifier') ?? '');

  if (!code || !verifier) {
    return NextResponse.json({ error: 'missing_code_or_verifier' }, { status: 400 });
  }

  try {
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${request.nextUrl.origin}/api/idp/callback`,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      return NextResponse.json(
        { error: 'token_exchange_failed', detail: text },
        { status: 502 },
      );
    }

    const tokens = await tokenResponse.json();

    const accessToken = tokens.access_token as string | undefined;
    if (!accessToken) {
      return NextResponse.json({ error: 'no_access_token' }, { status: 502 });
    }

    const userinfoResponse = await fetch(config.userinfoUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    if (!userinfoResponse.ok) {
      return NextResponse.json({ error: 'userinfo_failed' }, { status: 502 });
    }

    const userinfo = (await userinfoResponse.json()) as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      accessToken,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      userinfo,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'idp_request_failed', detail: String(error) },
      { status: 502 },
    );
  }
}
