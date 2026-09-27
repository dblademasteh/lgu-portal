/**
 * OIDC client registry.
 *
 * Backing for the client model in `lib/oidc.ts`. `findClient` consults this
 * *before* falling back to the system-derived demo clients, so an externally
 * registered relying party (e.g. HRMS) is recognised at `/api/oidc/authorize`
 * with its own `redirect_uri` — the core capability the portal previously
 * lacked (clients were derived from the in-memory SYSTEMS catalogue only, and
 * `registerClient` was a non-persisting stub).
 *
 * Implementation note: this is an in-process `Map`, consistent with the demo
 * SYSTEMS catalogue and the in-memory session store. Registered clients reset
 * on restart. For a multi-replica/production deployment swap the storage here
 * for Postgres — the public surface (`getClientRecord`, `listClientRecords`,
 * `registerClientInStore`, `deleteClientRecord`, `rotateClientSecretInStore`)
 * is intentionally small so that move is a drop-in change.
 */

import type { Role } from './auth/users';
import { getSystem, type System } from './systems';

export interface ClientRecord {
  clientId: string;
  name: string;
  description: string;
  redirectUris: string[];
  scopes: string[];
  allowedRoles: Role[];
  /** `null` when the client is not one of the demo systems (e.g. an external RP). */
  systemSlug: string | null;
  /** Hashed or plaintext secret for confidential clients; absent for public clients. */
  clientSecret: string | null;
  createdAt: number;
}

const registry = new Map<string, ClientRecord>();

const HRMS_DEFAULT_REDIRECT = 'http://localhost:4000/api/oidc/callback';

/** Seed the canonical external clients from env so the connection works locally. */
function seedClients(): void {
  const raw = process.env.HRMS_REDIRECT_URI?.trim() || HRMS_DEFAULT_REDIRECT;
  const redirectUris = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (redirectUris.length === 0) return;

  const hrms: ClientRecord = {
    clientId: 'lgu-hrms',
    name: 'LGU HRMS',
    description:
      'Human Resource Management System — employee records, payroll, leave and attendance.',
    redirectUris,
    scopes: ['openid', 'profile', 'email', 'employee_id', 'roles'],
    allowedRoles: [],
    systemSlug: null,
    clientSecret: null,
    createdAt: Date.now(),
  };

  registry.set(hrms.clientId, hrms);
}

seedClients();

export function getClientRecord(clientId: string): ClientRecord | null {
  return registry.get(clientId) ?? null;
}

export function listClientRecords(): ClientRecord[] {
  return [...registry.values()];
}

export function registerClientInStore(
  record: Omit<ClientRecord, 'createdAt'> & { createdAt?: number },
): ClientRecord {
  if (registry.has(record.clientId)) {
    throw new Error(`Client ${record.clientId} already exists`);
  }
  const full: ClientRecord = { ...record, createdAt: record.createdAt ?? Date.now(), clientSecret: record.clientSecret ?? null };
  registry.set(full.clientId, full);
  return full;
}

export function deleteClientRecord(clientId: string): boolean {
  return registry.delete(clientId);
}

/** Rotate the secret for a confidential client. Public clients (`none` auth) have
 * no secret — surface that distinctly so the UI can explain it instead of
 * inventing a meaningless value. */
export function rotateClientSecretInStore(clientId: string): string {
  const record = registry.get(clientId);
  if (!record) throw new Error(`Client ${clientId} not found`);
  if (!record.systemSlug) {
    throw new Error(
      `Client ${clientId} is public (PKCE only); no client secret is configured to rotate.`,
    );
  }
  const secret = crypto.randomUUID();
  record.clientSecret = secret;
  return secret;
}

export function systemForRecord(record: ClientRecord): System | null {
  if (!record.systemSlug) return null;
  return getSystem(record.systemSlug);
}
