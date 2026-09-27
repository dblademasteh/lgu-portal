/**
 * Date and duration formatting.
 *
 * The portal renders timestamps for people in Asia/Manila reading about events
 * that happened in UTC, so every absolute time is formatted in an explicit,
 * fixed locale-timezone rather than the server's. Relative times ("4 min ago")
 * are used alongside because an audit table is scanned far faster on recency
 * than on absolute timestamps.
 *
 * `en-PH` with an explicit `timeZone` is used rather than the runtime default so
 * a server in any region produces identical output.
 */

const LOCALE = 'en-PH';
const TIME_ZONE = 'Asia/Manila';

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIME_ZONE,
  }).format(timestamp);
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeZone: TIME_ZONE,
  }).format(timestamp);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 1000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
];

/** "just now", "4 min ago", "3 hr ago", "2 days ago". */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = timestamp - now;
  const absolute = Math.abs(delta);

  if (absolute < 5000) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'narrow' });

  for (let index = RELATIVE_UNITS.length - 1; index >= 0; index--) {
    const [unit, ms] = RELATIVE_UNITS[index]!;
    if (absolute >= ms || index === 0) {
      return formatter.format(Math.round(delta / ms), unit);
    }
  }
  return 'just now';
}

/** Compact duration: "45s", "12m 30s", "3h 05m", "8h 00m". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** "en-PH", "admin, employee" — for readable role lists. */
export function formatList(values: readonly string[]): string {
  if (values.length === 0) return 'none';
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]!}`;
}
