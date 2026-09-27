/**
 * Readiness probe endpoint.
 *
 * Reports on the session store, rate limiter, and audit log. Returns 503 only
 * when a check genuinely fails, so a Kubernetes rollout is not blocked by a
 * subsystem that is degraded but still serving.
 *
 * The session check is the interesting one. `storeProbe()` reports which
 * backend is *actually* serving requests, which is not always the configured
 * one: if Redis is unreachable the app falls back to the in-memory store. That
 * is a warning, not a failure — the pod is serving, it just cannot persist
 * sessions across a restart, and pulling it from the load balancer would turn a
 * degradation into an outage.
 */

import { NextResponse } from 'next/server';

type CheckStatus = 'pass' | 'fail' | 'warn';
type Check = { status: CheckStatus; message: string; latencyMs: number };

export async function GET() {
  const checks: Record<string, Check> = {};

  const sessionStart = Date.now();
  try {
    const { storeProbe, getSessionStats } = await import('@/lib/auth/sessions');
    const [probe, stats] = await Promise.all([storeProbe(), getSessionStats()]);
    checks.sessions = {
      status: probe.degraded ? 'warn' : probe.ok ? 'pass' : 'fail',
      message: `${probe.kind} store — ${probe.message} (${stats.total} sessions, ${stats.active} active)`,
      latencyMs: Date.now() - sessionStart,
    };
  } catch (error) {
    checks.sessions = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Session store error',
      latencyMs: Date.now() - sessionStart,
    };
  }

  const rateLimitStart = Date.now();
  try {
    const { getRateLimitStats } = await import('@/lib/auth/rate-limit');
    const stats = getRateLimitStats();
    checks.rateLimiter = {
      status: 'pass',
      message: `${stats.activeBuckets} active buckets`,
      latencyMs: Date.now() - rateLimitStart,
    };
  } catch (error) {
    checks.rateLimiter = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Rate limiter error',
      latencyMs: Date.now() - rateLimitStart,
    };
  }

  const auditStart = Date.now();
  try {
    const { getAuditStats } = await import('@/lib/auth/audit');
    const stats = getAuditStats();
    checks.audit = {
      status: 'pass',
      message: `${stats.last24h} events (24h)`,
      latencyMs: Date.now() - auditStart,
    };
  } catch (error) {
    checks.audit = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Audit log error',
      latencyMs: Date.now() - auditStart,
    };
  }

  const values = Object.values(checks);
  const failed = values.some((check) => check.status === 'fail');
  const degraded = values.some((check) => check.status === 'warn');

  const status = failed ? 'unhealthy' : degraded ? 'degraded' : 'healthy';

  return NextResponse.json(
    { status, timestamp: new Date().toISOString(), checks },
    {
      status: failed ? 503 : 200,
      headers: {
        'Content-Type': 'application/health+json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
