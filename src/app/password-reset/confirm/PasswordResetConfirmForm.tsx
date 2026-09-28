'use client';

import { useState } from 'react';

interface Props {
  token: string;
}

export function PasswordResetConfirmForm({ token }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch('/api/auth/password-reset/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, newPassword, confirmPassword }),
      });

      const data = await res.json();

      if (data.ok) {
        setMessage(data.message);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setError(data.message);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {message && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <input type="hidden" name="token" value={token} />

      <div className="form-group">
        <label htmlFor="newPassword" className="form-label">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          placeholder="At least 8 characters"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoFocus
        />
      </div>

      <div className="form-group">
        <label htmlFor="confirmPassword" className="form-label">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="input"
          placeholder="Repeat your new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>

      <button type="submit" className="button button-primary button-block" disabled={loading}>
        {loading ? 'Resetting...' : 'Reset password'}
      </button>
    </form>
  );
}
