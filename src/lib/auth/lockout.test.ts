import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordFailedAttempt,
  recordSuccessfulAttempt,
  isLockedOut,
  getRemainingLockoutMs,
  unlockAccount,
  getLockoutStats,
  clearAllLockouts,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
} from './lockout';

describe('lockout', () => {
  beforeEach(() => {
    clearAllLockouts();
    vi.useRealTimers();
  });

  it('does not lock out after fewer than MAX_FAILED_ATTEMPTS', () => {
    const userId = 'user-1';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      recordFailedAttempt(userId);
      expect(isLockedOut(userId)).toBe(false);
    }
  });

  it('locks out after exactly MAX_FAILED_ATTEMPTS attempts', () => {
    const userId = 'user-1';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      recordFailedAttempt(userId);
    }
    recordFailedAttempt(userId);
    expect(isLockedOut(userId)).toBe(true);
  });

  it('remains locked within the lockout window', () => {
    const userId = 'user-1';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId);
    }
    expect(isLockedOut(userId)).toBe(true);
  });

  it('unlocks after lockout expires', () => {
    vi.useFakeTimers();
    const userId = 'user-1';
    const now = Date.now();

    vi.setSystemTime(now);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId);
    }
    expect(isLockedOut(userId)).toBe(true);

    vi.advanceTimersByTime(LOCKOUT_DURATION_MS + 1000);
    expect(isLockedOut(userId)).toBe(false);
    vi.useRealTimers();
  });

  it('resets on successful attempt', () => {
    const userId = 'user-1';
    recordFailedAttempt(userId);
    recordFailedAttempt(userId);
    recordSuccessfulAttempt(userId);
    expect(isLockedOut(userId)).toBe(false);

    // After reset, need MAX_FAILED_ATTEMPTS again
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      recordFailedAttempt(userId);
      expect(isLockedOut(userId)).toBe(false);
    }
    recordFailedAttempt(userId);
    expect(isLockedOut(userId)).toBe(true);
  });

  it('getRemainingLockoutMs returns 0 for non-locked user', () => {
    expect(getRemainingLockoutMs('user-1')).toBe(0);
  });

  it('getRemainingLockoutMs returns remaining time for locked user', () => {
    vi.useFakeTimers();
    const userId = 'user-1';
    const now = Date.now();

    vi.setSystemTime(now);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId);
    }

    const remaining = getRemainingLockoutMs(userId);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(LOCKOUT_DURATION_MS);
    vi.useRealTimers();
  });

  it('unlockAccount clears lockout', () => {
    const userId = 'user-1';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId);
    }
    expect(isLockedOut(userId)).toBe(true);
    unlockAccount(userId);
    expect(isLockedOut(userId)).toBe(false);
  });

  it('clearAllLockouts removes all records', () => {
    for (let i = 0; i < 3; i++) {
      const userId = `user-${i}`;
      for (let j = 0; j < MAX_FAILED_ATTEMPTS; j++) {
        recordFailedAttempt(userId);
      }
    }
    expect(getLockoutStats().activeLockouts).toBe(3);
    clearAllLockouts();
    expect(getLockoutStats().activeLockouts).toBe(0);
  });

  it('getLockoutStats counts only active lockouts', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const userId1 = 'user-1';
    const userId2 = 'user-2';

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId1);
    }
    expect(getLockoutStats().activeLockouts).toBe(1);

    // Expire one lockout
    vi.advanceTimersByTime(LOCKOUT_DURATION_MS + 1000);
    // Now record enough attempts for user2 to lock out
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(userId2);
    }
    const stats = getLockoutStats();
    expect(stats.activeLockouts).toBe(1);
    vi.useRealTimers();
  });

  it('tracks attempts in a sliding window', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const userId = 'user-1';
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      recordFailedAttempt(userId);
    }
    expect(isLockedOut(userId)).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(16 * 60 * 1000);
    recordFailedAttempt(userId);
    expect(isLockedOut(userId)).toBe(false);
    vi.useRealTimers();
  });
});
