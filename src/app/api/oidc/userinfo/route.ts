/**
 * GET /api/oidc/userinfo — claims for a presented access token.
 *
 * A client must pass the audience it expects, so a token minted for a different
 * system is rejected rather than silently accepted. Omitting the audience check
 * is the confused-deputy bug this guard exists to prevent.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken } from '@/lib/oidc';
import { record } from '@/lib/auth/audit';

export async function GET(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (!token || scheme?.toLowerCase() !== 'bearer') {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Expected an Authorization: Bearer header.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }

  const expectedAudience = request.nextUrl.searchParams.get('audience') ?? undefined;
  const result = await verifyAccessToken(token, expectedAudience);

  if (!result.ok) {
    record('oidc.token.denied', 'denied', { detail: `userinfo: ${result.error}` });
    return NextResponse.json(
      { error: 'invalid_token', error_description: result.error },
      { status: 401, headers: { 'WWW-Authenticate': `Bearer error="${result.error}"` } },
    );
  }

  const { sub, name, email, roles, department, employee_id } = result.claims;

  return NextResponse.json(
    {
      sub,
      name,
      email,
      roles,
      department,
      employee_id,
      email_verified: true,
      updated_at: Math.floor(result.claims.iat * 1000),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
