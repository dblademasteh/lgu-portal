/**
 * Append-only audit trail.
 *
 * Every authentication and authorization decision lands here. Like the session
 * store this is an in-memory ring buffer for the demo; a real deployment writes
 * to an append-only table or a SIEM forwarder, because audit data is evidence
 * and must survive the process that produced it.
 *
 * Entries are treated as sensitive: they record actor, target and outcome, so
 * they are never rendered without the outcome styling that distinguishes them.
 */

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'challenge';

export type AuditEvent =
  | 'auth.login.attempt'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.mfa.required'
  | 'auth.mfa.success'
  | 'auth.mfa.failure'
  | 'auth.logout'
  | 'auth.session.expired'
  | 'auth.idp.failure'
  | 'app.launch'
  | 'app.launch.denied'
  | 'oidc.token.issued'
  | 'oidc.token.denied'
  | 'admin.keys.rotate'
  | 'admin.keys.revoke'
  | 'admin.client.updated'
  | 'admin.session.revoked'
  | 'admin.maintenance.rate_limits_clear'
  | 'admin.maintenance.sessions_purge'
  | 'rate_limit.blocked';

export type AuditEntry = {
  id: string;
  at: number;
  event: AuditEvent;
  outcome: AuditOutcome;
  actorId?: string;
  actorLabel?: string;
  target?: string;
  detail?: string;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
  /** Correlation id, also surfaced in the UI so a flow can be traced end to end. */
  traceId: string;
};

const MAX_ENTRIES = 500;
const entries: AuditEntry[] = [];
let sequence = 0;

function nextTraceId(): string {
  sequence = (sequence + 1) % 0xffff;
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `tr_${stamp}_${sequence.toString(36)}${rand}`;
}

export function record(
  event: AuditEvent,
  outcome: AuditOutcome,
  fields: Omit<Partial<AuditEntry>, 'id' | 'at' | 'event' | 'outcome' | 'traceId'> = {},
): AuditEntry {
  const entry: AuditEntry = {
    id: `ae_${(entries.length + 1).toString(36)}_${Date.now().toString(36)}`,
    at: Date.now(),
    event,
    outcome,
    traceId: nextTraceId(),
    ...fields,
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;

  if (process.env.NODE_ENV !== 'test') {
    // Structured single-line log, greppable by traceId.
    const { logger } = require('@/lib/logging');
    logger.info(
      { traceId: entry.traceId, event, outcome, actorId: entry.actorId, target: entry.target, detail: entry.detail },
      `[audit] ${entry.traceId} ${event} ${outcome}`,
    );
  }
  return entry;
}

export function recent(limit = 40, actorId?: string): AuditEntry[] {
  const pool = actorId ? entries.filter((entry) => entry.actorId === actorId) : entries;
  return pool.slice(0, limit);
}

export function stats() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const window = entries.filter((entry) => entry.at >= since);
  return {
    total: window.length,
    failures: window.filter((entry) => entry.outcome === 'failure').length,
    denials: window.filter((entry) => entry.outcome === 'denied').length,
    successes: window.filter((entry) => entry.outcome === 'success').length,
  };
}

/* ------------------------------------------------------------------ */
/* Detailed stats (admin)                                              */
/* ------------------------------------------------------------------ */

export type AuditStats = {
  last24h: number;
  lastHour: number;
  success: number;
  denied: number;
  failure: number;
  challenge: number;
};

/** Detailed stats for the admin dashboard. */
export function getAuditStats(): AuditStats {
  const now = Date.now();
  const day = now - 24 * 60 * 60 * 1000;
  const hour = now - 60 * 60 * 1000;

  const dayEntries = entries.filter((entry) => entry.at >= day);
  const hourEntries = entries.filter((entry) => entry.at >= hour);

  return {
    last24h: dayEntries.length,
    lastHour: hourEntries.filter((entry) => entry.at >= hour).length,
    success: dayEntries.filter((entry) => entry.outcome === 'success').length,
    denied: dayEntries.filter((entry) => entry.outcome === 'denied').length,
    failure: dayEntries.filter((entry) => entry.outcome === 'failure').length,
    challenge: dayEntries.filter((entry) => entry.outcome === 'challenge').length,
  };
}

/* ------------------------------------------------------------------ */
/* Filtered query with pagination (admin)                              */
/* ------------------------------------------------------------------ */

export type AuditQuery = {
  event?: string;
  outcome?: string;
  actor?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};

export type AuditQueryResult = {
  entries: AuditEntry[];
  total: number;
};

/** Query audit entries with filters and pagination. */
export function getAuditEntries(query: AuditQuery = {}): AuditQueryResult {
  const { event, outcome, actor, from, to, limit = 50, offset = 0 } = query;

  let pool = entries;

  if (event) pool = pool.filter((e) => e.event === event);
  if (outcome) pool = pool.filter((e) => e.outcome === outcome);
  if (actor) pool = pool.filter((e) => e.actorId?.includes(actor) || e.actorLabel?.toLowerCase().includes(actor.toLowerCase()));
  if (from) pool = pool.filter((e) => e.at >= from);
  if (to) pool = pool.filter((e) => e.at <= to);

  const total = pool.length;
  const paginated = pool.slice(offset, offset + limit);

  return { entries: paginated, total };
}
