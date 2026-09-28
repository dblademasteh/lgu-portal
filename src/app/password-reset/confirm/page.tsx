/**
 * /password-reset/confirm — complete a password reset.
 *
 * The user arrives here from the email link with a token. They enter a new
 * password and confirm it.
 */

import { Metadata } from 'next';
import { PasswordResetConfirmForm } from './PasswordResetConfirmForm';

export const metadata: Metadata = {
  title: 'Set New Password',
  description: 'Choose a new password for your LGU Portal account.',
};

type SearchParams = Promise<{ token?: string | string[] }>;

export default async function PasswordResetConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : Array.isArray(params.token) ? params.token[0] : undefined;

  if (!token) {
    return (
      <div className="page-shell">
        <div className="auth-layout" id="main">
          <section className="auth-card glass">
            <h2 className="display-2">Invalid reset link</h2>
            <p className="text-body">No reset token provided. Please use the link from your email.</p>
            <a href="/password-reset" className="button button-primary button-block" style={{ marginTop: '1rem' }}>
              Request a new link
            </a>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="auth-layout" id="main">
        <section className="auth-pitch" aria-labelledby="reset-title">
          <h1 className="display-1" id="reset-title">
            Set a new password
          </h1>
          <p className="text-body auth-pitch-lede">
            Choose a strong password you haven't used before.
          </p>
        </section>

        <section className="auth-card glass" aria-labelledby="reset-form-title">
          <header className="auth-card-head">
            <h2 className="display-2" id="reset-form-title">
              New password
            </h2>
            <p className="text-meta">
              Must be at least 8 characters.
            </p>
          </header>

          <PasswordResetConfirmForm token={token} />

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
