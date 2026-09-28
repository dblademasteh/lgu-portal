/**
 * Cryptographic primitives for the SSO stub.
 *
 * Everything here uses Node's built-in `node:crypto` — the auth layer has zero
 * third-party dependencies, which keeps the trust surface of a security-critical
 * path as small as possible.
 *
 * Notes on parameter choices:
 *  - scrypt N=2^15 costs ~100ms and 32MB per verification. That is the correct
 *    order of magnitude for an interactive login. Raise N as hardware improves.
 *  - Tokens and sessions are 256-bit random values from `randomBytes`, never
 *    derived from a counter or timestamp.
 *  - All signatures are compared with `timingSafeEqual` behind a length check,
 *    so a length mismatch cannot be used as an oracle.
 */

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 64;
const SALT_LEN = 16;

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

/** base64url without padding — safe in cookies, headers and query strings. */
export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Constant-time comparison of two strings, safe across length differences. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

export type PasswordHash = string;

/** Hash a password into a self-describing `scrypt$N$r$p$salt$hash` string. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    base64url(salt),
    base64url(derived),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false (never throws) for malformed hashes so a corrupt record cannot
 * be distinguished from a wrong password by the caller.
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expected = Buffer.from(parts[5]!, 'base64url');

    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT.maxmem,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Random tokens                                                       */
/* ------------------------------------------------------------------ */

/** 256 bits of entropy, base64url encoded. Used for session and code ids. */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/**
 * A numeric code of exactly `digits` digits, each uniformly distributed.
 *
 * Built one digit at a time from a rejection-sampled byte. The shorter-looking
 * alternative — read a uint32, reject anything past the largest multiple of
 * 10^digits, then take the remainder — is an unbounded loop the moment
 * `digits` exceeds 9, because 10^digits stops fitting in 32 bits, the
 * rejection limit collapses to 0, and every value is "above" it. Since 10^10
 * already exceeds 2^32, any caller asking for a long numeric id hung the
 * process instead of returning.
 *
 * One byte per digit has no such cliff: 250 is a fixed bound that is always
 * reachable, so the loop always terminates, and it discards at most 6 bytes per
 * digit. Leading zeros are preserved, so a code is always `digits` long.
 */
export function randomNumericCode(digits = 6): string {
  if (!Number.isInteger(digits) || digits < 1) {
    throw new RangeError(`randomNumericCode: digits must be a positive integer, got ${digits}`);
  }

  let code = '';
  for (let i = 0; i < digits; i += 1) {
    // 250 is the largest multiple of 10 that fits in a byte. Discarding
    // 250-255 leaves 250 values that map onto 0-9 with no bias.
    let byte = randomBytes(1).readUInt8(0);
    while (byte >= 250) byte = randomBytes(1).readUInt8(0);
    code += String(byte % 10);
  }
  return code;
}

/* ------------------------------------------------------------------ */
/* HMAC signing (cookies)                                               */
/* ------------------------------------------------------------------ */

export function hmac(value: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(value).digest());
}

/** Verify a `value.signature` pair in constant time. */
export function verifySigned(value: string, signature: string, secret: string): boolean {
  return safeEqual(hmac(value, secret), signature);
}

/* ------------------------------------------------------------------ */
/* Digests and PKCE                                                    */
/* ------------------------------------------------------------------ */

/** SHA-256 digest, base64url encoded. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** S256 code challenge for PKCE: BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return sha256(verifier);
}

/* ------------------------------------------------------------------ */
/* JWT (HS256) — signed, NOT encrypted                                 */
/* ------------------------------------------------------------------ */

export type JwtHeader = { alg: 'HS256'; typ: 'JWT' };
export type JwtClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  jti: string;
  scope?: string;
  sid?: string;
  email?: string;
  name?: string;
  roles?: string[];
  department?: string;
  employee_id?: string;
  events?: Record<string, unknown>;
};

export function signJwt(claims: JwtClaims, secret: string): string {
  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(claims));
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export type JwtVerification =
  | { ok: true; claims: JwtClaims; header: JwtHeader }
  | { ok: false; error: string };

/**
 * Verify signature, algorithm, issuer, audience and expiry.
 *
 * Callers must treat the `aud` check as required — accepting a token minted for
 * a different client is a classic confused-deputy bug.
 */
export function verifyJwt(
  token: string,
  secret: string,
  options: { issuer?: string; audience?: string; now?: number },
): JwtVerification {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed token' };

  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  if (!verifySigned(`${encodedHeader}.${encodedPayload}`, signature, secret)) {
    return { ok: false, error: 'bad signature' };
  }

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'undecodable token' };
  }

  // Pin the algorithm. "alg: none" and RS/HS substitution are the classic JWT
  // forgeries; refusing anything but HS256 removes the whole class.
  if (header.alg !== 'HS256') return { ok: false, error: `unsupported alg ${header.alg}` };

  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (options.issuer && claims.iss !== options.issuer) {
    return { ok: false, error: 'issuer mismatch' };
  }

  if (options.audience) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(options.audience)) {
      return { ok: false, error: 'audience mismatch' };
    }
  }

  // Allow a small clock skew, but never accept an already-expired token.
  const LEEWAY = 30;
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < now) {
    return { ok: false, error: 'expired' };
  }
  if (typeof claims.iat === 'number' && claims.iat - LEEWAY > now) {
    return { ok: false, error: 'issued in the future' };
  }

  return { ok: true, claims, header };
}
