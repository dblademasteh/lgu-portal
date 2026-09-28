/**
 * POST /api/auth/password-reset/request — initiate a password reset.
 *
 * Accepts an email address, looks up the user, issues a reset token, and
 * sends a reset email. Always returns 200 to avoid revealing whether an
 * email is registered.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { findUserByUsername, findUserById } from '@/lib/auth/users';
import { issuePasswordResetToken } from '@/lib/auth/password-reset';
import { sendPasswordResetEmail } from '@/lib/email';
import { record } from '@/lib/auth/audit';

export async function POST(request: NextRequest) {
  const body = await request.formData();
  const email = String(body.get('email') ?? '').trim().toLowerCase();

  if (!email) {
    return NextResponse.json(
      { ok: false as const, message: 'Email address is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const origin = request.nextUrl.origin;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = request.headers.get('user-agent') ?? undefined;

  // Look up user by email - try both username and email fields
  const byEmail = await findUserById(email);
  const byUsername = await findUserByUsername(email);
  const user = byEmail ?? byUsername?.user;

  if (user) {
    const token = issuePasswordResetToken(user.id, user.username, user.email);
    const resetUrl = `${origin}/password-reset/confirm?token=${token.token}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        username: user.displayName,
        resetUrl,
        expiresInMinutes: 60,
      });
      record('auth.login.success', 'success', {
        actorId: user.id,
        actorLabel: user.username,
        detail: 'password_reset_requested',
        ip,
        userAgent,
      });
    } catch {
      // Log but don't reveal email delivery failures
      console.error('[password-reset] failed to send email');
    }
  } else {
    record('auth.login.failure', 'failure', {
      target: email,
      detail: 'password_reset_unknown_email',
      ip,
      userAgent,
    });
  }

  // Always return the same response to prevent email enumeration
  return NextResponse.json(
    {
      ok: true as const,
      message: 'If an account exists with that email, a password reset link has been sent.',
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
