'use client';

/**
 * System tile — one launchable application in the portal grid.
 *
 * The whole card is one link, so it is reachable in one tab stop and activates
 * with Enter. There is no nested button, which is what usually makes tile grids
 * awkward to use with a keyboard.
 *
 * The accent is applied as scoped custom properties, not inline colour, so the
 * token layer still owns every colour and the tile only supplies a hue angle.
 */

import Link from 'next/link';
import { Icon } from './Icon';
import { StatusPill } from './Pills';
import { statusLabel, type System } from '@/lib/systems';

export function SystemTile({ system }: { system: System }) {
  const launchable = system.status !== 'maintenance';
  const scopeSummary = `${system.scopes.length} scope${system.scopes.length === 1 ? '' : 's'}`;

  return (
    <Link
      href={launchable ? `/launch/${system.slug}` : `/launch/${system.slug}?blocked=maintenance`}
      className="tile"
      data-launchable={launchable ? 'true' : 'false'}
      style={
        {
          '--tile-hue': String(system.accent),
          '--tile-accent': `hsl(var(--tile-hue) 82% 66%)`,
          '--tile-accent-wash': `hsl(var(--tile-hue) 82% 66% / 0.14)`,
          '--tile-accent-edge': `hsl(var(--tile-hue) 82% 68% / 0.32)`,
          '--tile-accent-glow': `hsl(var(--tile-hue) 82% 62% / 0.3)`,
        } as React.CSSProperties
      }
    >
      <div className="tile-head">
        <span className="tile-icon" aria-hidden="true">
          <Icon name={system.icon} size={22} />
        </span>
        <StatusPill status={system.status} label={statusLabel(system.status)} />
      </div>

      <div className="tile-body">
        <h3 className="tile-title">{system.shortName}</h3>
        <p className="tile-description">{system.description}</p>
      </div>

      <div className="tile-meta">
        <span className="tile-category">{system.category}</span>
        <span className="tile-dot-sep" aria-hidden="true">
          ·
        </span>
        <span>{system.version}</span>
        <span className="tile-dot-sep" aria-hidden="true">
          ·
        </span>
        <span>{scopeSummary}</span>
      </div>

      <div className="tile-usage" aria-hidden="true">
        <div className="tile-usage-track">
          <div className="tile-usage-fill" style={{ width: `${system.usagePercent}%` }} />
        </div>
        <span className="tile-usage-value">{system.usagePercent}%</span>
      </div>

      <span className="tile-cta">
        {launchable ? 'Launch with SSO' : 'View schedule'}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 8h9" />
          <path d="M8.75 4.25 12.5 8l-3.75 3.75" />
        </svg>
      </span>
    </Link>
  );
}

/**
 * A system the viewer holds no role for. Rendered, not hidden: showing the full
 * inventory and marking what is restricted is more useful to staff than a grid
 * with holes in it, and it avoids implying a system does not exist.
 */
export function RestrictedTile({ system }: { system: System }) {
  return (
    <div className="tile" data-launchable="false" data-restricted="true">
      <div className="tile-head">
        <span className="tile-icon" aria-hidden="true">
          <Icon name={system.icon} size={22} />
        </span>
        <span className="pill" data-tone="neutral">
          Restricted
        </span>
      </div>
      <div className="tile-body">
        <h3 className="tile-title">{system.shortName}</h3>
        <p className="tile-description">{system.description}</p>
      </div>
      <div className="tile-meta">
        <span className="tile-category">{system.category}</span>
        <span className="tile-dot-sep" aria-hidden="true">
          ·
        </span>
        <span>Requires {system.allowedRoles.join(' or ')}</span>
      </div>
      <span className="tile-cta" data-muted="true">
        Request access
      </span>
    </div>
  );
}
