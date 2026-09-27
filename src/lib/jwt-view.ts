/**
 * Display-only JWT decoding.
 *
 * This does NOT verify anything — `verifyJwt` in lib/auth/crypto.ts is the only
 * thing that establishes trust in a token. This exists purely to render a
 * readable claim dump on the launch page, and it is deliberately named so a
 * future reader cannot mistake it for verification.
 *
 * Returns null on anything malformed rather than throwing, because a token that
 * will not decode is a display problem, not a request failure.
 */

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
