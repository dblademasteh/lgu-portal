/**
 * GET|POST /api/oidc/logout — RP-initiated sign-out.
 *
 * `id_token_hint` plus `post_logout_redirect_uri` is the spec's sign-out
 * shape. The redirect URI is validated against a small allow-list of same-origin
 * paths, because an unvalidated logout redirect is an open redirector.
 *
 * POST is supported so a client can send an `id_token_hint` in a form body
 * without exposing it in a URL that lands in browser history and logs.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie, destroySession, getSession } from '@/lib/auth/sessions';
import { readSessionCookie } from '@/lib/auth/session-cookie';
import { record } from '@/lib/auth/audit';
import { invalidateCodesForUser } from '@/lib/oidc';
import { propagateLogout } from '@/lib/auth/logout-propagation';

const ALLOWED_POST_LOGOUT_PATHS = new Set(['/login', '/', '/portal']);

async function signOut(request: NextRequest, redirectTo: string | null) {
  const sessionId = readSessionCookie(request);
  const session = await getSession(sessionId);

  if (sessionId) {
    await destroySession(sessionId);
    if (session) {
      invalidateCodesForUser(session.userId);

      // Propagate logout to downstream systems (fire-and-forget)
      propagateLogout({
        userId: session.userId,
        sessionId: session.id,
        clientId: undefined,
        downstreamUrls: [],
      }).catch(() => {
        // Log but don't block sign-out
      });
    }
    record('auth.logout', 'success', {
      actorId: session?.userId,
      sessionId,
      detail: 'rp-initiated',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
  }

  const response = redirectTo
    ? NextResponse.redirect(new URL(redirectTo, request.url), { status: 302 })
    : NextResponse.json({ ok: true, status: 'signed_out' });

  await clearSessionCookie();
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/** Only same-origin, allow-listed paths may be a sign-out redirect target. */
function validatePostLogoutTarget(candidate: string | null): string | null {
  if (!candidate) return null;
  let pathname: string;
  try {
    // Reject absolute URLs to another origin outright.
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return null;
    pathname = new URL(candidate, 'http://local').pathname;
  } catch {
    return null;
  }
  return ALLOWED_POST_LOGOUT_PATHS.has(pathname) ? pathname : null;
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('post_logout_redirect_uri');
  const target = validatePostLogoutTarget(requested);
  if (requested && !target) {
    record('oidc.token.denied', 'denied', { detail: 'rejected post_logout_redirect_uri' });
  }
  return signOut(request, target);
}

export async function POST(request: NextRequest) {
  let target: string | null = null;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await request.text());
    target = validatePostLogoutTarget(form.get('post_logout_redirect_uri'));
  }
  return signOut(request, target);
}