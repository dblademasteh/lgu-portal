/**
 * GET /api/oidc/authorize — the authorization endpoint.
 *
 * This is the step that makes the portal a single sign-on: a downstream system
 * redirects here, and because a session already exists the user is never asked
 * to authenticate again. A fresh authorization code is issued every time.
 *
 * Error handling follows the OAuth 2.0 security BCP: a request with an unknown
 * client or an unregistered `redirect_uri` is rendered as an error page and is
 * never redirected, because redirecting an unvalidated URI would make this
 * endpoint an open redirector.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { clientAllows } from '@/lib/oidc';
import { findUserById } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';
import { check } from '@/lib/auth/rate-limit';
import { hasConsent } from '@/lib/auth/consent';
import {
  issueAuthorizationCode,
  validateAuthorizeRequest,
  type AuthorizeError,
} from '@/lib/oidc';

function errorRedirect(
  redirectUri: string,
  error: AuthorizeError,
  description: string,
  state: string | null,
): NextResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  // 302, not 303: the authorization response is carried by the query string
  // on a GET, exactly as the spec prescribes.
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const validation = validateAuthorizeRequest(params);

  if (!validation.ok) {
    record('oidc.token.denied', 'denied', {
      target: params.get('client_id') ?? undefined,
      detail: `${validation.error}: ${validation.description}`,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    });

    if (!validation.redirectUri) {
      // Unregistered redirect target — show the error, do not redirect to it.
      return NextResponse.redirect(
        new URL(`/unauthorized?reason=${encodeURIComponent(validation.error)}`, request.url),
        { status: 302, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return errorRedirect(
      validation.redirectUri,
      validation.error,
      validation.description,
      params.get('state'),
    );
  }

  const { client, redirectUri, scope, codeChallenge, nonce, state } = validation;

  /* ---- session required ------------------------------------------ */
  const sessionId = readSessionCookie(request);
  const session = await getSession(sessionId);
  if (!session) {
    // The user needs to sign in here. Carry the whole request through the login
    // page so it can be replayed verbatim once a session exists.
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `/api/oidc/authorize?${params.toString()}`);
    loginUrl.searchParams.set('client', client.clientId);
    return NextResponse.redirect(loginUrl, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return errorRedirect(redirectUri, 'login_required', 'The account for this session no longer exists.', state);
  }

  /* ---- authorization: does this user have the role this system needs? */
  if (!clientAllows(client, user.roles)) {
    record('app.launch.denied', 'denied', {
      actorId: user.id,
      actorLabel: user.username,
      target: client.clientId,
      detail: 'role not permitted',
    });
    return errorRedirect(
      redirectUri,
      'access_denied',
      `Your role is not permitted to launch ${client.clientId}.`,
      state,
    );
  }

  /* ---- consent: has the user already approved these scopes? ---------- */
  const consentStatus = params.get('consent');
  if (consentStatus === 'denied') {
    record('app.launch.denied', 'denied', {
      actorId: user.id,
      actorLabel: user.username,
      target: client.clientId,
      detail: 'user denied consent',
    });
    return errorRedirect(redirectUri, 'access_denied', 'Consent was denied.', state);
  }

  if (consentStatus !== 'approved') {
    const scopes = scope.split(/\s+/).filter(Boolean);
    if (!hasConsent(user.id, client.clientId, scopes)) {
      const consentUrl = new URL('/consent', request.url);
      consentUrl.searchParams.set('client_id', client.clientId);
      consentUrl.searchParams.set('scope', scope);
      if (state) consentUrl.searchParams.set('state', state);
      consentUrl.searchParams.set('redirect_uri', redirectUri);
      return NextResponse.redirect(consentUrl, {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }

  /* ---- throttle: one authorize per few hundred ms per session -------- */
  const limit = check('mfa', `authorize:${session.id}`);
  if (!limit.allowed) {
    record('rate_limit.blocked', 'denied', { actorId: user.id, target: client.clientId, detail: 'authorize' });
    return errorRedirect(redirectUri, 'access_denied', 'Too many sign-on attempts. Try again shortly.', state);
  }

  const code = await issueAuthorizationCode({
    client,
    userId: user.id,
    redirectUri,
    scope,
    codeChallenge,
    nonce,
  });

  record('app.launch', 'success', {
    actorId: user.id,
    actorLabel: user.username,
    target: client.clientId,
    sessionId: session.id,
    detail: `scopes: ${scope}`,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code.code);
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('iss', new URL(request.url).origin);

  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
