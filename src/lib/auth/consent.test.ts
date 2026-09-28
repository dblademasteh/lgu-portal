import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasConsent,
  recordConsent,
  getConsent,
  revokeConsent,
  clearAllConsents,
  describeScope,
} from './consent';

describe('consent', () => {
  beforeEach(() => {
    clearAllConsents();
  });

  it('returns false when no consent exists', () => {
    expect(hasConsent('user-1', 'lgu-hris', ['openid', 'profile'])).toBe(false);
  });

  it('returns true when all requested scopes are consented', () => {
    recordConsent('user-1', 'lgu-hris', ['openid', 'profile', 'email']);
    expect(hasConsent('user-1', 'lgu-hris', ['openid', 'profile'])).toBe(true);
  });

  it('returns false when some scopes are missing', () => {
    recordConsent('user-1', 'lgu-hris', ['openid']);
    expect(hasConsent('user-1', 'lgu-hris', ['openid', 'profile'])).toBe(false);
  });

  it('is per-user and per-client', () => {
    recordConsent('user-1', 'lgu-hris', ['openid']);
    expect(hasConsent('user-2', 'lgu-hris', ['openid'])).toBe(false);
    expect(hasConsent('user-1', 'lgu-ebudget', ['openid'])).toBe(false);
  });

  it('getConsent returns the record', () => {
    recordConsent('user-1', 'lgu-hris', ['openid']);
    const record = getConsent('user-1', 'lgu-hris');
    expect(record).not.toBeNull();
    expect(record!.scopes).toEqual(['openid']);
    expect(record!.consentedAt).toBeGreaterThan(0);
  });

  it('revokeConsent removes the record', () => {
    recordConsent('user-1', 'lgu-hris', ['openid']);
    revokeConsent('user-1', 'lgu-hris');
    expect(hasConsent('user-1', 'lgu-hris', ['openid'])).toBe(false);
  });

  it('clearAllConsents removes every record', () => {
    recordConsent('user-1', 'lgu-hris', ['openid']);
    recordConsent('user-1', 'lgu-ebudget', ['openid']);
    clearAllConsents();
    expect(hasConsent('user-1', 'lgu-hris', ['openid'])).toBe(false);
    expect(hasConsent('user-1', 'lgu-ebudget', ['openid'])).toBe(false);
  });

  it('describeScope returns human-readable text for known scopes', () => {
    expect(describeScope('openid')).toBe('Basic sign-in information (your name and email)');
    expect(describeScope('profile')).toBe('Your profile information (display name, time zone)');
    expect(describeScope('email')).toBe('Your email address');
    expect(describeScope('budget:write')).toBe('Create and edit budget proposals');
  });

  it('describeScope falls back to the scope name for unknown scopes', () => {
    expect(describeScope('custom:scope')).toBe('Access to: custom:scope');
  });
});
