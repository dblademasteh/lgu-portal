import { describe, it, expect } from 'vitest';
import {
  serializeConsentRequest,
  replayAuthorizeRequest,
  REQUIRED_AUTHORIZE_PARAMS,
} from './consent-replay';

/**
 * Regression guard for the consent round-trip.
 *
 * The approve/deny handlers used to rebuild the authorize URL from four
 * hand-copied fields, which dropped response_type, code_challenge,
 * code_challenge_method and nonce. validateAuthorizeRequest requires
 * response_type=code, so every real first sign-in failed at the consent screen
 * while the smoke suite stayed green — it had been re-requesting the original
 * launch URL with consent=approved appended, never driving the form.
 *
 * These tests assert the round-trip is lossless for every parameter authorize
 * depends on, so the set can grow without anyone having to remember to thread
 * each one through by hand.
 */
describe('consent round-trip', () => {
  const authorizeQuery = new URLSearchParams({
    client_id: 'lgu-hris',
    redirect_uri: 'http://localhost:3000/api/oidc/callback',
    response_type: 'code',
    scope: 'openid profile email roles profile:read',
    code_challenge: 'abcdefghijklmnopqrstuvwxyz1234567890abcdefgh',
    code_challenge_method: 'S256',
    state: 'st-abc123',
    nonce: 'no-xyz789',
  });

  it('preserves every parameter authorize needs', () => {
    const replayed = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(authorizeQuery),
      'approved',
    ));

    for (const param of REQUIRED_AUTHORIZE_PARAMS) {
      expect(replayed.get(param), `${param} was dropped by the consent round-trip`)
        .toBe(authorizeQuery.get(param));
    }
  });

  it('preserves the state and nonce used to bind the response', () => {
    const replayed = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(authorizeQuery),
      'approved',
    ));

    expect(replayed.get('state')).toBe('st-abc123');
    expect(replayed.get('nonce')).toBe('no-xyz789');
  });

  it('survives a full round-trip without mutating the input', () => {
    const before = authorizeQuery.toString();
    serializeConsentRequest(authorizeQuery);
    replayAuthorizeRequest(serializeConsentRequest(authorizeQuery), 'approved');
    expect(authorizeQuery.toString()).toBe(before);
  });

  it('carries the decision through', () => {
    const approved = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(authorizeQuery), 'approved',
    ));
    const denied = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(authorizeQuery), 'denied',
    ));

    expect(approved.get('consent')).toBe('approved');
    expect(denied.get('consent')).toBe('denied');
  });

  it('strips a stale decision so it cannot be replayed across hops', () => {
    // An attacker-supplied consent=approved must not ride along on the
    // transport hop; the handlers set the decision themselves.
    const tampered = new URLSearchParams(authorizeQuery);
    tampered.set('consent', 'approved');

    const transported = serializeConsentRequest(tampered);
    expect(new URLSearchParams(transported).has('consent')).toBe(false);
  });

  it('preserves repeated parameters', () => {
    const withRepeats = new URLSearchParams(authorizeQuery);
    withRepeats.append('resource', 'urn:a');
    withRepeats.append('resource', 'urn:b');

    const replayed = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(withRepeats), 'approved',
    ));

    expect(replayed.getAll('resource')).toEqual(['urn:a', 'urn:b']);
  });

  it('preserves scope values that contain characters needing encoding', () => {
    const spaced = new URLSearchParams(authorizeQuery);
    spaced.set('scope', 'openid profile:read leave:write');

    const replayed = new URLSearchParams(replayAuthorizeRequest(
      serializeConsentRequest(spaced), 'approved',
    ));

    expect(replayed.get('scope')).toBe('openid profile:read leave:write');
  });
});
