/**
 * RS256 signing key management.
 *
 * Generates and rotates RSA key pairs for OIDC token signing, and exports them
 * as a JWKS. This replaces a version that returned hardcoded placeholder PEM
 * strings with the literal text "demo-placeholder" in them, so "rotation"
 * produced a new fake key and the published JWKS contained
 * `n: "BASE64URL_ENCODED_MODULUS"`. Anything that actually verified a signature
 * would have failed against it.
 *
 * The keys here are real, and the JWKS is a valid JWK Set.
 *
 * SCOPE — read this before wiring this to the token endpoint:
 * Token minting still happens in `lib/oidc.ts` and is still HS256 against a
 * shared secret. This module is the provisioned RS256 keyring for that
 * migration, not the live signer. `lib/admin/keys` is the seam; flipping
 * `lib/oidc.ts` to call `signJwtRs256` is a separate, deliberate change, because
 * it changes the published `alg`, the JWKS contents, and the client
 * verification contract all at once.
 *
 * Durability is still in-process: a restart loses the keyring. Before this is
 * used to sign real tokens the keys must move to a KMS/HSM or be loaded from
 * mounted secrets, or every restart invalidates every outstanding token.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'crypto';
import { randomToken, type JwtClaims } from '@/lib/auth/crypto';

export type JwtHeader = { alg: string; typ: string; kid?: string };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface SigningKey {
  kid: string;
  alg: 'RS256';
  use: 'sig';
  publicKeyPem: string;
  /** Never sent to a client. Guarded by `toPublicView()` for display. */
  privateKeyPem: string;
  createdAt: number;
  expiresAt: number | null;
  active: boolean;
}

/** The subset safe to render in the admin UI or log. */
export type PublicSigningKey = Omit<SigningKey, 'privateKeyPem'>;

const KEYS = Symbol('signingKeys');
type KeyRegistry = {
  [KEYS]?: SigningKey[];
  initialized?: boolean;
};

// Survives dev-server module reloads so HMR does not rotate the keyring.
const globalForKeys = globalThis as unknown as KeyRegistry;
if (!globalForKeys[KEYS]) globalForKeys[KEYS] = [];
if (globalForKeys.initialized === undefined) globalForKeys.initialized = false;

const keys = globalForKeys[KEYS]!;

/** Retired keys stay published this long so tokens signed with them still verify. */
const RETIREMENT_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_KEYS = 5; // 1 active + 4 retired
const MODULUS_LENGTH = 2048;

/* ------------------------------------------------------------------ */
/* Key generation                                                      */
/* ------------------------------------------------------------------ */

function generateRsaKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: MODULUS_LENGTH,
    publicExponent: 0x10001, // 65537
  });
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

async function initializeKeys(): Promise<void> {
  if (globalForKeys.initialized) return;
  globalForKeys.initialized = true;
  if (keys.length === 0) await rotateSigningKeys();
}

/** Promote a new active key; the previous one is retired but still published. */
export async function rotateSigningKeys(): Promise<PublicSigningKey> {
  const now = Date.now();
  for (const key of keys) {
    if (key.active) {
      key.active = false;
      // Kept published during the grace window so existing tokens still verify.
      key.expiresAt = now + RETIREMENT_GRACE_MS;
    }
  }

  const { publicKeyPem, privateKeyPem } = generateRsaKeyPair();
  const key: SigningKey = {
    kid: `key_${now.toString(36)}_${randomToken(8)}`,
    alg: 'RS256',
    use: 'sig',
    publicKeyPem,
    privateKeyPem,
    createdAt: now,
    expiresAt: null,
    active: true,
  };

  keys.unshift(key);
  if (keys.length > MAX_KEYS) keys.length = MAX_KEYS;

  return toPublicView(key);
}

/**
 * Revoke a key immediately. Refuses to revoke the only active key, which would
 * leave the portal unable to sign at all.
 */
export async function revokeKey(kid: string): Promise<boolean> {
  await initializeKeys();
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) return false;

  const activeCount = keys.filter((candidate) => candidate.active).length;
  if (key.active && activeCount <= 1) return false;

  key.active = false;
  // Already in the past, so the next JWKS build drops it.
  key.expiresAt = Date.now();
  return true;
}

export async function getSigningKeys(): Promise<PublicSigningKey[]> {
  await initializeKeys();
  return keys.map(toPublicView).sort((a, b) => b.createdAt - a.createdAt);
}

async function getActiveKey(): Promise<SigningKey> {
  await initializeKeys();
  const active = keys.find((key) => key.active);
  if (!active) throw new Error('No active signing key; rotate the keyring first.');
  return active;
}

function toPublicView(key: SigningKey): PublicSigningKey {
  const { privateKeyPem: _privateKeyPem, ...rest } = key;
  return rest;
}

/* ------------------------------------------------------------------ */
/* JWKS export                                                         */
/* ------------------------------------------------------------------ */

/** Strip PEM armour and base64url-encode, per RFC 7515. */
function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export type Jwk = {
  kty: 'RSA';
  kid: string;
  use: 'sig';
  alg: 'RS256';
  n: string;
  e: string;
};

export type JwkSet = { keys: Jwk[] };

/**
 * A valid JWK Set. Expired keys are omitted, so a revoked key stops being
 * advertised on the next publish and clients stop trusting new tokens from it.
 *
 * `n` and `e` are the real modulus and exponent lifted out of the SPKI key, so
 * a standard JWT verifier can check a signature against these.
 */
export async function exportJwks(): Promise<JwkSet> {
  await initializeKeys();
  const now = Date.now();
  const published: Jwk[] = [];

  for (const key of keys) {
    if (key.expiresAt !== null && key.expiresAt <= now) continue;

    // A SPKI PEM is `-----BEGIN PUBLIC KEY-----<base64 DER>-----END PUBLIC KEY-----`.
    // The DER is a SEQUENCE wrapping the RSAPublicKey SEQUENCE, so the modulus
    // and exponent are the last two INTEGERs in the structure.
    const der = Buffer.from(
      key.publicKeyPem
        .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
        .replace(/\s+/g, ''),
      'base64',
    );
    const jwk = publicKeyToJwk(key.kid, der);
    if (jwk) published.push(jwk);
  }

  return { keys: published };
}

/** Extract `n` and `e` from a DER-encoded RSAPublicKey. */
function publicKeyToJwk(kid: string, der: Buffer): Jwk | null {
  let offset = 0;

  const readLength = (): number => {
    const first = der[offset++];
    if (first === undefined) throw new Error('truncated DER');
    if (first < 0x80) return first;
    const byteCount = first & 0x7f;
    let length = 0;
    for (let i = 0; i < byteCount; i++) {
      const byte = der[offset++];
      if (byte === undefined) throw new Error('truncated DER');
      length = length * 256 + byte;
    }
    return length;
  };

  const expectTag = (tag: number): number => {
    const actual = der[offset++];
    if (actual !== tag) throw new Error(`expected DER tag 0x${tag.toString(16)}`);
    return readLength();
  };

  try {
    // SEQUENCE { SEQUENCE { OID, NULL }, BIT STRING { SEQUENCE { n, e } } }
    expectTag(0x30); // outer SEQUENCE
    expectTag(0x30); // AlgorithmIdentifier
    // Read the length into a local first. `offset += expectTag(...)` captures
    // `offset`'s pre-call value and silently drops the tag and length bytes.
    const oidLength = expectTag(0x06); // OID
    offset += oidLength;
    expectTag(0x05); // NULL, length always 0

    const bitStringLength = expectTag(0x03); // BIT STRING
    offset += 1; // unused-bits byte

    expectTag(0x30); // RSAPublicKey SEQUENCE
    const modulusLength = expectTag(0x02); // INTEGER n
    const modulus = der.subarray(offset, offset + modulusLength);
    offset += modulusLength;

    const exponentLength = expectTag(0x02); // INTEGER e
    const exponent = der.subarray(offset, offset + exponentLength);

    // DER INTEGERs are signed, so a leading 0x00 pad byte is not part of the value.
    const stripPad = (value: Buffer): Buffer =>
      value.length > 1 && value[0] === 0x00 ? value.subarray(1) : value;

    void bitStringLength;
    return {
      kty: 'RSA',
      kid,
      use: 'sig',
      alg: 'RS256',
      n: toBase64Url(stripPad(modulus)),
      e: toBase64Url(stripPad(exponent)),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Signing                                                             */
/* ------------------------------------------------------------------ */

/** Sign a compact JWS with RS256 (RSASSA-PKCS1-v1_5 + SHA-256). */
export async function signRs256(input: string, kid: string): Promise<string> {
  await initializeKeys();
  const key = keys.find((candidate) => candidate.kid === kid && candidate.active);
  if (!key) throw new Error(`No active signing key with kid ${kid}`);

  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const claims = toBase64Url(input);
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput), createPrivateKey(key.privateKeyPem));
  return `${signingInput}.${toBase64Url(signature)}`;
}

export async function signWithActiveKey(payload: string): Promise<string> {
  const key = await getActiveKey();
  return signRs256(payload, key.kid);
}

/**
 * Verify an RS256 signature against the current keyring. Used by the tests and
 * available to any future resource server that trusts this portal's JWKS.
 */
export async function verifyRs256(token: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, claims, signature] = parts as [string, string, string];

  let kid: string;
  try {
    kid = (JSON.parse(Buffer.from(header, 'base64url').toString()) as { kid?: string }).kid ?? '';
  } catch {
    return false;
  }

  const key = keys.find((candidate) => candidate.kid === kid);
  // An expired key is no longer published, so it must not verify either.
  if (!key || (key.expiresAt !== null && key.expiresAt <= Date.now())) return false;

  const { verify } = await import('node:crypto');
  return verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    createPublicKey(key.publicKeyPem),
    Buffer.from(signature, 'base64url'),
  );
}

/* ------------------------------------------------------------------ */
/* Verification (for resource servers / userinfo)                      */
/* ------------------------------------------------------------------ */

/**
 * Verify an RS256 token end-to-end: signature (looked up by `kid`, expiry-aware)
 * then issuer, audience, expiry and issued-at. Returns decoded claims on success.
 * Resource servers verify with the public JWKS; only the authorisation server
 * holds signing material.
 */
export async function verifyIdToken(
  token: string,
  options: { issuer?: string; audience?: string; now?: number },
): Promise<
  | { ok: true; claims: JwtClaims; header: JwtHeader }
  | { ok: false; error: string }
> {
  await initializeKeys();

  if (!(await verifyRs256(token))) {
    return { ok: false, error: 'bad signature' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed token' };

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as JwtHeader;
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as JwtClaims;
  } catch {
    return { ok: false, error: 'undecodable token' };
  }

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

  const LEEWAY = 30;
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < now) {
    return { ok: false, error: 'expired' };
  }
  if (typeof claims.iat === 'number' && claims.iat - LEEWAY > now) {
    return { ok: false, error: 'issued in the future' };
  }

  return { ok: true, claims, header };
}
