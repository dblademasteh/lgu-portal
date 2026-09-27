/**
 * Status and category pills.
 *
 * Colour is never the only signal: each pill carries its label as text, so the
 * state is legible without colour perception. `StatusPill` pairs the colour with
 * a dot, `MetaPill` is purely informational.
 */

import type { SystemStatus } from '@/lib/systems';
import { StatusDot } from './Icon';

const TONE_BY_STATUS: Record<SystemStatus, 'success' | 'warning' | 'danger'> = {
  operational: 'success',
  degraded: 'warning',
  maintenance: 'danger',
};

export function StatusPill({ status, label }: { status: SystemStatus; label: string }) {
  return (
    <span className="pill" data-tone={TONE_BY_STATUS[status]}>
      <StatusDot size={6} />
      {label}
    </span>
  );
}

export function MetaPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <span className="pill" data-tone={tone}>
      {children}
    </span>
  );
}

/** Verified / granted / active style label, for role and scope listings. */
export function GrantPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="pill" data-tone="accent">
      {children}
    </span>
  );
}
