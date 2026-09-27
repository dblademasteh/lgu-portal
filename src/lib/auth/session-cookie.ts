/**
 * Request-scoped session cookie access.
 *
 * `sessions.ts` exposes cookie helpers built on `next/headers`, which are
 * async. Route handlers already hold the `NextRequest`, so this module parses
 * the cookie off the request and verifies the HMAC synchronously.
 *
 * Same trust rule as the rest of the auth layer: the cookie value is treated as
 * untrusted input and is authenticated before it is used for anything.
 */

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, openSessionCookie } from './session-store';

export function readSessionCookie(request: NextRequest): string | null {
  return openSessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
}
