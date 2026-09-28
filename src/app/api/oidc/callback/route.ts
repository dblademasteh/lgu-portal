/**
 * GET /api/oidc/callback — the client-side leg of the authorization code flow.
 *
 * Responsibilities, in order:
 *   1. Reject if the authorization server reported an error.
 *   2. Reject if `state` does not match the value stashed when the flow began.
 *      This is the CSRF defence: an attacker who can make the browser hit this
 *      URL with their own `code` cannot do so without also knowing our state.
 *   3. Redeem the code for tokens, satisfying PKCE.
 *   4. Park the token set behind a one-time ticket and redirect to the
 *      downstream shell. Tokens never appear in a URL.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { findUserById } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';
import { clientAllows } from '@/lib/oidc';
import { consumeAuthorizationCode, findClient, issueTokens } from '@/lib/oidc';
import { FLOW_COOKIE, peekFlow, takeFlow } from '@/lib/oidc-flow';
import { HANDOFF_COOKIE, HANDOFF_TTL_MS_EXPORT, issueHandoff, sealTicket } from '@/lib/handoff';

function fail(request: NextRequest, slug: string | null, reason: string) {
  const target = slug ? `/unauthorized?reason=${encodeURIComponent(reason)}` : '/unauthorized';
  return NextResponse.redirect(new URL(target, request.url), {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  const flowCookie = (await cookies()).get(FLOW_COOKIE)?.value;
  const flow = flowCookie ? peekFlow(flowCookie) : undefined;
  const slug = flow?.slug ?? null;

  /* ---- 1. authorization server reported an error ------------------- */
  if (error) {
    const description = params.get('error_description') ?? error;
    record('app.launch.denied', 'denied', { target: slug ?? undefined, detail: description });
    return fail(request, null, error);
  }

  /* ---- 2. state must match the flow we started --------------------- */
  if (!code || !state) {
    record('app.launch.denied', 'denied', { detail: 'missing code or state' });
    return fail(request, slug, 'invalid_request');
  }
  if (!flow || flow.state !== flowCookie) {
    record('app.launch.denied', 'denied', { detail: 'state mismatch (possible CSRF)' });
    return fail(request, slug, 'state_mismatch');
  }
  takeFlow(flowCookie);

  /* ---- 3. redeem the code ------------------------------------------ */
  const client = findClient(`lgu-${flow.slug}`);
  if (!client) {
    return fail(request, flow.slug, 'unauthorized_client');
  }

  const redirectUri = new URL('/api/oidc/callback', request.url).toString();
  const exchange = await consumeAuthorizationCode(code, {
    clientId: client.clientId,
    redirectUri,
    codeVerifier: flow.verifier,
  });
  if (!exchange.ok) {
    record('app.launch.denied', 'denied', { target: client.clientId, detail: exchange.description });
    return fail(request, flow.slug, 'invalid_grant');
  }

  /* ---- 4. issue tokens, park them, redirect to the app shell -------- */
  const session = await getSession(readSessionCookie(request));
  const user = await findUserById(exchange.code.userId);
  if (!user) return fail(request, flow.slug, 'login_required');

  // Re-check authorization at redemption time. A role can be revoked between
  // authorize and callback, and the grant must not survive that.
  if (!clientAllows(client, user.roles)) {
    record('app.launch.denied', 'denied', {
      actorId: user.id,
      target: client.clientId,
      detail: 'role revoked between authorize and callback',
    });
    return fail(request, flow.slug, 'access_denied');
  }

  const tokens = await issueTokens(client, exchange.code, {
    userId: user.id,
    employeeId: user.employeeId,
    email: user.email,
    displayName: user.displayName,
    department: user.department,
    title: user.title,
    roles: user.roles,
    sessionId: session?.id ?? 'detached',
    mfaVerified: session?.mfaVerified ?? false,
  });

  const ticket = issueHandoff({
    slug: flow.slug,
    clientId: client.clientId,
    tokens,
    mfaVerified: session?.mfaVerified ?? false,
  });

  const store = await cookies();
  store.set(HANDOFF_COOKIE, sealTicket(ticket), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(HANDOFF_TTL_MS_EXPORT / 1000),
  });
  store.delete(FLOW_COOKIE);

  return NextResponse.redirect(new URL(`/launch/${flow.slug}/app`, request.url), {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
