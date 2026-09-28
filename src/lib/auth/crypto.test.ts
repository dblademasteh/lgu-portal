import { describe, it, expect } from 'vitest';
import {
  safeEqual,
  hashPassword,
  verifyPassword,
  randomToken,
  randomNumericCode,
  hmac,
  verifySigned,
  sha256,
  codeChallengeS256,
  signJwt,
  verifyJwt,
} from './crypto';

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(safeEqual('a', 'ab')).toBe(false);
    expect(safeEqual('ab', 'a')).toBe(false);
  });

  it('returns false for empty strings when one is non-empty', () => {
    expect(safeEqual('', 'a')).toBe(false);
  });
});

describe('hashPassword and verifyPassword', () => {
  it('produces a scrypt$ prefixed hash', async () => {
    const hash = await hashPassword('password123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    const parts = hash.split('$');
    expect(parts.length).toBe(6);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('returns false for malformed hashes', async () => {
    expect(await verifyPassword('pw', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('pw', 'scrypt$bad')).toBe(false);
    expect(await verifyPassword('pw', '')).toBe(false);
  });

  it('produces different hashes for the same password (different salts)', async () => {
    const a = await hashPassword('same-pw');
    const b = await hashPassword('same-pw');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-pw', a)).toBe(true);
    expect(await verifyPassword('same-pw', b)).toBe(true);
  });
});

describe('randomToken', () => {
  it('returns a base64url string', () => {
    const token = randomToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('returns different tokens on each call', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('randomNumericCode', () => {
  it('returns exactly 6 digits by default', () => {
    const code = randomNumericCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('respects custom digit count', () => {
    expect(randomNumericCode(4)).toMatch(/^\d{4}$/);
    expect(randomNumericCode(1)).toMatch(/^\d{1}$/);
  });

  it('throws for invalid digit counts', () => {
    expect(() => randomNumericCode(0)).toThrow();
    expect(() => randomNumericCode(-1)).toThrow();
    expect(() => randomNumericCode(1.5)).toThrow();
  });
});

describe('hmac and verifySigned', () => {
  const secret = 'test-secret';
  const value = 'some-value';

  it('produces a base64url signature', () => {
    const sig = hmac(value, secret);
    expect(sig).not.toContain('+');
    expect(sig).not.toContain('/');
    expect(sig).not.toContain('=');
  });

  it('verifies a valid signature', () => {
    const sig = hmac(value, secret);
    expect(verifySigned(value, sig, secret)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const sig = hmac(value, secret);
    expect(verifySigned(value, sig + 'x', secret)).toBe(false);
  });

  it('rejects a signature from a different secret', () => {
    const sig = hmac(value, secret);
    expect(verifySigned(value, sig, 'other-secret')).toBe(false);
  });
});

describe('sha256 and codeChallengeS256', () => {
  it('sha256 returns base64url without padding', () => {
    const digest = sha256('hello');
    expect(digest).not.toMatch(/[+/=]/);
  });

  it('is deterministic', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('codeChallengeS256 is SHA256 of the verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = sha256(verifier);
    expect(codeChallengeS256(verifier)).toBe(expected);
  });
});

describe('signJwt and verifyJwt', () => {
  const secret = 'jwt-secret';

  it('signs and verifies a valid token', () => {
    const token = signJwt(
      {
        iss: 'https://sso.local',
        sub: 'user-1',
        aud: 'lgu-hris',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        jti: 'jti-1',
        email: 'user@example.com',
        roles: ['admin'],
      },
      secret,
    );

    const result = verifyJwt(token, secret, { issuer: 'https://sso.local', audience: 'lgu-hris' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe('user-1');
      expect(result.claims.roles).toEqual(['admin']);
    }
  });

  it('rejects a token with bad signature', () => {
    const token = signJwt(
      { iss: 'https://sso.local', sub: 'u', aud: 'c', exp: 9999999999, iat: 1, jti: '1' },
      secret,
    );
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}x`;
    const result = verifyJwt(tampered, secret, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('bad signature');
    }
  });

  it('rejects an expired token', () => {
    const token = signJwt(
      { iss: 'https://sso.local', sub: 'u', aud: 'c', exp: 1, iat: 1, jti: '1' },
      secret,
    );
    const result = verifyJwt(token, secret, {});
    expect(result.ok).toBe(false);
  });

  it('rejects a token with wrong issuer', () => {
    const token = signJwt(
      { iss: 'https://other.local', sub: 'u', aud: 'c', exp: 9999999999, iat: 1, jti: '1' },
      secret,
    );
    const result = verifyJwt(token, secret, { issuer: 'https://sso.local' });
    expect(result.ok).toBe(false);
  });

  it('rejects a token with wrong audience', () => {
    const token = signJwt(
      { iss: 'https://sso.local', sub: 'u', aud: 'c', exp: 9999999999, iat: 1, jti: '1' },
      secret,
    );
    const result = verifyJwt(token, secret, { audience: 'wrong' });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(verifyJwt('not-a-token', secret, {}).ok).toBe(false);
    expect(verifyJwt('a.b', secret, {}).ok).toBe(false);
  });

  it('rejects unsupported alg header', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'x', sub: 'u', aud: 'c', exp: 999, iat: 1, jti: '1' })).toString('base64url');
    const token = `${header}.${payload}.fakesig`;
    expect(verifyJwt(token, secret, {}).ok).toBe(false);
  });
});
