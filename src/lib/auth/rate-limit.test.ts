import { describe, it, expect, beforeEach, vi } from 'vitest';
import { check, reset, sweep, clearAll, getRateLimitStats, type BucketKind } from './rate-limit';

describe('rate limiter', () => {
  beforeEach(() => {
    clearAll();
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = check('identity', 'user1');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks after exceeding identity limit', () => {
    for (let i = 0; i < 8; i++) {
      check('identity', 'user1');
    }
    const result = check('identity', 'user1');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.message).toBeTruthy();
    }
  });

  it('tracks identity and client buckets independently', () => {
    for (let i = 0; i < 8; i++) check('identity', 'user1');
    expect(check('identity', 'user1').allowed).toBe(false);
    expect(check('identity', 'user2').allowed).toBe(true);
    for (let i = 0; i < 30; i++) check('client', '192.168.1.1');
    expect(check('client', '192.168.1.1').allowed).toBe(false);
  });

  it('tracks mfa bucket independently', () => {
    for (let i = 0; i < 6; i++) {
      const r = check('mfa', 'user1');
      expect(r.allowed).toBe(true);
    }
    expect(check('mfa', 'user1').allowed).toBe(false);
  });

  it('reset clears a specific bucket', () => {
    for (let i = 0; i < 8; i++) check('identity', 'user1');
    expect(check('identity', 'user1').allowed).toBe(false);
    reset('identity', 'user1');
    expect(check('identity', 'user1').allowed).toBe(true);
  });

  it('sweep removes expired buckets', () => {
    vi.useFakeTimers();
    check('identity', 'user1');
    expect(getRateLimitStats().activeBuckets).toBeGreaterThan(0);
    vi.advanceTimersByTime(16 * 60 * 1000);
    sweep();
    expect(getRateLimitStats().activeBuckets).toBe(0);
    vi.useRealTimers();
  });

  it('clearAll removes every bucket', () => {
    check('identity', 'user1');
    check('client', '192.168.1.1');
    const removed = clearAll();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(check('identity', 'user1').allowed).toBe(true);
  });

  it('handles empty identifiers', () => {
    const result = check('identity', '');
    expect(result.allowed).toBe(true);
  });

  it('getRateLimitStats returns counts', () => {
    for (let i = 0; i < 8; i++) check('identity', 'user1');
    const stats = getRateLimitStats();
    expect(stats.activeBuckets).toBeGreaterThanOrEqual(1);
    expect(typeof stats.blocked5m).toBe('number');
    expect(typeof stats.total5m).toBe('number');
  });
});
