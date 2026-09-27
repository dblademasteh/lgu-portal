'use client';

/**
 * Sign-in form.
 *
 * Client responsibilities, kept deliberately narrow:
 *   - input validation with inline messages tied to fields via aria-describedby
 *   - two-step flow: credentials, then OTP when the account requires it
 *   - surfacing the server's error without leaking which field was wrong
 *
 * Authorisation is entirely server-side. Nothing here decides whether a sign-in
 * is permitted; it only shapes what the user sees while waiting for the answer.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './Button';

type Phase = 'credentials' | 'otp';
type Notice =
  | { kind: 'error' | 'info'; message: string }
  | null;

type OtpStep = { challenge: string; maskedDestination: string; expiresInSeconds: number };

const OTP_LENGTH = 6;

export function LoginForm({ nextPath, serviceName }: { nextPath: string; serviceName?: string }) {
  const router = useRouter();

  const usernameId = useId();
  const passwordId = useId();
  const otpId = useId();
  const formId = useId();

  const [phase, setPhase] = useState<Phase>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState<OtpStep | null>(null);

  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string; otp?: string }>({});
  const [pending, setPending] = useState(false);

  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase === 'otp') otpInputRef.current?.focus();
  }, [phase]);

  /** Announce the message to assistive tech as soon as it is set. */
  const noticeId = `${formId}-notice`;

  const validate = useCallback((): boolean => {
    const errors: typeof fieldErrors = {};

    if (!username.trim()) errors.username = 'Enter your username.';
    else if (username.trim().length < 3) errors.username = 'That username is too short.';

    if (!password) errors.password = 'Enter your password.';
    else if (password.length < 8) errors.password = 'Passwords are at least 8 characters.';

    if (phase === 'otp' && otp.trim().length !== OTP_LENGTH) {
      errors.otp = `Enter all ${OTP_LENGTH} digits.`;
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [username, password, otp, phase]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!validate()) return;

    setPending(true);
    try {
      const response = await fetch(
        `/api/auth/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Same-origin only; the cookie is httpOnly and set by the response.
          credentials: 'same-origin',
          body: JSON.stringify(
            phase === 'credentials'
              ? { username: username.trim(), password }
              : { username: username.trim(), password, challenge: otpStep?.challenge, mfaCode: otp.trim() },
          ),
        },
      );

      const data = (await response.json()) as Record<string, unknown>;

      if (response.status === 429) {
        const seconds = typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 60;
        setNotice({
          kind: 'error',
          message: `${data.message ?? 'Too many attempts.'} Try again in ${seconds}s.`,
        });
        return;
      }

      if (data.status === 'locked') {
        setNotice({ kind: 'error', message: String(data.message) });
        return;
      }

      if (data.status === 'mfa_required') {
        setOtpStep({
          challenge: String(data.challenge),
          maskedDestination: String(data.maskedDestination),
          expiresInSeconds: Number(data.expiresInSeconds ?? 300),
        });
        setOtp('');
        setPhase('otp');
        setNotice({
          kind: 'info',
          message: `We sent a ${OTP_LENGTH}-digit code to ${data.maskedDestination}.`,
        });
        return;
      }

      if (!response.ok || data.status !== 'authenticated') {
        setNotice({ kind: 'error', message: String(data.message ?? 'Sign-in failed.') });
        // Clear the password so a retry starts clean and nothing lingers in the DOM.
        setPassword('');
        return;
      }

      // A full navigation, not a client push: the server has just set cookies
      // and the next page is server-rendered from them.
      router.replace(typeof data.redirectTo === 'string' ? data.redirectTo : '/portal');
      router.refresh();
    } catch {
      setNotice({ kind: 'error', message: 'Could not reach the sign-in service. Check your connection.' });
    } finally {
      setPending(false);
    }
  }

  function backToCredentials() {
    setPhase('credentials');
    setOtp('');
    setOtpStep(null);
    setNotice(null);
    setFieldErrors({});
  }

  // Form action must point to the API endpoint so native submit (pre-hydration)
  // still reaches the correct handler. The `onSubmit` handler will call
  // preventDefault and use fetch, but the action is a safety net.
  const formAction = `/api/auth/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`;

  return (
    <form className="login-form stack" onSubmit={submit} noValidate method="post" action={formAction}>
      {serviceName ? (
        <div className="service-context" role="status">
          <span className="text-meta">Continuing to</span>
          <strong>{serviceName}</strong>
        </div>
      ) : null}

      {notice ? (
        <div
          className="login-notice"
          role="alert"
          aria-live="assertive"
          data-kind={notice.kind}
          id={noticeId}
        >
          {notice.message}
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor={usernameId}>
          Username
        </label>
        <input
          className="field-input"
          id={usernameId}
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={pending}
          aria-invalid={fieldErrors.username ? true : undefined}
          aria-describedby={[
            fieldErrors.username ? `${usernameId}-error` : null,
            noticeId,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {fieldErrors.username ? (
          <span className="field-error" id={`${usernameId}-error`}>
            {fieldErrors.username}
          </span>
        ) : null}
      </div>

      {phase === 'credentials' ? (
        <div className="field">
          <label className="field-label" htmlFor={passwordId}>
            Password
          </label>
          <input
            className="field-input"
            id={passwordId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={[
              fieldErrors.password ? `${passwordId}-error` : null,
              noticeId,
            ]
              .filter(Boolean)
              .join(' ')}
          />
          {fieldErrors.password ? (
            <span className="field-error" id={`${passwordId}-error`}>
              {fieldErrors.password}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor={otpId}>
            Verification code
          </label>
          <input
            ref={otpInputRef}
            className="field-input field-input-otp"
            id={otpId}
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={OTP_LENGTH}
            required
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
            disabled={pending}
            aria-invalid={fieldErrors.otp ? true : undefined}
            aria-describedby={[
              fieldErrors.otp ? `${otpId}-error` : null,
              noticeId,
            ]
              .filter(Boolean)
              .join(' ')}
          />
          {fieldErrors.otp ? (
            <span className="field-error" id={`${otpId}-error`}>
              {fieldErrors.otp}
            </span>
          ) : null}
          <button
            type="button"
            className="field-link"
            onClick={backToCredentials}
            disabled={pending}
          >
            Use a different account
          </button>
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={pending} fullWidth>
        {pending
          ? 'Verifying…'
          : phase === 'credentials'
            ? 'Sign in'
            : 'Verify and continue'}
      </Button>
    </form>
  );
}
