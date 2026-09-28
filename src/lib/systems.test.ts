import { describe, it, expect } from 'vitest';
import { getSystem, listSystems, canAccess, isLaunchable, statusLabel, CATEGORIES, type System } from './systems';

describe('systems', () => {
  describe('getSystem', () => {
    it('returns a system by slug', () => {
      expect(getSystem('hris')).not.toBeNull();
      expect(getSystem('hris')!.name).toBe('Human Resource Information System');
    });

    it('returns null for unknown slug', () => {
      expect(getSystem('unknown')).toBeNull();
    });
  });

  describe('listSystems', () => {
    it('returns all 12 systems', () => {
      expect(listSystems()).toHaveLength(12);
    });
  });

  describe('canAccess', () => {
    const hris: System = {
      slug: 'hris',
      name: 'HRIS',
      shortName: 'HRIS',
      description: '',
      category: 'People',
      icon: 'users',
      accent: 0,
      status: 'operational',
      url: '',
      owner: '',
      scopes: [],
      allowedRoles: ['employee', 'admin'] as const,
      accepts: [],
      version: '',
      usagePercent: 0,
    };

    it('denies access to maintenance systems regardless of roles', () => {
      const maintenance = { ...hris, status: 'maintenance' as const };
      expect(canAccess(maintenance, ['admin'] as any)).toBe(false);
    });

    it('allows access when allowedRoles is empty', () => {
      const open = { ...hris, allowedRoles: [] as any };
      expect(canAccess(open, ['any-role'] as any)).toBe(true);
    });

    it('allows access when user has one of the allowed roles', () => {
      expect(canAccess(hris, ['employee'] as any)).toBe(true);
      expect(canAccess(hris, ['admin'] as any)).toBe(true);
    });

    it('denies access when user has none of the allowed roles', () => {
      expect(canAccess(hris, ['guest'] as any)).toBe(false);
    });
  });

  describe('isLaunchable', () => {
    it('returns true for operational and degraded systems', () => {
      expect(isLaunchable({ ...listSystems()[0]!, status: 'operational' })).toBe(true);
      expect(isLaunchable({ ...listSystems()[0]!, status: 'degraded' })).toBe(true);
    });

    it('returns false for maintenance systems', () => {
      expect(isLaunchable({ ...listSystems()[0]!, status: 'maintenance' })).toBe(false);
    });
  });

  describe('statusLabel', () => {
    it('returns human-readable labels', () => {
      expect(statusLabel('operational')).toBe('Operational');
      expect(statusLabel('degraded')).toBe('Slow response');
      expect(statusLabel('maintenance')).toBe('In maintenance');
    });
  });

  describe('CATEGORIES', () => {
    it('contains all expected categories', () => {
      expect(CATEGORIES).toContain('People');
      expect(CATEGORIES).toContain('Finance');
      expect(CATEGORIES).toContain('Security');
    });
  });
});
