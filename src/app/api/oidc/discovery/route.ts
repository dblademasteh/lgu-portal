/**
 * GET /api/oidc/discovery — OpenID Provider Metadata.
 *
 * Also served from the well-known path, which is where a standards-compliant
 * client library will look for it.
 */

import { NextResponse } from 'next/server';
import { discoveryDocument } from '@/lib/oidc';

export function GET() {
  return NextResponse.json(discoveryDocument(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
