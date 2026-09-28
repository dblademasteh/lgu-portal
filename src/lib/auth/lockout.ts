/**
 * Account lockout tracking.
 *
 * After MAX_FAILED_ATTEMPTS failed logins within a sliding window, the account
 * is locked for LOCKOUT_DURATION_MS. This is separate from the manual admin
 * lock (LOCKED_USER_ID) and from the IP/identity rate limiter.
 *
 * The tracker is in-memory and per-instance. For production, this state should
 * be moved to Redis so it is shared across replicas.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export type LockoutRecord = {
  failedAttempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
};

const lockouts = new Map<string, LockoutRecord>();

export function recordFailedAttempt(userId: string): void {
  const now = Date.now();
  const existing = lockouts.get(userId);

  if (!existing || now - existing.firstAttemptAt > WINDOW_MS) {
    lockouts.set(userId, {
      failedAttempts: 1,
      firstAttemptAt: now,
      lockedUntil: 0,
    });
    return;
  }

  existing.failedAttempts += 1;

  if (existing.failedAttempts >= MAX_FAILED_ATTEMPTS && existing.lockedUntil === 0) {
    existing.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
}

export function recordSuccessfulAttempt(userId: string): void {
  lockouts.delete(userId);
}

export function isLockedOut(userId: string): boolean {
  const record = lockouts.get(userId);
  if (!record) return false;

  const now = Date.now();
  if (record.lockedUntil > 0 && now < record.lockedUntil) {
    return true;
  }

  if (record.lockedUntil > 0 && now >= record.lockedUntil) {
    lockouts.delete(userId);
    return false;
  }

  if (now - record.firstAttemptAt > WINDOW_MS) {
    lockouts.delete(userId);
    return false;
  }

  return false;
}

export function getRemainingLockoutMs(userId: string): number {
  const record = lockouts.get(userId);
  if (!record || record.lockedUntil === 0) return 0;

  const remaining = record.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function unlockAccount(userId: string): void {
  lockouts.delete(userId);
}

export function getLockoutStats(): { activeLockouts: number } {
  const now = Date.now();
  let active = 0;

  for (const [, record] of lockouts) {
    if (record.lockedUntil > 0 && now < record.lockedUntil) {
      active++;
    }
  }

  return { activeLockouts: active };
}

export function clearAllLockouts(): number {
  const count = lockouts.size;
  lockouts.clear();
  return count;
}
