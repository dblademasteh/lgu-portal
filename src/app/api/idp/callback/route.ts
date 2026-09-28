/**
 * GET /api/idp/callback — handle the redirect back from the external IdP.
 *
 * Validates the state against the cookie, exchanges the code for tokens via the
 * internal token endpoint, and creates a local session. On success, redirects to
 * `/portal` (or the `next` parameter if present and safe).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getIdPStateCookie, clearIdPStateCookie, type IdPUser } from '@/lib/idp/client';
import { safeNextPath } from '@/lib/redirect';
import { createSession, setSessionCookie } from '@/lib/auth/sessions';
import { authenticateWithIdP } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';
import { randomNumericCode, safeEqual } from '@/lib/auth/crypto';

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error');
  if (error) {
    record('auth.idp.failure', 'failure', { detail: error });
    return NextResponse.redirect(new URL('/login?idp_error=' + encodeURIComponent(error), request.url));
  }

  const code = request.nextUrl.searchParams.get('code');
  const returnedState = request.nextUrl.searchParams.get('state');

  if (!code || !returnedState) {
    return NextResponse.redirect(new URL('/login?idp_error=missing_code_or_state', request.url));
  }

  const cookieState = await getIdPStateCookie();
  if (!cookieState || !safeEqual(cookieState, returnedState)) {
    record('auth.idp.failure', 'failure', { detail: 'state_mismatch' });
    return NextResponse.redirect(new URL('/login?idp_error=state_mismatch', request.url));
  }

  await clearIdPStateCookie();

  try {
    const origin = request.nextUrl.origin;
    const tokenRes = await fetch(`${origin}/api/idp/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        verifier: cookieState,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.json();
      record('auth.idp.failure', 'failure', { detail: body.error ?? 'token_exchange_failed' });
      return NextResponse.redirect(new URL('/login?idp_error=token_exchange_failed', request.url));
    }

    const tokenData = await tokenRes.json();
    const userinfo = tokenData.userinfo as Record<string, unknown> | undefined;

    const idpUser: IdPUser = {
      sub: typeof userinfo?.sub === 'string' ? userinfo.sub : '',
      email: typeof userinfo?.email === 'string' ? userinfo.email : undefined,
      name: typeof userinfo?.name === 'string' ? userinfo.name : undefined,
      preferredUsername:
        typeof userinfo?.preferred_username === 'string' ? userinfo.preferred_username : undefined,
      roles: Array.isArray(userinfo?.roles) ? userinfo.roles.filter((r): r is string => typeof r === 'string') : undefined,
    };

    const result = await authenticateWithIdP(idpUser);
    if (!result) {
      record('auth.idp.failure', 'failure', { detail: 'user_sync_failed' });
      return NextResponse.redirect(new URL('/login?idp_error=user_sync_failed', request.url));
    }

    const session = await createSession({
      userId: result.user.id,
      amr: ['idp'],
      mfaVerified: false,
    });
    await setSessionCookie(session);

    record('auth.login.success', 'success', {
      actorId: result.user.id,
      actorLabel: result.user.username,
      sessionId: session.id,
      detail: 'idp',
    });

    const next = safeNextPath(request.nextUrl.searchParams.get('next'), '/portal');
    return NextResponse.redirect(new URL(next, request.url));
  } catch (error) {
    record('auth.idp.failure', 'failure', { detail: String(error) });
    return NextResponse.redirect(new URL('/login?idp_error=server_error', request.url));
  }
}
