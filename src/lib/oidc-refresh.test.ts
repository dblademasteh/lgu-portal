import { describe, it, expect, beforeEach } from 'vitest';
import { issueTokens, refreshAccessToken } from './oidc';
import type { OidcClient, AuthorizationCode, TokenSubject } from './oidc';
import type { Role } from './auth/users';

/**
 * Regression guard for refresh-token identity binding.
 *
 * The refresh grant checked that the record existed, was unexpired, and belonged
 * to the client — but never that it belonged to the *user* holding the session.
 * The minted token then took `sub` from the refresh-token record while taking
 * `roles`, `email`, `department` and `employee_id` from the live session, so a
 * token redeemed with someone else's refresh token carried that other person's
 * privileges under a valid RS256 signature. A downstream system authorising on
 * `sub` would treat the caller as the refresh token's owner.
 */
const client: OidcClient = {
  clientId: 'lgu-hris',
  clientSecret: '',
  system: null,
  allowedRoles: [],
  redirectUris: ['http://localhost:3000/api/oidc/callback'],
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
  tokenEndpointAuthMethod: 'none',
  allowedScopes: ['openid', 'profile', 'email', 'roles'],
  createdAt: 0,
};

function code(): AuthorizationCode {
  return {
    code: 'code-abc',
    clientId: client.clientId,
    userId: 'usr-victim',
    redirectUri: 'http://localhost:3000/api/oidc/callback',
    scope: 'openid profile email roles',
    codeChallenge: null,
    nonce: null,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    consumedAt: null,
  };
}

function subject(userId: string, roles: Role[], employeeId: string): TokenSubject {
  return {
    userId,
    employeeId,
    email: `${userId}@lgu.gov.ph`,
    displayName: 'Test Subject',
    department: 'Test Department',
    title: 'Tester',
    roles,
    sessionId: `sess-${userId}`,
    mfaVerified: false,
  };
}

describe('refreshAccessToken', () => {
  beforeEach(() => {
    // Each test needs a distinct victim refresh token; the store is module
    // scoped and there is no public reset.
  });

  it('rejects a refresh token redeemed by a different user', async () => {
    const issued = await issueTokens(client, code(), subject('usr-victim', ['admin'], 'LGU-0001'));

    const result = await refreshAccessToken(
      issued.refresh_token,
      client.clientId,
      subject('usr-attacker', ['employee'], 'LGU-0002'),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_grant');
      expect(result.description).toMatch(/different user/i);
    }
  });

  it('does not mint a token carrying the session user roles for another sub', async () => {
    const issued = await issueTokens(client, code(), subject('usr-victim-2', ['admin'], 'LGU-0003'));

    const result = await refreshAccessToken(
      issued.refresh_token,
      client.clientId,
      subject('usr-attacker-2', ['employee'], 'LGU-0004'),
    );

    // The failure mode being guarded against is a *successful* response whose
    // claims mix two identities, so assert no token is produced at all.
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('accessToken');
  });

  it('allows the owning user to refresh', async () => {
    const issued = await issueTokens(client, code(), subject('usr-owner', ['employee'], 'LGU-0005'));

    const result = await refreshAccessToken(
      issued.refresh_token,
      client.clientId,
      subject('usr-owner', ['employee'], 'LGU-0005'),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.refreshToken).toBeTruthy();
      expect(result.refreshToken).not.toBe(issued.refresh_token);
    }
  });

  it('rejects a refresh token presented to a different client', async () => {
    const issued = await issueTokens(client, code(), subject('usr-owner-2', ['employee'], 'LGU-0006'));

    const result = await refreshAccessToken(
      issued.refresh_token,
      'lgu-gis',
      subject('usr-owner-2', ['employee'], 'LGU-0006'),
    );

    expect(result.ok).toBe(false);
  });

  it('rotates the refresh token so the old one is spent', async () => {
    const issued = await issueTokens(client, code(), subject('usr-owner-3', ['employee'], 'LGU-0007'));
    const owner = subject('usr-owner-3', ['employee'], 'LGU-0007');

    const first = await refreshAccessToken(issued.refresh_token, client.clientId, owner);
    expect(first.ok).toBe(true);

    const replay = await refreshAccessToken(issued.refresh_token, client.clientId, owner);
    expect(replay.ok).toBe(false);
  });
});
