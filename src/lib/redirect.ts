/**
 * Redirect-target validation.
 *
 * One rule, applied everywhere: a redirect target must be a same-origin,
 * root-relative path. Anything that could resolve off-origin is rejected and
 * replaced with a safe default.
 *
 * The rejected shapes are the actual open-redirect vectors:
 *   //evil.example        protocol-relative — inherits the current scheme
 *   https://evil.example  absolute
 *   /\\evil.example       backslash is normalised to // by some browsers
 *   %2f%2fevil.example    percent-encoded form of the above
 *   /path\r\nLocation:    header injection
 */

const DEFAULT_TARGET = '/portal';

export function safeNextPath(candidate: string | null | undefined, fallback = DEFAULT_TARGET): string {
  if (!candidate) return fallback;

  const value = candidate.trim();
  if (!value) return fallback;

  // Must be root-relative.
  if (!value.startsWith('/')) return fallback;
  // Protocol-relative.
  if (value.startsWith('//')) return fallback;
  // Backslash and whitespace tricks.
  if (value.includes('\\')) return fallback;
  if (/[\r\n\t\0]/.test(value)) return fallback;
  // Percent-encoded separators.
  if (/%2f|%5c/i.test(value)) return fallback;
  // Any scheme-looking prefix that survived decoding.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return fallback;

  return value;
}
