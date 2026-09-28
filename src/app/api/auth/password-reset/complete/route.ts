/**
 * POST /api/auth/password-reset/complete — complete a password reset.
 *
 * Accepts a reset token and a new password, validates the token, and updates
 * the user's password.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { consumePasswordResetToken } from '@/lib/auth/password-reset';
import { findUserById, updateUserRecord } from '@/lib/auth/users';
import { hashPassword } from '@/lib/auth/crypto';
import { record } from '@/lib/auth/audit';
import { sendPasswordChangedEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  const body = await request.formData();
  const token = String(body.get('token') ?? '').trim();
  const newPassword = String(body.get('newPassword') ?? '');
  const confirmPassword = String(body.get('confirmPassword') ?? '');

  if (!token || !newPassword || !confirmPassword) {
    return NextResponse.json(
      { ok: false as const, message: 'Token and new password are required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { ok: false as const, message: 'Passwords do not match.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { ok: false as const, message: 'Password must be at least 8 characters.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const resetRecord = consumePasswordResetToken(token);
  if (!resetRecord) {
    return NextResponse.json(
      { ok: false as const, message: 'Invalid or expired reset token.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const user = await findUserById(resetRecord.userId);
  if (!user) {
    return NextResponse.json(
      { ok: false as const, message: 'User not found.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const newHash = await hashPassword(newPassword);

  try {
    await updateUserRecord(user.id, { passwordHash: newHash });

    // Invalidate any existing password reset tokens for this user
    const { invalidateUserPasswordResetTokens } = await import('@/lib/auth/password-reset');
    invalidateUserPasswordResetTokens(user.id);

    record('auth.login.success', 'success', {
      actorId: user.id,
      actorLabel: user.username,
      detail: 'password_reset_completed',
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    // Send password changed notification
    sendPasswordChangedEmail({
      to: user.email,
      username: user.displayName,
      changedAt: new Date().toISOString(),
    }).catch(() => {
      console.error('[email] failed to send password changed notification');
    });

    return NextResponse.json(
      { ok: true as const, message: 'Password has been reset successfully.' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false as const, message: 'Failed to reset password. Please try again.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
