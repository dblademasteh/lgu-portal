/**
 * External Identity Provider (IdP) client.
 *
 * When IDP_ISSUER is set, the portal delegates authentication to an external
 * OIDC provider (Keycloak, Entra ID, Google Workspace, etc.) instead of the
 * local stub in lib/auth/users.ts.
 *
 * The flow:
 *   1. User clicks "Sign in with IdP" → GET /api/idp/login
 *   2. Portal redirects to the IdP's authorization endpoint with PKCE S256
 *   3. IdP redirects back to /api/idp/callback with a code
 *   4. Portal exchanges the code for tokens, fetches userinfo, creates a session
 *
 * This keeps the local login form as the default and makes the IdP opt-in.
 */

import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';

export type IdPConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  logoutUrl?: string;
  scopes: string[];
};

export type IdPUser = {
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
  roles?: string[];
};

let cachedConfig: IdPConfig | null = null;

export function getIdPConfig(): IdPConfig | null {
  if (cachedConfig) return cachedConfig;

  const issuer = process.env.IDP_ISSUER;
  if (!issuer) return null;

  const clientId = process.env.IDP_CLIENT_ID;
  if (!clientId) {
    console.warn('IDP_ISSUER is set but IDP_CLIENT_ID is missing; IdP disabled.');
    return null;
  }

  const base = issuer.replace(/\/$/, '');
  cachedConfig = {
    issuer: base,
    clientId,
    clientSecret: process.env.IDP_CLIENT_SECRET,
    authorizationUrl: `${base}/protocol/openid-connect/auth`,
    tokenUrl: `${base}/protocol/openid-connect/token`,
    userinfoUrl: `${base}/protocol/openid-connect/userinfo`,
    logoutUrl: `${base}/protocol/openid-connect/logout`,
    scopes: (process.env.IDP_SCOPES ?? 'openid profile email').split(' ').filter(Boolean),
  };

  return cachedConfig;
}

export function isIdPEnabled(): boolean {
  return getIdPConfig() !== null;
}

/* ------------------------------------------------------------------ */
/* PKCE helpers                                                       */
/* ------------------------------------------------------------------ */

export function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* Cookie helpers for the IdP flow                                    */
/* ------------------------------------------------------------------ */

export const IDP_STATE_COOKIE = 'lgu_idp_state';

export async function setIdPStateCookie(state: string): Promise<void> {
  const store = await cookies();
  store.set(IDP_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 10 * 60,
  });
}

export async function getIdPStateCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(IDP_STATE_COOKIE)?.value ?? null;
}

export async function clearIdPStateCookie(): Promise<void> {
  const store = await cookies();
  store.set(IDP_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
