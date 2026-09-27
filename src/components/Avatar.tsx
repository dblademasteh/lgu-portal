/**
 * Initial-based avatar.
 *
 * The hue is supplied per user so the account list is scannable at a glance
 * without storing or serving any profile image. The background is a translucent
 * wash of that hue at low alpha, which keeps text contrast readable regardless of
 * hue while still reading as "that person".
 *
 * Because the wash is translucent rather than opaque, the surrounding text
 * colour is guaranteed to apply — the hue can never push contrast below the
 * foreground token.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function Avatar({
  name,
  hue,
  size = 'md',
}: {
  name: string;
  hue: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      className="avatar"
      data-size={size}
      style={{
        // Two composable custom properties: the raw hue, and the wash built on it.
        '--avatar-hue': String(hue),
        '--avatar-wash': `hsl(var(--avatar-hue) 84% 62% / 0.18)`,
        '--avatar-edge': `hsl(var(--avatar-hue) 84% 68% / 0.36)`,
        backgroundColor: 'var(--avatar-wash)',
        borderColor: 'var(--avatar-edge)',
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
