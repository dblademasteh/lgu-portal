/**
 * Global 404.
 *
 * `app/not-found.tsx` covers unmatched routes, but requests to a non-existent
 * *API* path would otherwise fall through to the app router's default response.
 * This answers those with JSON, since an API client will not be able to render
 * an HTML error page usefully.
 */

import { NextResponse, type NextRequest } from 'next/server';

export function GET(request: NextRequest) {
  return NextResponse.json(
    {
      error: 'not_found',
      error_description: `No endpoint at ${request.nextUrl.pathname}`,
    },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}
