/**
 * Minimal OpenID Connect provider — the authorisation server half of the SSO.
 *
 * Implements the parts of the spec the portal needs to be a genuine single
 * sign-on rather than a shared login form:
 *
 *   GET  /api/oidc/authorize  -> 302 with `code` + `state` (requires a session)
 *   POST /api/oidc/token      ->  code exchange, verifies PKCE, issues tokens
 *   GET  /api/oidc/userinfo   ->  claims for a presented access token
 *   GET  /api/oidc/jwks       ->  verification key set
 *   POST /api/oidc/logout     ->  ends the SSO session
 *   GET  /api/oidc/discovery  ->  /.well-known/openid-configuration
 *
 * Tokens are now signed RS256 against the provisioned key ring in
 * `lib/admin/keys.ts` (see `signWithActiveKey`), and the JWKS route publishes
 * those public keys. This lets an external relying party (e.g. HRMS) verify
 * tokens it receives without ever holding signing material — the previous HS256
 * stub published the symmetric secret in its JWKS, which is unsafe for
 * third-party verification.
 *
 * Deliberate limitations of the stub, all fixable and none of them load-bearing
 * for the demo:
 *  - there is no refresh-token rotation, key rotation, or consent screen
 *  - refresh tokens are an in-process Map
 *  - the client registry and keyring are in-process (see lib/clients-store.ts)
 */

import {
  codeChallengeS256,
  sha256,
  base64url,
  randomToken,
  type JwtClaims,
} from './auth/crypto';
import {
  signWithActiveKey,
  verifyIdToken,
  type JwtHeader,
} from './admin/keys';
import { getSystem, listSystems, type System } from './systems';
import {
  getClientRecord,
  listClientRecords,
  deleteClientRecord,
  registerClientInStore,
  rotateClientSecretInStore,
} from './clients-store';
import type { ClientRecord } from './clients-store';
import type { Role } from './auth/users';

export const OIDC_ISSUER =
  process.env.OIDC_ISSUER ?? 'http://localhost:3000';

const CLIENT_ID_PREFIX = 'lgu-';
const AUTH_CODE_TTL_MS = 60_000; // short-lived, per OAuth 2.0 security BCP
const ACCESS_TOKEN_TTL_S = 900; // 15 minutes
const ID_TOKEN_TTL_S = 900;
const REFRESH_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/** `openid profile email roles` plus whatever the client asked for. */
const BASE_SCOPES = new Set(['openid', 'profile', 'email', 'roles']);

export type OidcClient = {
  clientId: string;
  clientSecret: string;
  /** Absent for externally registered clients that are not one of the demo systems. */
  system: System | null;
  /** Roles that may launch / receive tokens. Empty array = everyone. */
  allowedRoles: Role[];
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none'; // public client, PKCE only
  allowedScopes: string[];
  createdAt: number;
};

export type AuthorizationCode = {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  /** S256 challenge the token request must satisfy. */
  codeChallenge: string | null;
  nonce: string | null;
  issuedAt: number;
  expiresAt: number;
  /** One-time use. A second exchange must fail. */
  consumedAt: number | null;
};

const codes = new Map<string, AuthorizationCode>();
const refreshTokens = new Map<string, { userId: string; clientId: string; scope: string; expiresAt: number }>();

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export function clientIdFor(system: System): string {
  return `${CLIENT_ID_PREFIX}${system.slug}`;
}

/** Does this viewer's role set satisfy the client's access policy? */
export function clientAllows(client: OidcClient, roles: readonly Role[]): boolean {
  return client.allowedRoles.length === 0 || client.allowedRoles.some((role) => roles.includes(role));
}

/** Build an OidcClient view from a persisted/external client record. */
function toClient(record: ClientRecord): OidcClient {
  return {
    clientId: record.clientId,
    clientSecret: record.clientSecret ?? crypto.randomUUID(),
    system: record.systemSlug ? getSystem(record.systemSlug) ?? null : null,
    allowedRoles: record.allowedRoles,
    redirectUris: record.redirectUris,
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    allowedScopes: record.scopes,
    createdAt: record.createdAt,
  };
}

function toSystemClient(system: System): OidcClient {
  return {
    clientId: clientIdFor(system),
    clientSecret: crypto.randomUUID(),
    system,
    allowedRoles: system.allowedRoles,
    redirectUris: [
      `${OIDC_ISSUER}/api/oidc/callback`,
      `${OIDC_ISSUER}/api/oidc/callback/loopback`,
    ],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    allowedScopes: system.scopes,
    createdAt: 0,
  };
}

export function findClient(clientId: string): OidcClient | null {
  // 1. An explicitly registered client (incl. external RPs like lgu-hrms).
  const record = getClientRecord(clientId);
  if (record) return toClient(record);

  // 2. Fall back to a system-derived demo client: lgu-<slug>.
  if (!clientId.startsWith(CLIENT_ID_PREFIX)) return null;
  const system = getSystem(clientId.slice(CLIENT_ID_PREFIX.length));
  if (!system) return null;
  return toSystemClient(system);
}

export function listClients(): OidcClient[] {
  const out = listClientRecords().map(toClient);
  const seen = new Set(out.map((client) => client.clientId));

  // Demo tiles are derived from the full catalogue; registered clients shadow
  // their system-derived twin (e.g. lgu-hrms) so there are no duplicates.
  for (const system of listSystems()) {
    const id = clientIdFor(system);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(toSystemClient(system));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Admin client management                                              */
/* ------------------------------------------------------------------ */

export interface RegisterClientParams {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  systemSlug: string;
}

export async function registerClient(params: RegisterClientParams): Promise<OidcClient> {
  const record: Omit<ClientRecord, 'createdAt'> = {
    clientId: params.clientId,
    name: params.name,
    description: '',
    redirectUris: params.redirectUris,
    scopes: params.scopes,
    allowedRoles: [],
    systemSlug: params.systemSlug || null,
    clientSecret: null,
  };
  const persisted = registerClientInStore(record);
  return toClient(persisted);
}

export async function rotateClientSecret(clientId: string): Promise<string> {
  return rotateClientSecretInStore(clientId);
}

export async function deleteClient(clientId: string): Promise<void> {
  deleteClientRecord(clientId);
}

/* ------------------------------------------------------------------ */
/* Authorize request validation                                        */
/* ------------------------------------------------------------------ */

export type AuthorizeError =
  | 'invalid_request'
  | 'unauthorized_client'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'login_required'
  | 'server_error';

export type AuthorizeValidation =
  | { ok: true; client: OidcClient; redirectUri: string; scope: string; codeChallenge: string | null; nonce: string | null; state: string | null }
  | { ok: false; error: AuthorizeError; description: string; redirectUri: string | null };

/**
 * Validate an /authorize request.
 *
 * Per the OAuth 2.0 security BCP, an invalid `redirect_uri` must NOT be
 * redirected to — that would turn the endpoint into an open redirector. In that
 * case `redirectUri` is null and the caller must render an error page.
 */
export function validateAuthorizeRequest(params: URLSearchParams): AuthorizeValidation {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type') ?? '';
  const requestedScope = params.get('scope') ?? '';
  const codeChallenge = params.get('code_challenge');
  const codeChallengeMethod = params.get('code_challenge_method');
  const nonce = params.get('nonce');
  const state = params.get('state');

  const client = findClient(clientId);
  if (!client) {
    return { ok: false, error: 'unauthorized_client', description: `Unknown client: ${clientId}`, redirectUri: null };
  }

  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'redirect_uri does not exactly match a registered value.',
      redirectUri: null,
    };
  }

  // Everything past this point is safe to redirect back to the client.
  if (responseType !== 'code') {
    return { ok: false, error: 'unsupported_response_type', description: 'Only response_type=code is supported.', redirectUri };
  }

  if (codeChallenge) {
    // A public client MUST use PKCE with S256. Rejecting `plain` prevents the
    // downgrade where the verifier equals the challenge.
    if (codeChallengeMethod !== 'S256') {
      return { ok: false, error: 'invalid_request', description: 'PKCE requires code_challenge_method=S256.', redirectUri };
    }
    if (codeChallenge.length < 43 || codeChallenge.length > 128) {
      return { ok: false, error: 'invalid_request', description: 'code_challenge must be 43-128 characters.', redirectUri };
    }
  } else {
    // No PKCE from a public client is not acceptable.
    return {
      ok: false,
      error: 'invalid_request',
      description: 'This client is public and must use PKCE (code_challenge).',
      redirectUri,
    };
  }

  const scopes = requestedScope.split(/\s+/).filter(Boolean);
  if (scopes.length === 0) {
    return { ok: false, error: 'invalid_scope', description: 'At least the openid scope is required.', redirectUri };
  }
  for (const scope of scopes) {
    if (!BASE_SCOPES.has(scope) && !client.allowedScopes.includes(scope)) {
      return { ok: false, error: 'invalid_scope', description: `Scope not registered for this client: ${scope}`, redirectUri };
    }
  }

  return {
    ok: true,
    client,
    redirectUri,
    scope: scopes.join(' '),
    codeChallenge: codeChallenge ?? null,
    nonce,
    state,
  };
}

/* ------------------------------------------------------------------ */
/* Authorisation codes                                                 */
/* ------------------------------------------------------------------ */

export function issueAuthorizationCode(params: {
  client: OidcClient;
  userId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string | null;
  nonce: string | null;
}): AuthorizationCode {
  sweepCodes();
  const now = Date.now();
  const code: AuthorizationCode = {
    code: randomToken(32),
    clientId: params.client.clientId,
    userId: params.userId,
    redirectUri: params.redirectUri,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    nonce: params.nonce,
    issuedAt: now,
    expiresAt: now + AUTH_CODE_TTL_MS,
    consumedAt: null,
  };
  codes.set(code.code, code);
  return code;
}

export type CodeExchangeError = 'invalid_grant' | 'invalid_client' | 'invalid_request';

export type CodeExchange =
  | { ok: true; code: AuthorizationCode }
  | { ok: false; error: CodeExchangeError; description: string };

/**
 * Redeem an authorization code exactly once.
 *
 * Checks, in order: existence, expiry, single use, client binding, redirect_uri
 * binding, and PKCE. Every mismatch is `invalid_grant` on purpose — a distinct
 * error per failure would let an attacker probe which check failed.
 */
export function consumeAuthorizationCode(
  codeValue: string,
  params: { clientId: string; redirectUri: string; codeVerifier?: string | null },
): CodeExchange {
  const code = codes.get(codeValue);
  if (!code) return { ok: false, error: 'invalid_grant', description: 'Unknown authorization code.' };

  if (code.consumedAt !== null) {
    // Replay of a spent code: burn every code issued alongside it.
    invalidateCodesForUser(code.userId);
    return { ok: false, error: 'invalid_grant', description: 'Authorization code already redeemed.' };
  }

  const now = Date.now();
  if (now >= code.expiresAt) {
    codes.delete(codeValue);
    return { ok: false, error: 'invalid_grant', description: 'Authorization code has expired.' };
  }

  if (code.clientId !== params.clientId) {
    return { ok: false, error: 'invalid_grant', description: 'Authorization code was issued to a different client.' };
  }

  if (code.redirectUri !== params.redirectUri) {
    return { ok: false, error: 'invalid_grant', description: 'redirect_uri does not match the authorize request.' };
  }

  if (code.codeChallenge) {
    if (!params.codeVerifier) {
      return { ok: false, error: 'invalid_grant', description: 'code_verifier is required.' };
    }
    if (codeChallengeS256(params.codeVerifier) !== code.codeChallenge) {
      return { ok: false, error: 'invalid_grant', description: 'PKCE verification failed.' };
    }
  }

  code.consumedAt = now;
  codes.delete(codeValue);
  return { ok: true, code };
}

export function invalidateCodesForUser(userId: string): number {
  let removed = 0;
  for (const [value, code] of codes) {
    if (code.userId === userId) {
      codes.delete(value);
      removed++;
    }
  }
  return removed;
}

function sweepCodes(): void {
  const now = Date.now();
  for (const [value, code] of codes) {
    if (now >= code.expiresAt) codes.delete(value);
  }
  for (const [value, token] of refreshTokens) {
    if (now >= token.expiresAt) refreshTokens.delete(value);
  }
}

/* ------------------------------------------------------------------ */
/* Token issuance (RS256 against the provisioned key ring)            */
/* ------------------------------------------------------------------ */

export type TokenSubject = {
  userId: string;
  employeeId: string;
  email: string;
  displayName: string;
  department: string;
  title: string;
  roles: Role[];
  sessionId: string;
  mfaVerified: boolean;
};

export type TokenSet = {
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  access_token: string;
  id_token: string;
  refresh_token: string;
};

export async function issueTokens(
  client: OidcClient,
  code: AuthorizationCode,
  subject: TokenSubject,
): Promise<TokenSet> {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomToken(16);

  const base: JwtClaims = {
    iss: OIDC_ISSUER,
    sub: subject.userId,
    aud: client.clientId,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_S,
    jti,
    sid: subject.sessionId,
    email: subject.email,
    name: subject.displayName,
    roles: subject.roles,
    department: subject.department,
    employee_id: subject.employeeId,
  };

  // Access token carries what the resource server needs to make a decision.
  const accessToken = await signWithActiveKey(JSON.stringify({ ...base, scope: code.scope }));

  // ID token is for the client to learn who signed in. `auth_time` and `amr` are
  // only emitted when a second factor was actually satisfied, and `nonce` binds
  // the token to this authorize request.
  const idClaims: JwtClaims = {
    ...base,
    exp: now + ID_TOKEN_TTL_S,
    ...(code.nonce ? { nonce: code.nonce } : {}),
    ...(subject.mfaVerified ? { auth_time: code.issuedAt, amr: ['pwd', 'otp'] } : { amr: ['pwd'] }),
  };
  const idToken = await signWithActiveKey(JSON.stringify(idClaims));

  const refreshToken = randomToken(32);
  refreshTokens.set(sha256(refreshToken), {
    userId: subject.userId,
    clientId: client.clientId,
    scope: code.scope,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return {
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_S,
    scope: code.scope,
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
  };
}

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number; scope: string }
  | { ok: false; error: CodeExchangeError; description: string };

export async function refreshAccessToken(
  refreshTokenValue: string,
  clientId: string,
  subject: TokenSubject,
): Promise<RefreshResult> {
  const key = sha256(refreshTokenValue);
  const record = refreshTokens.get(key);
  if (!record) return { ok: false, error: 'invalid_grant', description: 'Unknown refresh token.' };
  if (Date.now() >= record.expiresAt) {
    refreshTokens.delete(key);
    return { ok: false, error: 'invalid_grant', description: 'Refresh token has expired.' };
  }
  if (record.clientId !== clientId) {
    return { ok: false, error: 'invalid_grant', description: 'Refresh token belongs to a different client.' };
  }

  // Rotate on every use: a replayed refresh token then fails loudly.
  refreshTokens.delete(key);
  const rotated = randomToken(32);
  refreshTokens.set(sha256(rotated), {
    userId: record.userId,
    clientId: record.clientId,
    scope: record.scope,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signWithActiveKey(
    JSON.stringify({
      iss: OIDC_ISSUER,
      sub: record.userId,
      aud: clientId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_S,
      jti: randomToken(16),
      sid: subject.sessionId,
      email: subject.email,
      name: subject.displayName,
      roles: subject.roles,
      department: subject.department,
      employee_id: subject.employeeId,
      scope: record.scope,
    }),
  );

  return { ok: true, accessToken, refreshToken: rotated, expiresIn: ACCESS_TOKEN_TTL_S, scope: record.scope };
}

export type TokenVerification =
  | { ok: true; claims: JwtClaims; header: JwtHeader }
  | { ok: false; error: string };

/** Verify a bearer access token for the audience `clientId`. */
export async function verifyAccessToken(
  token: string,
  clientId?: string,
): Promise<TokenVerification> {
  const result = await verifyIdToken(token, { issuer: OIDC_ISSUER, audience: clientId });
  // `verifyIdToken` returns a structurally compatible shape; normalise headers.
  if (!result.ok) return result;
  return { ok: true, claims: result.claims, header: result.header };
}

/* ------------------------------------------------------------------ */
/* Discovery                                                          */
/* ------------------------------------------------------------------ */

export function discoveryDocument() {
  return {
    issuer: OIDC_ISSUER,
    authorization_endpoint: `${OIDC_ISSUER}/api/oidc/authorize`,
    token_endpoint: `${OIDC_ISSUER}/api/oidc/token`,
    userinfo_endpoint: `${OIDC_ISSUER}/api/oidc/userinfo`,
    jwks_uri: `${OIDC_ISSUER}/api/oidc/jwks`,
    end_session_endpoint: `${OIDC_ISSUER}/api/oidc/logout`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    userinfo_signing_alg_values_supported: ['RS256'],
    scopes_supported: [...BASE_SCOPES],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat', 'jti', 'sid', 'email', 'name',
      'roles', 'department', 'employee_id', 'auth_time', 'amr', 'nonce',
    ],
  };
}

export const OIDC_POLICY = {
  authCodeTtlMs: AUTH_CODE_TTL_MS,
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_S,
  idTokenTtlSeconds: ID_TOKEN_TTL_S,
} as const;
