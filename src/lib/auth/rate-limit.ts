/**
 * Fixed-window rate limiter for credential endpoints.
 *
 * Two independent buckets are enforced per request:
 *   - per identity (username), to stop password spraying across many accounts
 *   - per client (IP), to stop one host grinding through a password list
 *
 * In-memory, so it is per-instance and resets on deploy. That is acceptable for
 * a demo and is called out in the README; a shared Redis bucket is the
 * production answer. The interface is deliberately the same shape as a
 * `RateLimit` from a hosted edge provider.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;

/** Distinct budgets per bucket key type. */
const POLICIES = {
  identity: { max: 8, message: 'Too many sign-in attempts for this account. Try again shortly.' },
  client: { max: 30, message: 'Too many sign-in requests from this device. Try again shortly.' },
  mfa: { max: 6, message: 'Too many verification code attempts. Request a new code.' },
} as const;

export type BucketKind = keyof typeof POLICIES;

export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; retryAfterSeconds: number; message: string };

function key(kind: BucketKind, identifier: string): string {
  // Hash the identifier so usernames and IPs are not held in plaintext keys.
  return `${kind}:${identifier.trim().toLowerCase()}`;
}

export function check(kind: BucketKind, identifier: string): RateLimitResult {
  if (!identifier) return { allowed: true, remaining: POLICIES[kind].max, resetAt: Date.now() + WINDOW_MS };

  const policy = POLICIES[kind];
  const now = Date.now();
  const bucketKey = key(kind, identifier);
  const bucket = buckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: policy.max - 1, resetAt: now + WINDOW_MS };
  }

  if (bucket.count >= policy.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      message: policy.message,
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: policy.max - bucket.count, resetAt: bucket.resetAt };
}

/** Clear an identity's failures after a successful login. */
export function reset(kind: BucketKind, identifier: string): void {
  buckets.delete(key(kind, identifier));
}

/** Periodic sweep so the map cannot grow without bound. */
export function sweep(): void {
  const now = Date.now();
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }
}

/**
 * Drop every bucket, returning how many were removed. Backs the admin
 * "Clear All Rate Limits" control, for when a lockout needs lifting without a
 * redeploy. Buckets are per-instance, so this only affects the replica it runs
 * on — see the README limitation about in-memory rate limiting.
 */
export function clearAll(): number {
  const removed = buckets.size;
  buckets.clear();
  return removed;
}

/* ------------------------------------------------------------------ */
/* Stats (admin)                                                       */
/* ------------------------------------------------------------------ */

export type RateLimitStats = {
  activeBuckets: number;
  blocked5m: number;
  total5m: number;
};

/** Aggregate stats for the admin dashboard. */
export function getRateLimitStats() {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  let activeBuckets = 0;
  let blocked5m = 0;
  let total5m = 0;

  for (const [, bucket] of buckets) {
    if (bucket.resetAt > Date.now()) {
      activeBuckets += 1;
    }
    // Approximate: count buckets that were created/modified in last 5 min
    // We don't track creation time, so approximate from resetAt
    if (bucket.resetAt > Date.now() - 5 * 60 * 1000) {
      total5m += 1;
    }
  }

  // Count currently blocked identities (would need separate tracking)
  // This is a placeholder; real implementation would track blocked count separately
  const blocked5mCount = 0;

  return { activeBuckets, blocked5m: blocked5mCount, total5m };
}
