/**
 * GET /launch/[slug] — begins the SSO handoff to one system.
 *
 * This endpoint never renders a destination. It performs the client half of the
 * authorization-code flow and hands off to /api/oidc/authorize:
 *
 *   1. authorize the viewer for this system (role check, on the server)
 *   2. generate a PKCE verifier/challenge pair and a `state` value
 *   3. stash verifier + system server-side, keyed by state
 *   4. pin the state to this browser with a cookie, for CSRF binding
 *   5. redirect to the authorization endpoint
 *
 * The authorization endpoint then redirects back to /api/oidc/callback, which
 * redeems the code and forwards to /launch/[slug]/app.
 *
 * Why a Route Handler and not a page: step 4 writes a cookie, and Next.js only
 * permits cookie mutation in Route Handlers and Server Actions. A Server
 * Component that tries throws at render. Since this endpoint produces no UI at
 * all — it is authorize-then-redirect on every path — a Route Handler is also
 * the honest description of what it does.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireSystemAccess } from '@/lib/auth/guards';
import { OIDC_ISSUER, clientIdFor } from '@/lib/oidc';
import { codeChallengeS256, randomToken } from '@/lib/auth/crypto';
import { FLOW_COOKIE, registerFlow } from '@/lib/oidc-flow';

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  // Throws NEXT_REDIRECT for a signed-out viewer, an unknown system, or a
  // viewer without the role. Next.js turns that into the redirect response.
  const { viewer, system } = await requireSystemAccess(slug);

  // A system in maintenance is visible but not launchable. Say so plainly
  // instead of redirecting to a flow that would be denied anyway.
  if (system.status === 'maintenance' && !viewer.user.roles.includes('admin')) {
    return NextResponse.redirect(
      new URL(
        `/unauthorized?system=${encodeURIComponent(slug)}&reason=maintenance`,
        request.url,
      ),
    );
  }

  const clientId = clientIdFor(system);

  // PKCE: the verifier never leaves the server. Only its S256 hash is sent.
  const verifier = randomToken(48);
  const challenge = codeChallengeS256(verifier);
  const state = registerFlow({ slug, verifier });
  const nonce = randomToken(16);

  const authorize = new URL('/api/oidc/authorize', OIDC_ISSUER);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', `${OIDC_ISSUER}/api/oidc/callback`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', ['openid', 'profile', 'email', 'roles', ...system.scopes].join(' '));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('nonce', nonce);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  const response = NextResponse.redirect(authorize);

  // The CSRF binding. Set by the initiating navigation, so it cannot be forged
  // by handing a victim a link: /api/oidc/callback requires the cookie to
  // match the state it is given. Only the authorize step's own redirect leaves
  // this response, and the state is single-use server-side.
  response.cookies.set(FLOW_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  return response;
}
