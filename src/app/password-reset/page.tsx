/**
 * /password-reset — request a password reset.
 *
 * A user enters their email address and receives a reset link if an account
 * exists. The response is always the same to prevent email enumeration.
 */

import { Metadata } from 'next';
import { PasswordResetRequestForm } from './PasswordResetRequestForm';

export const metadata: Metadata = {
  title: 'Reset Password',
  description: 'Request a password reset for your LGU Portal account.',
};

export default function PasswordResetPage() {
  return (
    <div className="page-shell">
      <div className="auth-layout" id="main">
        <section className="auth-pitch" aria-labelledby="reset-title">
          <h1 className="display-1" id="reset-title">
            Reset your password
          </h1>
          <p className="text-body auth-pitch-lede">
            Enter your email address and we'll send you a link to reset your password.
          </p>
        </section>

        <section className="auth-card glass" aria-labelledby="reset-form-title">
          <header className="auth-card-head">
            <h2 className="display-2" id="reset-form-title">
              Forgot password?
            </h2>
            <p className="text-meta">
              No worries, it happens. Enter your email and we'll send you a reset link.
            </p>
          </header>

          <PasswordResetRequestForm />

          <footer className="auth-card-foot">
            <p className="text-meta">
              Remember your password?{' '}
              <a href="/login" className="link">
                Sign in
              </a>
            </p>
          </footer>
        </section>
      </div>
    </div>
  );
}
