/**
 * Prometheus Metrics.
 *
 * Exposes HTTP metrics for Prometheus scraping.
 *
 * Install: npm install prom-client
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics, Registry as Register } from 'prom-client';

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const register = new Register();

/* ------------------------------------------------------------------ */
/* Default metrics                                                     */
/* ------------------------------------------------------------------ */

// Collect Node.js default metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({ register, prefix: 'nodejs_' });

/* ------------------------------------------------------------------ */
/* Custom metrics                                                      */
/* ------------------------------------------------------------------ */

// HTTP request metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Authentication metrics
export const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['outcome', 'method'],
  registers: [register],
});

export const authSessionsActive = new Gauge({
  name: 'auth_sessions_active',
  help: 'Currently active sessions',
  registers: [register],
});

export const authMfaChallengesTotal = new Counter({
  name: 'auth_mfa_challenges_total',
  help: 'Total MFA challenges issued',
  labelNames: ['outcome'],
  registers: [register],
});

// OIDC metrics
export const oidcTokensIssuedTotal = new Counter({
  name: 'oidc_tokens_issued_total',
  help: 'Total OIDC tokens issued',
  labelNames: ['grant_type', 'client_id'],
  registers: [register],
});

export const oidcAuthCodesTotal = new Counter({
  name: 'oidc_auth_codes_total',
  help: 'Total authorization codes issued',
  labelNames: ['outcome'],
  registers: [register],
});

// Rate limiting metrics
export const rateLimitHitsTotal = new Counter({
  name: 'rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['bucket_kind', 'outcome'],
  registers: [register],
});

export const rateLimitBucketsActive = new Gauge({
  name: 'rate_limit_buckets_active',
  help: 'Active rate limit buckets',
  registers: [register],
});

// System health metrics
export const systemInfo = new Gauge({
  name: 'system_info',
  help: 'System information',
  labelNames: ['version', 'environment', 'node_version'],
  registers: [register],
});

export const buildInfo = new Gauge({
  name: 'build_info',
  help: 'Build information',
  labelNames: ['version', 'commit', 'build_time'],
  registers: [register],
});

/* ------------------------------------------------------------------ */
/* Metrics endpoint                                                    */
/* ------------------------------------------------------------------ */

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

export async function getMetricsContentType(): Promise<string> {
  return register.contentType;
}

/* ------------------------------------------------------------------ */
/* Helper functions                                                    */
/* ------------------------------------------------------------------ */

export function recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number) {
  httpRequestsTotal.inc({ method, route, status_code: String(statusCode) });
  httpRequestDuration.observe({ method, route, status_code: String(statusCode) }, durationMs / 1000);
}

export function recordAuthAttempt(outcome: 'success' | 'failure' | 'locked' | 'mfa_required', method: 'password' | 'mfa') {
  authAttemptsTotal.inc({ outcome, method });
}

export function recordMfaChallenge(outcome: 'issued' | 'verified' | 'failed' | 'expired') {
  authMfaChallengesTotal.inc({ outcome });
}

export function recordOidcTokenIssued(grantType: 'authorization_code' | 'refresh_token', clientId: string) {
  oidcTokensIssuedTotal.inc({ grant_type: grantType, client_id: clientId });
}

export function recordAuthCode(outcome: 'issued' | 'redeemed' | 'expired' | 'replayed') {
  oidcAuthCodesTotal.inc({ outcome });
}

export function recordRateLimitHit(kind: 'identity' | 'client' | 'mfa', outcome: 'allowed' | 'blocked') {
  rateLimitHitsTotal.inc({ bucket_kind: kind, outcome });
}

export function setActiveSessions(count: number) {
  authSessionsActive.set(count);
}

export function setRateLimitBuckets(count: number) {
  rateLimitBucketsActive.set(count);
}

export function setSystemInfo(version: string, environment: string) {
  systemInfo.set({ version, environment, node_version: process.version }, 1);
}

export function setBuildInfo(version: string, commit: string, buildTime: string) {
  buildInfo.set({ version, commit, build_time: buildTime }, 1);
}