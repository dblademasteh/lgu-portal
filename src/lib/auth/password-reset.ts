/**
 * Password reset tokens.
 *
 * A user requests a reset, receives a time-limited token, and uses it to set a
 * new password. Tokens are single-use and expire after PASSWORD_RESET_TTL_MS.
 *
 * The store is in-memory for the demo. A production deployment would persist
 * these records so they survive restarts and are shared across replicas.
 */

import { randomToken } from './crypto';
import { record } from './audit';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export type PasswordResetToken = {
  token: string;
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
};

const tokens = new Map<string, PasswordResetToken>();

export function issuePasswordResetToken(userId: string, username: string, email: string): PasswordResetToken {
  const token = randomToken(32);
  const now = Date.now();
  const record: PasswordResetToken = {
    token,
    userId,
    username,
    email,
    createdAt: now,
    expiresAt: now + PASSWORD_RESET_TTL_MS,
    usedAt: null,
  };
  tokens.set(token, record);
  return record;
}

export function consumePasswordResetToken(token: string): PasswordResetToken | null {
  const record = tokens.get(token);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) {
    tokens.delete(token);
    return null;
  }
  if (record.usedAt !== null) {
    return null;
  }
  record.usedAt = Date.now();
  tokens.delete(token);
  return record;
}

export function getPasswordResetToken(token: string): PasswordResetToken | null {
  const record = tokens.get(token);
  if (!record) return null;
  if (Date.now() >= record.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return record;
}

export function invalidateUserPasswordResetTokens(userId: string): void {
  for (const [token, record] of tokens) {
    if (record.userId === userId) {
      tokens.delete(token);
    }
  }
}

export function sweepExpiredPasswordResetTokens(): void {
  const now = Date.now();
  for (const [token, record] of tokens) {
    if (now >= record.expiresAt) {
      tokens.delete(token);
    }
  }
}

export function clearAllPasswordResetTokens(): void {
  tokens.clear();
}
