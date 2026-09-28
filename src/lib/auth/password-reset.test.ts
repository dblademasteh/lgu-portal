import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  issuePasswordResetToken,
  consumePasswordResetToken,
  getPasswordResetToken,
  invalidateUserPasswordResetTokens,
  clearAllPasswordResetTokens,
  sweepExpiredPasswordResetTokens,
  PASSWORD_RESET_TTL_MS,
} from './password-reset';

describe('password-reset', () => {
  beforeEach(() => {
    clearAllPasswordResetTokens();
  });

  it('issues a token with correct properties', () => {
    const token = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    expect(token.token).toBeTruthy();
    expect(token.userId).toBe('user-1');
    expect(token.username).toBe('admin');
    expect(token.email).toBe('admin@lgu.gov.ph');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.usedAt).toBeNull();
  });

  it('consumes a valid token', () => {
    const token = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    const consumed = consumePasswordResetToken(token.token);
    expect(consumed).not.toBeNull();
    expect(consumed!.userId).toBe('user-1');
    expect(consumed!.usedAt).not.toBeNull();
  });

  it('returns null for consumed token on second call', () => {
    const token = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    consumePasswordResetToken(token.token);
    const second = consumePasswordResetToken(token.token);
    expect(second).toBeNull();
  });

  it('returns null for expired token', () => {
    vi.useFakeTimers();
    const token = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    vi.advanceTimersByTime(PASSWORD_RESET_TTL_MS + 1000);
    expect(consumePasswordResetToken(token.token)).toBeNull();
    vi.useRealTimers();
  });

  it('getPasswordResetToken returns token without consuming', () => {
    const token = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    const fetched = getPasswordResetToken(token.token);
    expect(fetched).not.toBeNull();
    expect(fetched!.usedAt).toBeNull();
    // Should still be consumable
    expect(consumePasswordResetToken(token.token)).not.toBeNull();
  });

  it('invalidateUserPasswordResetTokens removes all tokens for a user', () => {
    const token1a = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    const token1b = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    const token2 = issuePasswordResetToken('user-2', 'clerk', 'clerk@lgu.gov.ph');

    invalidateUserPasswordResetTokens('user-1');

    expect(getPasswordResetToken(token1a.token)).toBeNull();
    expect(getPasswordResetToken(token1b.token)).toBeNull();
    expect(getPasswordResetToken(token2.token)).not.toBeNull();
  });

  it('sweepExpiredPasswordResetTokens removes expired tokens', () => {
    vi.useFakeTimers();
    const token1 = issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    vi.advanceTimersByTime(PASSWORD_RESET_TTL_MS + 1000);
    const token2 = issuePasswordResetToken('user-2', 'clerk', 'clerk@lgu.gov.ph');

    sweepExpiredPasswordResetTokens();

    expect(getPasswordResetToken(token1.token)).toBeNull();
    expect(getPasswordResetToken(token2.token)).not.toBeNull();
    vi.useRealTimers();
  });

  it('clearAllPasswordResetTokens removes all tokens', () => {
    issuePasswordResetToken('user-1', 'admin', 'admin@lgu.gov.ph');
    issuePasswordResetToken('user-2', 'clerk', 'clerk@lgu.gov.ph');
    clearAllPasswordResetTokens();
    expect(getPasswordResetToken('any')).toBeNull();
  });
});
