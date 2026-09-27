import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL('/favicon.svg', request.url);
  return NextResponse.redirect(url, 301);
}