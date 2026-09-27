/**
 * Catalogue of connected systems.
 *
 * Each entry is one application behind the SSO gateway. `scopes` and
 * `allowedRoles` are enforced server-side on launch (see lib/oidc.ts) — the UI
 * only uses them to decide what to render, never to decide what is permitted.
 *
 * `accent` is a hue angle in degrees. It is applied through a component-scoped
 * custom property so per-system colour stays out of the token layer, which owns
 * brand colour only.
 */

import type { Role } from './auth/users';

export type SystemCategory =
  | 'People'
  | 'Finance'
  | 'Planning'
  | 'Operations'
  | 'Public Service'
  | 'Technology'
  | 'Security';

export type SystemStatus = 'operational' | 'degraded' | 'maintenance';

export type System = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  category: SystemCategory;
  /** Inline icon key, resolved by components/Icon.tsx. No icon-font, no network. */
  icon: IconKey;
  /** Hue (deg) driving the tile's accent. */
  accent: number;
  status: SystemStatus;
  /** The upstream URL a real deployment would redirect to. */
  url: string;
  owner: string;
  /** OIDC scopes this system requests. */
  scopes: string[];
  /** Roles permitted to launch. Empty array means every authenticated user. */
  allowedRoles: Role[];
  /** Auth methods the downstream app accepts. */
  accepts: string[];
  /** Shown on the tile: last known deployment or data sync marker. */
  version: string;
  /** Relative adoption share, drives the bar on the tile. Percent 0-100. */
  usagePercent: number;
  maintenanceWindow?: string;
  ticketQueue?: string;
};

export type IconKey =
  | 'users'
  | 'wallet'
  | 'chart'
  | 'map'
  | 'file-text'
  | 'book'
  | 'heart'
  | 'shopping-cart'
  | 'headset'
  | 'bar-chart'
  | 'shield'
  | 'building'
  | 'truck'
  | 'clipboard'
  | 'database'
  | 'globe'
  | 'download'
  | 'filter'
  | 'x'
  | 'chevron-left'
  | 'chevron-right'
  | 'loader'
  | 'rotate-cw'
  | 'external-link'
  | 'trash'
  | 'edit'
  | 'unlock'
  | 'lock'
  | 'refresh-cw'
  | 'plus'
  | 'arrow-left'
  | 'save'
  | 'copy'
  | 'shield-off'
  | 'rotate-cw'
  | 'key'
  | 'activity'
  | 'home'
  | 'server'
  | 'search';

export const SYSTEMS: System[] = [
  {
    slug: 'hris',
    name: 'Human Resource Information System',
    shortName: 'HRIS',
    description: 'Employee records, service credit, plantilla and appointment management.',
    category: 'People',
    icon: 'users',
    accent: 268,
    status: 'operational',
    url: 'https://hris.lgu.example.gov.ph',
    owner: 'Human Resource Management Office',
    scopes: ['profile:read', 'leave:write', 'payroll:read'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v4.2.1',
    usagePercent: 92,
  },
  {
    slug: 'treasury',
    name: 'Treasury & Revenue Management',
    shortName: 'Treasury',
    description: 'Collections, accountabilities, disbursements and bank reconciliation.',
    category: 'Finance',
    icon: 'wallet',
    accent: 190,
    status: 'operational',
    url: 'https://treasury.lgu.example.gov.ph',
    owner: 'Finance & Budget Office',
    scopes: ['revenue:read', 'revenue:write', 'disbursement:approve'],
    allowedRoles: ['supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v7.0.4',
    usagePercent: 78,
  },
  {
    slug: 'ebudget',
    name: 'e-Budget & Performance Monitoring',
    shortName: 'e-Budget',
    description: 'Annual budget proposals, allotment release and obligation tracking.',
    category: 'Finance',
    icon: 'chart',
    accent: 38,
    status: 'degraded',
    url: 'https://ebudget.lgu.example.gov.ph',
    owner: 'Planning & Development Office',
    scopes: ['budget:read', 'budget:write', 'obligation:write'],
    allowedRoles: ['supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v3.8.0',
    usagePercent: 64,
    maintenanceWindow: 'Sat 02:00–04:00',
  },
  {
    slug: 'gis',
    name: 'Geographic Information System',
    shortName: 'GIS',
    description: 'Parcels, zoning overlays, cadastral layers and permit geofencing.',
    category: 'Planning',
    icon: 'map',
    accent: 152,
    status: 'operational',
    url: 'https://gis.lgu.example.gov.ph',
    owner: 'Planning & Development Office',
    scopes: ['parcel:read', 'zoning:read', 'permit:write'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v2.9.7',
    usagePercent: 47,
  },
  {
    slug: 'dms',
    name: 'Document Management System',
    shortName: 'DMS',
    description: 'Records intake, routing, retention and certified true copies.',
    category: 'Operations',
    icon: 'file-text',
    accent: 210,
    status: 'operational',
    url: 'https://dms.lgu.example.gov.ph',
    owner: 'General Services Office',
    scopes: ['document:read', 'document:write', 'document:sign'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v5.1.2',
    usagePercent: 81,
  },
  {
    slug: 'library',
    name: 'Public Library Catalogue',
    shortName: 'Library',
    description: 'Holdings, circulation, patron accounts and digital collections.',
    category: 'Public Service',
    icon: 'book',
    accent: 22,
    status: 'operational',
    url: 'https://library.lgu.example.gov.ph',
    owner: 'City Library Office',
    scopes: ['catalogue:read', 'circulation:write'],
    allowedRoles: ['employee', 'auditor'],
    accepts: ['pwd'],
    version: 'v1.6.9',
    usagePercent: 12,
  },
  {
    slug: 'health',
    name: 'City Health Registry',
    shortName: 'Health',
    description: 'Facilitation, immunisation coverage and inventory of medical supplies.',
    category: 'Public Service',
    icon: 'heart',
    accent: 340,
    status: 'maintenance',
    url: 'https://health.lgu.example.gov.ph',
    owner: 'City Health Office',
    scopes: ['registry:read', 'registry:write', 'inventory:read'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v3.1.4',
    usagePercent: 35,
    maintenanceWindow: 'Sun 01:00–06:00',
  },
  {
    slug: 'procurement',
    name: 'Procurement & Bid Management',
    shortName: 'Procurement',
    description: 'Canvassing, bid abstracts, purchase orders and supplier registry.',
    category: 'Finance',
    icon: 'shopping-cart',
    accent: 96,
    status: 'operational',
    url: 'https://procurement.lgu.example.gov.ph',
    owner: 'General Services Office',
    scopes: ['canvass:read', 'canvass:write', 'po:approve'],
    allowedRoles: ['supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v4.4.0',
    usagePercent: 41,
  },
  {
    slug: 'helpdesk',
    name: 'ICT Service Desk',
    shortName: 'Helpdesk',
    description: 'Incident reports, asset inventory, access requests and SLAs.',
    category: 'Technology',
    icon: 'headset',
    accent: 172,
    status: 'operational',
    url: 'https://helpdesk.lgu.example.gov.ph',
    owner: 'Information & Communications Technology Office',
    scopes: ['ticket:read', 'ticket:write', 'asset:read'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp'],
    version: 'v6.0.1',
    usagePercent: 69,
  },
  {
    slug: 'analytics',
    name: 'City Analytics Dashboard',
    shortName: 'Analytics',
    description: 'Cross-system KPIs, service volume trends and citizen feedback metrics.',
    category: 'Technology',
    icon: 'bar-chart',
    accent: 286,
    status: 'operational',
    url: 'https://analytics.lgu.example.gov.ph',
    owner: 'Information & Communications Technology Office',
    scopes: ['kpi:read', 'feedback:read'],
    allowedRoles: ['supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v2.2.0',
    usagePercent: 53,
  },
  {
    slug: 'iam',
    name: 'Identity & Access Registry',
    shortName: 'IAM',
    description: 'Role grants, delegated administration and privileged access approvals.',
    category: 'Security',
    icon: 'shield',
    accent: 8,
    status: 'operational',
    url: 'https://iam.lgu.example.gov.ph',
    owner: 'Information & Communications Technology Office',
    scopes: ['role:read', 'role:write', 'access:approve'],
    allowedRoles: ['admin'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v1.9.3',
    usagePercent: 18,
  },
  {
    slug: 'permits',
    name: 'Business Permit & Licensing',
    shortName: 'Permits',
    description: 'Business permits, mayoral clearances and business registration.',
    category: 'Public Service',
    icon: 'building',
    accent: 128,
    status: 'operational',
    url: 'https://permits.lgu.example.gov.ph',
    owner: 'General Services Office',
    scopes: ['permit:read', 'permit:write', 'clearance:write'],
    allowedRoles: ['employee', 'supervisor', 'admin', 'auditor'],
    accepts: ['pwd', 'otp', 'hwk'],
    version: 'v8.3.1',
    usagePercent: 57,
  },
];

const BY_SLUG = new Map(SYSTEMS.map((system) => [system.slug, system]));

export function getSystem(slug: string): System | null {
  return BY_SLUG.get(slug) ?? null;
}

export function listSystems(): System[] {
  return SYSTEMS;
}

export const CATEGORIES: SystemCategory[] = [
  'People',
  'Finance',
  'Planning',
  'Operations',
  'Public Service',
  'Technology',
  'Security',
];

/** Server-side authorization check. The single source of truth for access. */
export function canAccess(system: System, roles: readonly Role[]): boolean {
  if (system.allowedRoles.length === 0) return true;
  return system.allowedRoles.some((role) => roles.includes(role));
}

/** Status is advisory: it shapes the tile, it does not gate the launch. */
export function isLaunchable(system: System): boolean {
  return system.status !== 'maintenance';
}

export function statusLabel(status: SystemStatus): string {
  switch (status) {
    case 'operational':
      return 'Operational';
    case 'degraded':
      return 'Slow response';
    case 'maintenance':
      return 'In maintenance';
  }
}
