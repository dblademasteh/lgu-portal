/**
 * Edge middleware.
 *
 * Scope is deliberately narrow: a fast, cookie-presence redirect so an
 * unauthenticated visitor never pays for rendering a protected page. It cannot
 * consult the in-memory session store, so it is NOT the authorisation check —
 * `lib/auth/guards.ts` is. Two reasons this split is the right call:
 *
 *   1. The store lives in the Node process; middleware runs on the edge runtime.
 *   2. A check that only inspects a cookie is cheap. A check that must be
 *      correct belongs next to the data it depends on, in the server layer.
 *
 * Cookie parsing is done by hand rather than with the `cookies` API, because
 * middleware cannot await it. The value is never trusted for identity here.
 */

import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'lgu_sso_session';

/** Paths that require a session cookie to be present. */
const PROTECTED_PREFIXES = ['/portal', '/account', '/launch'];

const PUBLIC_PREFIXES = ['/login', '/api/auth/login', '/api/oidc', '/_next', '/favicon'];

function readCookie(request: NextRequest, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!isProtected) return NextResponse.next();

  const sessionCookie = readCookie(request, SESSION_COOKIE);
  if (sessionCookie && sessionCookie.includes('.')) return NextResponse.next();

  // Preserve where they were headed so sign-in can return them there.
  const loginUrl = new URL('/login', request.url);
  const target = `${pathname}${search}`;
  if (target && target !== '/') loginUrl.searchParams.set('next', target);

  const response = NextResponse.redirect(loginUrl);
  // Do not let a cached protected page be served after signing out.
  response.headers.set('Cache-Control', 'no-store, private');
  return response;
}

export const config = {
  // Skip static assets and image optimisation.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
