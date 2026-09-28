import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isIdPEnabled,
  getIdPConfig,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  IDP_STATE_COOKIE,
} from './client';

describe('idp client', () => {
  beforeEach(() => {
    delete process.env.IDP_ISSUER;
    delete process.env.IDP_CLIENT_ID;
    delete process.env.IDP_CLIENT_SECRET;
    delete process.env.IDP_SCOPES;
    vi.resetModules();
  });

  it('isIdPEnabled returns false when IDP_ISSUER is not set', async () => {
    const { isIdPEnabled: check } = await import('./client');
    expect(check()).toBe(false);
  });

  it('getIdPConfig returns null when IDP_ISSUER is not set', async () => {
    const { getIdPConfig: get } = await import('./client');
    expect(get()).toBeNull();
  });

  it('returns config when IDP_ISSUER and IDP_CLIENT_ID are set', async () => {
    process.env.IDP_ISSUER = 'https://keycloak.example.gov.ph';
    process.env.IDP_CLIENT_ID = 'portal-client';
    process.env.IDP_CLIENT_SECRET = 'secret123';
    process.env.IDP_SCOPES = 'openid profile email';

    const { getIdPConfig: get } = await import('./client');
    const config = get();
    expect(config).not.toBeNull();
    expect(config!.issuer).toBe('https://keycloak.example.gov.ph');
    expect(config!.clientId).toBe('portal-client');
    expect(config!.clientSecret).toBe('secret123');
    expect(config!.authorizationUrl).toBe('https://keycloak.example.gov.ph/protocol/openid-connect/auth');
    expect(config!.tokenUrl).toBe('https://keycloak.example.gov.ph/protocol/openid-connect/token');
    expect(config!.userinfoUrl).toBe('https://keycloak.example.gov.ph/protocol/openid-connect/userinfo');
    expect(config!.scopes).toEqual(['openid', 'profile', 'email']);
  });

  it('strips trailing slash from issuer', async () => {
    process.env.IDP_ISSUER = 'https://keycloak.example.gov.ph/';
    process.env.IDP_CLIENT_ID = 'portal-client';

    const { getIdPConfig: get } = await import('./client');
    const config = get();
    expect(config!.issuer).toBe('https://keycloak.example.gov.ph');
  });

  it('returns null when IDP_ISSUER is set but IDP_CLIENT_ID is missing', async () => {
    process.env.IDP_ISSUER = 'https://keycloak.example.gov.ph';

    const { getIdPConfig: get } = await import('./client');
    expect(get()).toBeNull();
  });

  it('generates a code verifier', () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThan(0);
  });

  it('generates different verifiers on each call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it('generates a code challenge from a verifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(typeof challenge).toBe('string');
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('generates a state token', () => {
    const state = generateState();
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);
  });

  it('IDP_STATE_COOKIE has the expected name', async () => {
    const { IDP_STATE_COOKIE: cookie } = await import('./client');
    expect(cookie).toBe('lgu_idp_state');
  });
});
