/**
 * One-time launch tickets.
 *
 * After the token endpoint issues a token set, the browser must not carry those
 * tokens: URLs end up in history, referrers and access logs. So the callback
 * parks the token set server-side and hands the browser an opaque ticket.
 *
 * The ticket is bound three ways before it is honoured:
 *   - it must be present in the signed, httpOnly handoff cookie
 *   - the signature on that cookie must verify
 *   - it must be unused and unexpired
 *
 * `consume` deletes the record, so a leaked ticket is worth exactly one render.
 */

import { hmac, randomToken, verifySigned } from './auth/crypto';
import type { TokenSet } from './oidc';

export const HANDOFF_COOKIE = 'lgu_oidc_handoff';
const HANDOFF_TTL_MS = 2 * 60 * 1000;

export type Handoff = {
  ticket: string;
  slug: string;
  clientId: string;
  tokens: TokenSet;
  issuedAt: number;
  expiresAt: number;
  scopes: string[];
  /** Kept so the downstream shell can show what was actually verified. */
  mfaVerified: boolean;
};

const tickets = new Map<string, Handoff>();

function handoffSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production.');
  }
  return 'lgu-portal-development-only-secret-do-not-ship';
}

export function sealTicket(ticket: string): string {
  return `${ticket}.${hmac(ticket, handoffSecret())}`;
}

export function openTicket(value: string | undefined | null): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;
  const ticket = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  return verifySigned(ticket, signature, handoffSecret()) ? ticket : null;
}

export function issueHandoff(params: {
  slug: string;
  clientId: string;
  tokens: TokenSet;
  mfaVerified: boolean;
}): string {
  const now = Date.now();
  const ticket = randomToken(24);
  tickets.set(ticket, {
    ticket,
    slug: params.slug,
    clientId: params.clientId,
    tokens: params.tokens,
    issuedAt: now,
    expiresAt: now + HANDOFF_TTL_MS,
    scopes: params.tokens.scope.split(' ').filter(Boolean),
    mfaVerified: params.mfaVerified,
  });
  sweep();
  return ticket;
}

/** Redeem a ticket. Single use: the record is removed on success. */
export function consumeHandoff(ticket: string | null | undefined): Handoff | null {
  if (!ticket) return null;
  const handoff = tickets.get(ticket);
  if (!handoff) return null;
  if (Date.now() >= handoff.expiresAt) {
    tickets.delete(ticket);
    return null;
  }
  tickets.delete(ticket);
  return handoff;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, handoff] of tickets) {
    if (now >= handoff.expiresAt) tickets.delete(key);
  }
}

export const HANDOFF_TTL_MS_EXPORT = HANDOFF_TTL_MS;
