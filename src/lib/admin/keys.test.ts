import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';

/**
 * Regression guard for the multi-replica signing key problem.
 *
 * The keyring lived in a process-global array and was generated at boot, so
 * every pod held a different key. `GET /api/oidc/jwks` publishes whichever
 * replica answers it, and a client that cached the set would be handed a `kid`
 * it had never seen and reject valid tokens. These tests simulate two replicas
 * by loading the module twice in isolation with the same provisioned PEM.
 */

const pem = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 }).privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

/** Import a fresh copy of the module, standing in for a separate replica. */
const loadReplica = async (signingKeyPem: string | undefined) => {
  if (signingKeyPem === undefined) {
    delete process.env.OIDC_SIGNING_PRIVATE_KEY;
  } else {
    process.env.OIDC_SIGNING_PRIVATE_KEY = signingKeyPem;
  }
  vi.resetModules();
  // No global cleanup needed: the keyring cache is symbol-scoped, so a fresh
  // module instance gets its own array and its own init flag and behaves like a
  // cold process.
  return import('./keys');
};

describe('signing keyring across replicas', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OIDC_SIGNING_PRIVATE_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OIDC_SIGNING_PRIVATE_KEY;
    else process.env.OIDC_SIGNING_PRIVATE_KEY = savedKey;
  });

  it('gives every replica the same kid and public key when provisioned', async () => {
    const key = pem();
    const a = await loadReplica(key);
    const b = await loadReplica(key);

    const jwksA = await a.exportJwks();
    const jwksB = await b.exportJwks();

    expect(jwksA.keys).toHaveLength(1);
    expect(jwksB.keys).toHaveLength(1);
    expect(jwksA.keys[0]!.kid).toBe(jwksB.keys[0]!.kid);
    expect(jwksA.keys[0]!.n).toBe(jwksB.keys[0]!.n);
    expect(jwksA.keys[0]!.e).toBe(jwksB.keys[0]!.e);
  });

  it('lets a token signed by one replica verify against the other replica JWKS', async () => {
    const key = pem();
    const a = await loadReplica(key);
    const b = await loadReplica(key);

    const jwksB = await b.exportJwks();
    const published = jwksB.keys[0]!;
    const token = await a.signRs256(
      JSON.stringify({ sub: 'usr-1', exp: Math.floor(Date.now() / 1000) + 60 }),
      published.kid,
    );

    // The header carries the kid the other replica published, and the modulus
    // in that JWKS verifies the signature — the exact check a relying party
    // makes after caching the key set.
    expect(decodeKid(token)).toBe(published.kid);
    expect(verifySignature(token, published.n, published.e)).toBe(true);
  });

  it('accepts an escaped \\n PEM, since a secretKeyRef cannot carry real newlines', async () => {
    const key = pem();
    const a = await loadReplica(key.replace(/\n/g, '\\n'));

    const jwks = await a.exportJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]!.n.length).toBeGreaterThan(100);
  });

  it('reports whether the key is provisioned', async () => {
    expect((await loadReplica(pem())).isSigningKeyProvisioned()).toBe(true);
    expect((await loadReplica(undefined)).isSigningKeyProvisioned()).toBe(false);
  });

  it('refuses in-process rotation of a provisioned keyring', async () => {
    const mod = await loadReplica(pem());
    await expect(mod.rotateSigningKeys()).rejects.toThrow(/provisioned/i);
  });

  it('still allows rotation when the key is generated', async () => {
    const mod = await loadReplica(undefined);
    const first = (await mod.exportJwks()).keys[0]!.kid;
    const rotated = await mod.rotateSigningKeys();
    expect(rotated.kid).not.toBe(first);
  });

  it('gives unprovisioned replicas different keys, which is why it must be set', async () => {
    const a = await loadReplica(undefined);
    const b = await loadReplica(undefined);
    const kidA = (await a.exportJwks()).keys[0]!.kid;
    const kidB = (await b.exportJwks()).keys[0]!.kid;
    expect(kidA).not.toBe(kidB);
  });

  it('fails loudly on a malformed provisioned key instead of silently generating', async () => {
    const mod = await loadReplica('-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----');
    await expect(mod.exportJwks()).rejects.toThrow(/OIDC_SIGNING_PRIVATE_KEY/);
  });
});

/* ---- helpers ---- */

function decodeKid(jwt: string): string {
  const header = JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString()) as { kid: string };
  return header.kid;
}

function verifySignature(jwt: string, n: string, e: string): boolean {
  const [h, p, s] = jwt.split('.');
  const pub = createPublicKey({
    key: { kty: 'RSA', n, e },
    format: 'jwk',
  });
  return verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    pub,
    Buffer.from(s!, 'base64url'),
  );
}
