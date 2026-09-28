/**
 * POST /api/oidc/token — the token endpoint.
 *
 * Supports the three grants the portal's clients need:
 *   authorization_code  (with PKCE, the only grant a public client may use)
 *   refresh_token       (rotating: the presented token is consumed and replaced)
 *   client_credentials  (for service accounts / machine-to-machine)
 *
 * Form-encoded per RFC 6749, not JSON. Client authentication is `none` for
 * public clients (PKCE proves the request); confidential clients use
 * `client_secret` for client_credentials.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { findUserById } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';
import {
  consumeAuthorizationCode,
  findClient,
  issueServiceAccountToken,
  issueTokens,
  refreshAccessToken,
} from '@/lib/oidc';

function tokenError(
  error: string,
  description: string,
  status: number,
  extra: Record<string, string> = {},
) {
  return NextResponse.json(
    { error, error_description: description, ...extra },
    { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  );
}

/** Reject oversized bodies before parsing them. */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return tokenError('invalid_request', 'Request body too large.', 413);
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return tokenError('invalid_request', 'Body must be application/x-www-form-urlencoded.', 400);
  }

  const grantType = form.get('grant_type') ?? '';
  const clientId = form.get('client_id') ?? '';

  const client = findClient(clientId);
  if (!client) {
    record('oidc.token.denied', 'denied', { target: clientId, detail: 'unknown client' });
    return tokenError('invalid_client', 'Unknown or unregistered client_id.', 401);
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();

  /* ---- refresh_token grant ---------------------------------------- */
  if (grantType === 'refresh_token') {
    const presented = form.get('refresh_token') ?? '';
    if (!presented) {
      return tokenError('invalid_request', 'refresh_token is required.', 400);
    }

    const session = await resolveSubject(request);
    if (!session) {
      return tokenError('invalid_grant', 'No active SSO session for this refresh token.', 400);
    }

    const result = await refreshAccessToken(presented, clientId, session);
    if (!result.ok) {
      record('oidc.token.denied', 'denied', { actorId: session.userId, target: clientId, detail: 'refresh' });
      return tokenError(result.error, result.description, 400);
    }

    record('oidc.token.issued', 'success', { actorId: session.userId, target: clientId, detail: 'refresh' });
    return NextResponse.json(
      {
        token_type: 'Bearer',
        expires_in: result.expiresIn,
        scope: result.scope,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }

  /* ---- authorization_code grant ----------------------------------- */
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    const codeVerifier = form.get('code_verifier');

    if (!code || !redirectUri) {
      return tokenError('invalid_request', 'code and redirect_uri are required.', 400);
    }

    const exchange = await consumeAuthorizationCode(code, { clientId, redirectUri, codeVerifier });
    if (!exchange.ok) {
      record('oidc.token.denied', 'denied', { target: clientId, detail: exchange.description });
      return tokenError(exchange.error, exchange.description, 400);
    }

    const user = await findUserById(exchange.code.userId);
    if (!user) {
      return tokenError('invalid_grant', 'The account for this grant no longer exists.', 400);
    }

    const session = await resolveSubject(request);
    if (session && session.userId !== user.id) {
      return tokenError('invalid_grant', 'Session does not match the authorization grant.', 400);
    }

    const tokens = await issueTokens(client, exchange.code, {
      userId: user.id,
      employeeId: user.employeeId,
      email: user.email,
      displayName: user.displayName,
      department: user.department,
      title: user.title,
      roles: user.roles,
      sessionId: session?.sessionId ?? 'detached',
      mfaVerified: user.mfaEnabled,
    });

    record('oidc.token.issued', 'success', {
      actorId: user.id,
      actorLabel: user.username,
      target: clientId,
      detail: `code redeemed, scope: ${exchange.code.scope}`,
    });

    return NextResponse.json(tokens, {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }

  /* ---- client_credentials grant ------------------------------------ */
  if (grantType === 'client_credentials') {
    const clientSecret = form.get('client_secret') ?? '';

    if (!clientSecret) {
      return tokenError('invalid_request', 'client_secret is required.', 400);
    }

    if (!client.clientSecret || client.clientSecret !== clientSecret) {
      record('oidc.token.denied', 'denied', { target: clientId, detail: 'bad client secret' });
      return tokenError('invalid_client', 'Invalid client credentials.', 401);
    }

    if (!client.grantTypes.includes('client_credentials')) {
      return tokenError('unauthorized_client', 'Client is not allowed to use client_credentials grant.', 400);
    }

    const requestedScope = form.get('scope') ?? '';
    const scope = validateAndNormalizeScope(requestedScope, client.allowedScopes);

    const result = await issueServiceAccountToken(client, scope);
    record('oidc.token.issued', 'success', { actorId: clientId, target: clientId, detail: 'client_credentials' });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }

  return tokenError(
    'unsupported_grant_type',
    `Grant type not supported: ${grantType}`,
    400,
  );
}

/** Validate and normalize scopes for client_credentials grant. */
function validateAndNormalizeScope(requested: string, allowed: string[]): string {
  const requestedSet = new Set(requested.split(' ').filter(Boolean));
  const allowedSet = new Set(allowed);

  if (requestedSet.size === 0) {
    return allowed.join(' ');
  }

  const filtered = [...requestedSet].filter((s) => allowedSet.has(s));
  if (filtered.length === 0) {
    return allowed.join(' ');
  }

  return filtered.join(' ');
}

/** Resolve the signed-in subject from the request cookie, if there is one. */
async function resolveSubject(request: NextRequest) {
  const { getSession } = await import('@/lib/auth/sessions');
  const { readSessionCookie } = await import('@/lib/auth/session-cookie');
  const session = await getSession(readSessionCookie(request));
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  return {
    userId: user.id,
    employeeId: user.employeeId,
    email: user.email,
    displayName: user.displayName,
    department: user.department,
    title: user.title,
    roles: user.roles,
    sessionId: session.id,
    mfaVerified: session.mfaVerified,
  };
}
