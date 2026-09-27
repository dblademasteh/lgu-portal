/**
 * GET /.well-known/openid-configuration — OpenID Provider Metadata.
 *
 * The path an OpenID Connect client is required to look at, per the Discovery
 * 1.0 spec: a client is configured with an issuer URL and fetches
 * `<issuer>/.well-known/openid-configuration` to learn the endpoints, the
 * algorithms and the scopes it supports.
 *
 * The document itself is built by `discoveryDocument()` and is also reachable at
 * /api/oidc/discovery, which is friendlier to read by hand. Same bytes, two
 * paths: the well-known path is the contractual one, the /api path is a
 * convenience.
 */

import { NextResponse } from 'next/server';
import { discoveryDocument } from '@/lib/oidc';

export function GET() {
  return NextResponse.json(discoveryDocument(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
