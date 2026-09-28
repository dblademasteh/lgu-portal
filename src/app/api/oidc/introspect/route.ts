/**
 * POST /api/oidc/introspect — OAuth 2.0 Token Introspection (RFC 7662).
 *
 * Resource servers use this endpoint to check whether an access token is
 * active and to retrieve its associated metadata. The endpoint requires
 * authentication via client credentials.
 *
 * In this demo, any request with a valid Bearer token is accepted. A
 * production deployment should restrict this to known resource servers.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/oidc';
import { getSession, isSessionLive } from '@/lib/auth/sessions';
import { findUserById, listUsers } from '@/lib/auth/users';
import { record } from '@/lib/auth/audit';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { active: false, error: 'invalid_token', error_description: 'Missing Bearer token.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const token = authHeader.slice(7);
  const verification = await verifyAccessToken(token);

  if (!verification.ok) {
    return NextResponse.json(
      { active: false, error: 'invalid_token', error_description: verification.error },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const claims = verification.claims;
  const session = await getSession(claims.sid);

  // Token is valid but session may have expired or been revoked
  if (!session || !isSessionLive(session, Date.now())) {
    return NextResponse.json(
      { active: false, error: 'invalid_token', error_description: 'Session expired or revoked.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const user = await findUserById(claims.sub);
  if (!user) {
    return NextResponse.json(
      { active: false, error: 'invalid_token', error_description: 'User not found.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  record('oidc.token.issued', 'success', {
    actorId: user.id,
    target: typeof claims.aud === 'string' ? claims.aud : claims.aud[0],
    detail: 'introspection',
    sessionId: session.id,
  });

  return NextResponse.json({
    active: true,
    scope: claims.scope,
    client_id: typeof claims.aud === 'string' ? claims.aud : claims.aud[0],
    sub: claims.sub,
    user_id: claims.sub,
    email: claims.email,
    name: claims.name,
    roles: claims.roles,
    department: claims.department,
    employee_id: claims.employee_id,
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
    sid: claims.sid,
    iss: claims.iss,
    aud: claims.aud,
  });
}
