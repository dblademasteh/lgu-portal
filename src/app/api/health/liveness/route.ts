/**
 * Health Check Endpoints.
 *
 * Provides liveness and readiness probes for Kubernetes.
 * Liveness: Is the process alive?
 * Readiness: Can the service handle requests?
 */

import { NextResponse } from 'next/server';

/* ------------------------------------------------------------------ */
/* Health state                                                        */
/* ------------------------------------------------------------------ */

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, { status: 'pass' | 'fail' | 'warn'; message?: string; latencyMs?: number }>;
}

/* ------------------------------------------------------------------ */
/* Liveness probe - process is alive                                   */
/* ------------------------------------------------------------------ */

export async function GET() {
  const start = Date.now();

  const checks: HealthCheck['checks'] = {
    process: {
      status: 'pass',
      message: 'Process is running',
      latencyMs: 0,
    },
  };

  const response: HealthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}