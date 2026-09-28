/**
 * Consent records for OIDC authorization.
 *
 * When a user is asked to approve scopes, the decision is recorded here so the
 * consent screen is not shown again for the same user+client+scope combination.
 *
 * The store is in-memory for the demo; a production deployment would persist
 * these records so they survive restarts and are shared across replicas.
 */

import { record } from './audit';

export type ConsentRecord = {
  userId: string;
  clientId: string;
  scopes: string[];
  consentedAt: number;
};

const consents = new Map<string, ConsentRecord>();

function key(userId: string, clientId: string): string {
  return `${userId}:${clientId}`;
}

/**
 * Check whether the user has already consented to all of the requested scopes
 * for this client.
 */
export function hasConsent(userId: string, clientId: string, scopes: string[]): boolean {
  const record = consents.get(key(userId, clientId));
  if (!record) return false;
  return scopes.every((scope) => record.scopes.includes(scope));
}

/**
 * Record a new consent decision.
 */
export function recordConsent(userId: string, clientId: string, scopes: string[]): void {
  consents.set(key(userId, clientId), {
    userId,
    clientId,
    scopes: [...scopes],
    consentedAt: Date.now(),
  });
}

/**
 * Get the consent record for a user+client, if any.
 */
export function getConsent(userId: string, clientId: string): ConsentRecord | null {
  return consents.get(key(userId, clientId)) ?? null;
}

/**
 * Revoke consent for a user+client. Used when a user locks their account or
 * when scopes change.
 */
export function revokeConsent(userId: string, clientId: string): void {
  consents.delete(key(userId, clientId));
}

/**
 * Clear all consent records. Used in tests.
 */
export function clearAllConsents(): void {
  consents.clear();
}

/**
 * Human-readable descriptions for known scopes.
 */
export function describeScope(scope: string): string {
  const descriptions: Record<string, string> = {
    openid: 'Basic sign-in information (your name and email)',
    profile: 'Your profile information (display name, time zone)',
    email: 'Your email address',
    roles: 'Your assigned roles and permissions',
    'profile:read': 'Read your employee profile',
    'leave:write': 'Submit and manage leave requests',
    'payroll:read': 'View payslips and payroll records',
    'revenue:read': 'View collection and revenue records',
    'revenue:write': 'Create and update revenue entries',
    'disbursement:approve': 'Approve disbursements',
    'budget:read': 'View budget proposals and allotments',
    'budget:write': 'Create and edit budget proposals',
    'obligation:write': 'Create and manage obligations',
    'parcel:read': 'View parcel and property records',
    'zoning:read': 'View zoning overlays and maps',
    'permit:write': 'Create and manage permits',
    'document:read': 'View documents and records',
    'document:write': 'Create and edit documents',
    'document:sign': 'Sign documents digitally',
    'catalogue:read': 'Browse the library catalogue',
    'circulation:write': 'Borrow and return library items',
    'registry:read': 'View health registry records',
    'registry:write': 'Create and update health records',
    'inventory:read': 'View medical supply inventory',
    'canvass:read': 'View canvass and bid records',
    'canvass:write': 'Create and edit canvass entries',
    'po:approve': 'Approve purchase orders',
    'ticket:read': 'View helpdesk tickets',
    'ticket:write': 'Create and update helpdesk tickets',
    'asset:read': 'View ICT asset inventory',
    'kpi:read': 'View analytics dashboards and KPIs',
    'feedback:read': 'View citizen feedback metrics',
    'role:read': 'View roles and access grants',
    'role:write': 'Create and modify roles',
    'access:approve': 'Approve access requests',
    'permit:read': 'View permits and clearances',
    'clearance:write': 'Issue clearances',
  };

  return descriptions[scope] ?? `Access to: ${scope}`;
}
