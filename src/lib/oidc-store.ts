/**
 * Redis-backed OIDC object store.
 *
 * When REDIS_URL is set, OIDC objects are stored in Redis with TTLs. When Redis
 * is unavailable the store falls back to in-memory Maps.
 *
 * This module is not yet wired into oidc.ts, oidc-flow.ts, handoff.ts, or the
 * login route. It is provided as the seam for migrating those in-memory Maps
 * to durable storage.
 */

import { RedisMap } from './redis-map';

export type OidcStore = {
  kind: 'memory' | 'redis';
  codes: RedisMap<string, { code: string; clientId: string; userId: string; redirectUri: string; scope: string; codeChallenge: string | null; nonce: string | null; issuedAt: number; expiresAt: number; consumedAt: number | null }>;
  refreshTokens: RedisMap<string, { userId: string; clientId: string; scope: string; expiresAt: number }>;
  flows: RedisMap<string, { verifier: string; slug: string; issuedAt: number }>;
  handoffs: RedisMap<string, { slug: string; clientId: string; tokens: unknown; scopes: string[]; mfaVerified: boolean; issuedAt: number; expiresAt: number }>;
  mfaChallenges: RedisMap<string, { userId: string; code: string; expiresAt: number }>;
};

function createStore(): OidcStore {
  return {
    kind: 'memory',
    codes: new RedisMap('lgu:oidc:code', 60_000),
    refreshTokens: new RedisMap('lgu:oidc:refresh', 8 * 60 * 60_000),
    flows: new RedisMap('lgu:oidc:flow', 10 * 60_000),
    handoffs: new RedisMap('lgu:oidc:handoff', 2 * 60_000),
    mfaChallenges: new RedisMap('lgu:oidc:mfa', 5 * 60_000),
  };
}

export const oidcStore: OidcStore = createStore();
