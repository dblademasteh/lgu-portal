/**
 * Consent round-trip — preserving the authorize request across the consent screen.
 *
 * The authorize endpoint hands a request to /consent and gets it back when the
 * user approves or denies. An earlier version rebuilt the authorize URL from a
 * hand-picked subset of fields (client_id, scope, state, redirect_uri) and
 * silently dropped response_type, code_challenge, code_challenge_method and
 * nonce. Because validateAuthorizeRequest requires response_type=code, every
 * approval came back as error=unsupported_response_type and no user could ever
 * complete a first sign-in.
 *
 * The fix is to carry the original query verbatim rather than re-serialising
 * individual fields, so the set of parameters authorize depends on can grow
 * without anyone having to remember to thread each one through. Replaying a
 * client-supplied query is safe: the authorize endpoint re-validates the whole
 * request from scratch, including an exact match against the registered
 * redirect_uri, so a tampered replay can only produce a valid request or an
 * error.
 */

/** Marker appended to the replayed query to carry the user's decision. */
export const CONSENT_DECISION_PARAM = 'consent';

export type ConsentDecision = 'approved' | 'denied';

/**
 * Serialise an authorize request for transport to the consent screen.
 * Preserves every parameter, including repeats.
 */
export function serializeConsentRequest(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const [key, value] of params) {
    // The decision marker is set by the handlers, never carried across, so a
    // stale value from an earlier hop cannot be replayed.
    if (key === CONSENT_DECISION_PARAM) continue;
    out.append(key, value);
  }
  return out.toString();
}

/**
 * Replay an authorize request with the user's decision attached.
 * Returns the query string, never a URL — callers build the URL against their
 * own request origin so the flow stays same-origin.
 */
export function replayAuthorizeRequest(
  serialized: string,
  decision: ConsentDecision,
): string {
  const params = new URLSearchParams(serialized);
  params.set(CONSENT_DECISION_PARAM, decision);
  return params.toString();
}

/**
 * The parameters the authorize endpoint needs in order to issue a code.
 * Used to assert that a consent round-trip is lossless.
 */
export const REQUIRED_AUTHORIZE_PARAMS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'code_challenge',
  'code_challenge_method',
] as const;
