/**
 * GET /api/oidc/jwks — verification key set.
 *
 * Serves the RS256 public keys from the provisioned key ring. Resource servers
 * (e.g. HRMS verifying our tokens) fetch this to validate signatures without
 * ever holding signing material — the prior HS256 stub published the symmetric
 * secret here, which is unsafe for third-party verification.
 */

import { NextResponse } from 'next/server';
import { exportJwks } from '@/lib/admin/keys';

export async function GET() {
  return NextResponse.json(await exportJwks(), {
    headers: {
      'Cache-Control': 'public, max-age=300',
      // Declares this is a JWK Set, not arbitrary JSON.
      'Content-Type': 'application/json',
    },
  });
}
