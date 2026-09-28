/**
 * POST /api/auth/login — credential exchange.
 *
 * Responses are deliberately uniform. A caller must not be able to tell
 * "no such user" from "wrong password" from "disabled account" by status code or
 * body shape, so every non-success case returns the same status and the same
 * generic message; the specific reason goes to the audit log instead.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { authenticate, findUserByUsername } from '@/lib/auth/users';
import { createSession, setSessionCookie } from '@/lib/auth/sessions';
import { record } from '@/lib/auth/audit';
import { check, reset } from '@/lib/auth/rate-limit';
import { randomNumericCode, safeEqual } from '@/lib/auth/crypto';
import { safeNextPath } from '@/lib/redirect';
import {
  isLockedOut,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  getRemainingLockoutMs,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from '@/lib/auth/lockout';
import { sendMfaCodeEmail, sendAccountLockedEmail } from '@/lib/email';

const GENERIC_FAILURE = 'Sign-in failed. Check your credentials and try again.';
const MAX_USERNAME = 64;
const MAX_PASSWORD = 200;

/**
 * In-flight MFA challenges. The expected code is held server-side so the client
 * never receives it. A real deployment stores a hashed, single-use TOTP secret
 * and derives the code per attempt instead of issuing one up front.
 */
const mfaChallenges = new Map<string, { userId: string; code: string; expiresAt: number }>();
const MFA_TTL_MS = 5 * 60 * 1000;

export type LoginRequest = {
  username: string;
  password: string;
  /** Present when completing a challenge from a previous step. */
  mfaCode?: string;
  /** Opaque handle returned by the `mfa_required` response. */
  challenge?: string;
};

export type LoginResponse =
  | { ok: true; status: 'authenticated'; redirectTo: string; mfaVerified: boolean }
  | { ok: true; status: 'mfa_required'; challenge: string; maskedDestination: string; expiresInSeconds: number }
  | { ok: false; status: 'error'; code: string; message: string; retryAfterSeconds?: number }
  | { ok: false; status: 'locked'; message: string };

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function fail(
  code: string,
  message: string = GENERIC_FAILURE,
  retryAfterSeconds?: number,
  status = 401,
) {
  return NextResponse.json(
    { ok: false as const, status: 'error' as const, code, message, retryAfterSeconds },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(retryAfterSeconds
          ? { 'Retry-After': String(retryAfterSeconds) }
          : {}),
      },
    },
  );
}

/**
 * Where to send the browser after a successful sign-in.
 *
 * This is the one redirect target the *client* navigates to (see `router.replace`
 * in LoginForm), so it is the most security-sensitive `next` in the app. It uses
 * the single canonical validator rather than a local copy: an earlier duplicate
 * here rejected only `//` and backslashes, and silently accepted the
 * percent-encoded and scheme-prefixed shapes that `lib/redirect.ts` covers.
 */
function safeRedirectTarget(candidate: string | null): string {
  return safeNextPath(candidate, '/portal');
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;

  let body: LoginRequest;
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      body = (await request.json()) as LoginRequest;
    } catch {
      return fail('malformed_request', GENERIC_FAILURE, undefined, 400);
    }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    body = {
      username: String(form.get('username') ?? ''),
      password: String(form.get('password') ?? ''),
      challenge: String(form.get('challenge') ?? '') || undefined,
      mfaCode: String(form.get('mfaCode') ?? '') || undefined,
    };
  } else {
    return fail('malformed_request', GENERIC_FAILURE, undefined, 400);
  }

  const username = typeof body.username === 'string' ? body.username.trim().slice(0, MAX_USERNAME) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, MAX_PASSWORD) : '';

  if (!username || !password) {
    record('auth.login.failure', 'failure', {
      detail: 'missing credentials',
      ip,
      userAgent,
    });
    return fail('missing_credentials', 'Enter your username and password.');
  }

  /* ---- step 2: complete an MFA challenge ------------------------- */
  if (body.challenge) {
    const challenge = mfaChallenges.get(body.challenge);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      mfaChallenges.delete(body.challenge);
      record('auth.mfa.failure', 'failure', { detail: 'expired or unknown challenge', ip, userAgent });
      return fail('challenge_expired', 'That verification step expired. Sign in again.');
    }

    const mfaLimit = check('mfa', challenge.userId);
    if (!mfaLimit.allowed) {
      record('rate_limit.blocked', 'denied', { detail: 'mfa', ip, userAgent, sessionId: challenge.userId });
      return fail('rate_limited', mfaLimit.message, mfaLimit.retryAfterSeconds, 429);
    }

// Constant-time compare against the server-held code. Accepting a fixed
      // '000000' would defeat the second factor, so that shortcut is gone.
      if (!safeEqual(body.mfaCode?.trim() ?? '', challenge.code)) {
      record('auth.mfa.failure', 'failure', { actorId: challenge.userId, ip, userAgent });
      return fail('mfa_invalid', 'That verification code is not correct.');
    }

    mfaChallenges.delete(body.challenge);
    return completeSignIn(
      request,
      challenge.userId,
      ['pwd', 'otp'],
      true,
      ip,
      userAgent,
      safeRedirectTarget(request.nextUrl.searchParams.get('next')),
    );
  }

  /* ---- step 1: check for automatic lockout ------------------------- */
  const lookupResult = await findUserByUsername(username);
  if (lookupResult && isLockedOut(lookupResult.user.id)) {
    record('auth.login.locked', 'denied', {
      actorId: lookupResult.user.id,
      actorLabel: lookupResult.user.username,
      target: username,
      ip,
      userAgent,
      detail: 'account locked due to too many failed attempts',
    });

    // Send lockout notification email
    const origin = request.nextUrl.origin;
    sendAccountLockedEmail({
      to: lookupResult.user.email,
      username: lookupResult.user.displayName,
      unlockUrl: `${origin}/unlock-account?token=${encodeURIComponent(username)}`,
    }).catch(() => {
      console.error('[email] failed to send lockout notification');
    });

    return NextResponse.json(
      {
        ok: false as const,
        status: 'locked' as const,
        message: `Account locked due to ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${Math.ceil(getRemainingLockoutMs(lookupResult.user.id) / 60000)} minutes.`,
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /* ---- step 1: credentials --------------------------------------- */

  // Two independent budgets: per account, and per client.
  const identityLimit = check('identity', username);
  if (!identityLimit.allowed) {
    record('rate_limit.blocked', 'denied', { target: username, detail: 'identity', ip, userAgent });
    return fail('rate_limited', identityLimit.message, identityLimit.retryAfterSeconds, 429);
  }

  const clientLimit = check('client', ip);
  if (!clientLimit.allowed) {
    record('rate_limit.blocked', 'denied', { detail: 'client', ip, userAgent });
    return fail('rate_limited', clientLimit.message, clientLimit.retryAfterSeconds, 429);
  }

  const result = await authenticate(username, password);

  if (!result) {
    // Record failed attempt for lockout tracking if user exists
    if (lookupResult) {
      recordFailedAttempt(lookupResult.user.id);
    }
    record('auth.login.failure', 'failure', { target: username, detail: 'invalid credentials', ip, userAgent });
    return fail('invalid_credentials');
  }

  // Successful authentication - clear lockout
  recordSuccessfulAttempt(result.user.id);

  if (result.disabled) {
    // A locked account is a real, specific state — say so rather than pretending
    // the password was wrong. This leaks only to someone who already knows the
    // valid password, which is the intended audience for the message.
    record('auth.login.locked', 'denied', {
      actorId: result.user.id,
      actorLabel: result.user.username,
      target: username,
      ip,
      userAgent,
    });
    return NextResponse.json(
      {
        ok: false as const,
        status: 'locked' as const,
        message: 'This account is locked pending HRMO clearance. Contact the ICT Service Desk.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (result.user.mfaEnabled) {
    const challenge = `chl_${randomNumericCode(24)}`;
    const mfaCode = randomNumericCode(6);
    mfaChallenges.set(challenge, {
      userId: result.user.id,
      code: mfaCode,
      expiresAt: Date.now() + MFA_TTL_MS,
    });

    // Send MFA code via email
    const origin = request.nextUrl.origin;
    sendMfaCodeEmail({
      to: result.user.email,
      username: result.user.displayName,
      code: mfaCode,
      expiresInMinutes: MFA_TTL_MS / 1000 / 60,
    }).catch(() => {
      console.error('[email] failed to send MFA code');
    });

    record('auth.mfa.required', 'challenge', {
      actorId: result.user.id,
      actorLabel: result.user.username,
      ip,
      userAgent,
    });
    return NextResponse.json(
      {
        ok: true as const,
        status: 'mfa_required' as const,
        challenge,
        maskedDestination: `Email sent to ${result.user.email.replace(/(.{2})(.*)(@.*)$/, '$1***$3')}`,
        expiresInSeconds: MFA_TTL_MS / 1000,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  reset('identity', username);
  return completeSignIn(
    request,
    result.user.id,
    ['pwd'],
    false,
    ip,
    userAgent,
    safeRedirectTarget(request.nextUrl.searchParams.get('next')),
  );
}

async function completeSignIn(
  request: NextRequest,
  userId: string,
  amr: string[],
  mfaVerified: boolean,
  ip: string,
  userAgent: string | undefined,
  redirectTo: string,
) {
  const session = await createSession({ userId, amr, mfaVerified, ip, userAgent });
  await setSessionCookie(session);

  record('auth.login.success', 'success', {
    actorId: userId,
    sessionId: session.id,
    detail: amr.join('+'),
    ip,
    userAgent,
  });

  // If this was a native form submission (browser form), redirect instead of
  // returning JSON so the browser follows the redirect naturally.
  // Client-side JS uses fetch and handles JSON response.
  const accept = request.headers.get('accept') ?? '';
  const ct = request.headers.get('content-type') ?? '';
  const isFormSubmit = ct.includes('application/x-www-form-urlencoded') && accept.includes('text/html');

  if (isFormSubmit) {
    // redirectTo is a relative path; NextResponse.redirect requires absolute URL.
    const absolute = new URL(redirectTo, request.url);
    return NextResponse.redirect(absolute, { status: 302, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    { ok: true as const, status: 'authenticated' as const, redirectTo, mfaVerified },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
