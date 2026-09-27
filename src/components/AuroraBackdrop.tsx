/**
 * Ambient background: three drifting colour fields plus a faint grid.
 *
 * The grid matters: glassmorphism is only legible when there is structure behind
 * it to refract. Pure gradient orbs produce a flat wash and the blur reads as
 * nothing at all.
 *
 * Orbs animate with `transform` only, so they stay on the compositor and never
 * trigger layout. `globals.css` disables all of this under
 * `prefers-reduced-motion`.
 */

export function AuroraBackdrop() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      <div className="aurora-orb aurora-orb-3" />
    </div>
  );
}
