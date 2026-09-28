/**
 * SSO logout propagation.
 *
 * When a user logs out of the portal, we want downstream systems to know so
 * they can end their sessions too. This module provides:
 *
 * 1. `LogoutToken` — a JWT that says "this session is terminated". Downstream
 *    systems validate it and destroy the matching session.
 * 2. `backchannelLogout` — a POST endpoint downstream systems call to receive
 *    a logout token.
 * 3. `propagateLogout` — fire-and-forget calls to registered downstream logout
 *    URLs with the logout token.
 *
 * The portal does not maintain a list of active downstream sessions, so it
 * cannot push to them directly. Instead, it issues a signed logout token that
 * any system can validate and act on. This is the OpenID Connect back-channel
 * logout pattern (RFC 7009).
 */

import { randomToken } from '@/lib/auth/crypto';
import { signWithActiveKey, verifyIdToken, type JwtHeader } from '@/lib/admin/keys';
import { OIDC_ISSUER } from '@/lib/oidc';
import { record } from '@/lib/auth/audit';

export type LogoutToken = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  jti: string;
  events: { 'http://schemas.openid.net/event/backchannel-logout'?: Record<string, never> };
  sid?: string;
};

const LOGOUT_TOKEN_TTL_S = 60;

/**
 * Issue a logout token for a session.
 *
 * The token is signed with the active RS256 key and contains the session ID
 * so downstream systems can match it to their local session.
 */
export async function issueLogoutToken(params: {
  userId: string;
  sessionId: string;
  clientId?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomToken(16);

  const payload: LogoutToken = {
    iss: OIDC_ISSUER,
    sub: params.userId,
    aud: params.clientId ?? OIDC_ISSUER,
    iat: now,
    jti,
    events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    ...(params.sessionId ? { sid: params.sessionId } : {}),
  };

  return signWithActiveKey(JSON.stringify(payload));
}

/**
 * Validate a logout token received from the portal.
 *
 * Downstream systems use this to verify the token before destroying the
 * matching session.
 */
export async function validateLogoutToken(token: string): Promise<{ ok: boolean; claims?: LogoutToken; error?: string }> {
  try {
    const result = await verifyIdToken(token, {
      issuer: OIDC_ISSUER,
      audience: OIDC_ISSUER,
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const claims = result.claims as LogoutToken;
    if (!claims.events || !claims.events['http://schemas.openid.net/event/backchannel-logout']) {
      return { ok: false, error: 'not a logout token' };
    }

    return { ok: true, claims };
  } catch {
    return { ok: false, error: 'invalid token' };
  }
}

/**
 * Propagate logout to downstream systems.
 *
 * Sends a POST request with the logout token to each registered downstream
 * system's backchannel logout URL. Failures are logged but do not block the
 * portal's sign-out.
 */
export async function propagateLogout(params: {
  userId: string;
  sessionId: string;
  clientId?: string;
  downstreamUrls?: string[];
}): Promise<void> {
  const token = await issueLogoutToken({
    userId: params.userId,
    sessionId: params.sessionId,
    clientId: params.clientId,
  });

  const urls = params.downstreamUrls ?? [];

  for (const url of urls) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ logout_token: token }),
      });
    } catch (error) {
      console.error(`[logout] failed to propagate to ${url}:`, error);
    }
  }

  record('auth.logout', 'success', {
    actorId: params.userId,
    sessionId: params.sessionId,
    detail: `propagated to ${urls.length} downstream systems`,
  });
}
