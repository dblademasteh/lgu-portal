/**
 * Server actions for system management.
 *
 * These run on the server and are called from forms in the admin UI.
 * They validate input, enforce admin authorization, and mutate the system registry.
 */

'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guards';
import { getSystem, type System, type SystemCategory } from '@/lib/systems';
import type { Role } from '@/lib/auth/users';
import { randomToken } from '@/lib/auth/crypto';
import type { IconKey } from '@/lib/systems';

/* ------------------------------------------------------------------ */
/* Type definitions                                                     */
/* ------------------------------------------------------------------ */

export type SystemFormData = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  accent: number;
  status: System['status'];
  allowedRoles: string[];
  scopes: string[];
  redirectUris: string[];
};

export type SystemActionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string; field?: string };

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const VALID_ICONS = [
  'server', 'database', 'users', 'briefcase', 'book-open',
  'heart', 'shopping-bag', 'help-circle', 'bar-chart', 'shield',
  'key', 'file-text', 'globe', 'credit-card', 'monitor',
] as const;

const VALID_STATUSES = ['operational', 'degraded', 'maintenance'] as const;
const VALID_ROLES = ['admin', 'supervisor', 'employee', 'auditor'] as const;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const HUE_REGEX = /^\d+$/;

function validateForm(data: SystemFormData, isEdit: boolean, originalSlug?: string): { ok: true } | { ok: false; error: string; field?: string } {
  // Slug
  if (!data.slug || data.slug.length < 2 || data.slug.length > 32) {
    return { ok: false, error: 'Slug must be 2-32 characters', field: 'slug' };
  }
  if (!SLUG_REGEX.test(data.slug)) {
    return { ok: false, error: 'Slug must be lowercase alphanumeric with hyphens only', field: 'slug' };
  }
  if (!isEdit || data.slug !== originalSlug) {
    // Check uniqueness (would need to check against registry)
    // For now we trust the form
  }

  // Name
  if (!data.name || data.name.length < 2 || data.name.length > 64) {
    return { ok: false, error: 'Name must be 2-64 characters', field: 'name' };
  }

  // Description
  if (!data.description || data.description.length > 256) {
    return { ok: false, error: 'Description is required (max 256 chars)', field: 'description' };
  }

  // Icon
  if (!VALID_ICONS.includes(data.icon as any)) {
    return { ok: false, error: 'Invalid icon', field: 'icon' };
  }

  // Accent (hue 0-360)
  if (!HUE_REGEX.test(String(data.accent))) {
    return { ok: false, error: 'Accent must be a number', field: 'accent' };
  }
  const hue = Number(data.accent);
  if (hue < 0 || hue > 360) {
    return { ok: false, error: 'Accent must be 0-360', field: 'accent' };
  }

  // Status
  if (!VALID_STATUSES.includes(data.status as any)) {
    return { ok: false, error: 'Invalid status', field: 'status' };
  }

  // Roles
  if (!data.allowedRoles || data.allowedRoles.length === 0) {
    return { ok: false, error: 'At least one role is required', field: 'allowedRoles' };
  }
  for (const role of data.allowedRoles) {
    if (!VALID_ROLES.includes(role as any)) {
      return { ok: false, error: `Invalid role: ${role}`, field: 'allowedRoles' };
    }
  }

  // Scopes
  if (!data.scopes || data.scopes.length === 0) {
    return { ok: false, error: 'At least one scope is required', field: 'scopes' };
  }
  for (const scope of data.scopes) {
    if (!/^[a-z0-9:._-]+$/.test(scope)) {
      return { ok: false, error: `Invalid scope format: ${scope}`, field: 'scopes' };
    }
  }

  // Redirect URIs
  if (!data.redirectUris || data.redirectUris.length === 0) {
    return { ok: false, error: 'At least one redirect URI is required', field: 'redirectUris' };
  }
  for (const uri of data.redirectUris) {
    try {
      new URL(uri);
    } catch {
      return { ok: false, error: `Invalid redirect URI: ${uri}`, field: 'redirectUris' };
    }
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Registry persistence (in-memory for demo, swap for DB)              */
/* ------------------------------------------------------------------ */

// In production, this would be a database. For the demo we mutate the
// module-level registry in systems.ts. Since Next.js server actions run
// in the same process, this works for the demo.
// For production, replace with a proper database.

let _systemsCache: System[] | null = null;

function getSystemsCache(): System[] {
  if (!_systemsCache) {
    const { listSystems } = require('@/lib/systems');
    _systemsCache = listSystems();
  }
  return _systemsCache!;
}

function invalidateCache() {
  _systemsCache = null;
}

function findSystem(slug: string): System | undefined {
  return getSystemsCache().find((s) => s.slug === slug);
}

function addSystemToRegistry(system: System): void {
  const cache = getSystemsCache();
  cache.push(system);
  invalidateCache();
}

function updateSystemInRegistry(slug: string, updates: Partial<System>): boolean {
  const cache = getSystemsCache();
  const idx = cache.findIndex((s) => s.slug === slug);
  if (idx === -1) return false;
  
  // Filter out undefined values to maintain type safety
  const filteredUpdates: Partial<System> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      (filteredUpdates as any)[key] = value;
    }
  }
  
  cache[idx] = { ...cache[idx], ...filteredUpdates } as System;
  invalidateCache();
  return true;
}

function deleteSystemFromRegistry(slug: string): boolean {
  const cache = getSystemsCache();
  const idx = cache.findIndex((s) => s.slug === slug);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  invalidateCache();
  return true;
}

/* ------------------------------------------------------------------ */
/* Server actions                                                      */
/* ------------------------------------------------------------------ */

export async function createSystem(formData: FormData): Promise<SystemActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const data: SystemFormData = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    icon: String(formData.get('icon') ?? '').trim(),
    accent: Number(formData.get('accent') ?? 0),
    status: String(formData.get('status') ?? 'operational') as System['status'],
    allowedRoles: formData.getAll('allowedRoles').map(String),
    scopes: formData.getAll('scopes').map((s) => String(s).trim()).filter(Boolean),
    redirectUris: formData.getAll('redirectUris').map((s) => String(s).trim()).filter(Boolean),
  };

  const validation = validateForm(data, false);
  if (!validation.ok) return { ok: false, error: validation.error, field: validation.field };

  // Check slug uniqueness
  if (findSystem(data.slug)) {
    return { ok: false, error: 'A system with this slug already exists', field: 'slug' };
  }

  const newSystem: System = {
    slug: data.slug,
    name: data.name,
    shortName: data.slug.toUpperCase(),
    description: data.description,
    category: 'Technology' as SystemCategory,
    icon: data.icon as IconKey,
    accent: data.accent,
    status: data.status,
    url: '',
    owner: '',
    scopes: data.scopes,
    allowedRoles: data.allowedRoles as Role[],
    accepts: [],
    version: '1.0.0',
    usagePercent: 0,
    ticketQueue: '',
  };

  addSystemToRegistry(newSystem);

  redirect(`/admin/systems/${data.slug}?created=1`);
}

export async function updateSystem(formData: FormData): Promise<SystemActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const slug = String(formData.get('slug') ?? '').trim();
  const originalSlug = String(formData.get('originalSlug') ?? '').trim();

  if (!slug || !originalSlug) {
    return { ok: false, error: 'Missing slug' };
  }

  const existing = findSystem(originalSlug);
  if (!existing) {
    return { ok: false, error: 'System not found' };
  }

  const data: SystemFormData = {
    slug: String(formData.get('slug') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    icon: String(formData.get('icon') ?? '').trim(),
    accent: Number(formData.get('accent') ?? 0),
    status: String(formData.get('status') ?? 'operational') as System['status'],
    allowedRoles: formData.getAll('allowedRoles').map(String),
    scopes: formData.getAll('scopes').map((s) => String(s).trim()).filter(Boolean),
    redirectUris: formData.getAll('redirectUris').map((s) => String(s).trim()).filter(Boolean),
  };

  const validation = validateForm(data, true, originalSlug);
  if (!validation.ok) return { ok: false, error: validation.error, field: validation.field };

  // If slug changed, check uniqueness
  if (data.slug !== originalSlug && findSystem(data.slug)) {
    return { ok: false, error: 'A system with this slug already exists', field: 'slug' };
  }

  const success = updateSystemInRegistry(originalSlug, {
    slug: data.slug,
    name: data.name,
    description: data.description,
    icon: data.icon as IconKey,
    accent: data.accent,
    status: data.status,
    allowedRoles: data.allowedRoles as Role[],
    scopes: data.scopes,
  });

  if (!success) return { ok: false, error: 'System not found' };

  redirect(`/admin/systems/${data.slug}?updated=1`);
}

export async function deleteSystem(formData: FormData): Promise<SystemActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Unauthorized' };

  const slug = String(formData.get('slug') ?? '').trim();
  if (!slug) return { ok: false, error: 'Missing slug' };

  const existing = findSystem(slug);
  if (!existing) {
    return { ok: false, error: 'System not found' };
  }

  // Prevent deleting critical systems
  if (['iam', 'hris'].includes(slug)) {
    return { ok: false, error: 'Critical system cannot be deleted' };
  }

  const success = deleteSystemFromRegistry(slug);
  if (!success) return { ok: false, error: 'System not found' };

  redirect('/admin/systems?deleted=1');
}