/**
 * Pending authorization flows.
 *
 * When the launch page sends the browser to /api/oidc/authorize, the PKCE
 * verifier and the originating system must survive the round trip. They are held
 * server-side, keyed by an opaque `state` value; the browser only ever carries
 * the state itself.
 *
 * Why state is opaque: it is the CSRF binding for the flow. Putting data in it
 * and signing it would be workable, but an opaque random value is simpler to
 * reason about and has no encoding or canonicalisation pitfalls.
 *
 * Single-use and short-lived: a flow is deleted the moment it is redeemed, and
 * swept well before it could be replayed.
 */

import { randomToken } from './auth/crypto';

export const FLOW_COOKIE = 'lgu_oidc_flow';

const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 500;

export type PendingFlow = {
  state: string;
  verifier: string;
  slug: string;
  issuedAt: number;
};

const flows = new Map<string, PendingFlow>();

/** Register a flow and return the state the client must echo back. */
export function registerFlow(params: { slug: string; verifier: string }): string {
  sweep();
  if (flows.size >= MAX_PENDING_FLOWS) {
    // Drop the oldest rather than growing without bound.
    const oldest = [...flows.values()].sort((a, b) => a.issuedAt - b.issuedAt)[0];
    if (oldest) flows.delete(oldest.state);
  }

  const flow: PendingFlow = {
    state: randomToken(24),
    verifier: params.verifier,
    slug: params.slug,
    issuedAt: Date.now(),
  };
  flows.set(flow.state, flow);
  return flow.state;
}

/** Look up a flow without consuming it. */
export function peekFlow(state: string): PendingFlow | null {
  const flow = flows.get(state);
  if (!flow) return null;
  if (Date.now() - flow.issuedAt > FLOW_TTL_MS) {
    flows.delete(state);
    return null;
  }
  return flow;
}

/** Look up and remove a flow. Call once the code has been redeemed. */
export function takeFlow(state: string): PendingFlow | null {
  const flow = peekFlow(state);
  if (flow) flows.delete(state);
  return flow;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, flow] of flows) {
    if (now - flow.issuedAt > FLOW_TTL_MS) flows.delete(key);
  }
}

export const FLOW_POLICY = { ttlMs: FLOW_TTL_MS, maxPending: MAX_PENDING_FLOWS } as const;
