/**
 * GET /api/admin/audit/export — Export audit log as CSV.
 *
 * Accepts the same query parameters as the audit log page and returns
 * matching entries as a downloadable CSV file.
 */

import { requireAdmin } from '@/lib/admin/guards';
import { getAuditEntries, type AuditEntry } from '@/lib/auth/audit';
import { type NextRequest } from 'next/server';

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const searchParams = request.nextUrl.searchParams;
  const entries = getAuditEntries({
    event: searchParams.get('event') ?? undefined,
    outcome: searchParams.get('outcome') ?? undefined,
    actor: searchParams.get('actor') ?? undefined,
    from: searchParams.get('from') ? new Date(searchParams.get('from')!).getTime() : undefined,
    to: searchParams.get('to') ? new Date(searchParams.get('to')!).getTime() : undefined,
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
    offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined,
  }).entries;

  const headers = ['Time', 'Event', 'Outcome', 'Actor ID', 'Actor Label', 'Target', 'Detail', 'IP', 'User Agent', 'Trace ID'];

  const csvRows = [
    headers.map(escapeCsvField).join(','),
    ...entries.map((entry: AuditEntry) =>
      [
        new Date(entry.at).toISOString(),
        escapeCsvField(entry.event),
        escapeCsvField(entry.outcome),
        escapeCsvField(entry.actorId ?? ''),
        escapeCsvField(entry.actorLabel ?? ''),
        escapeCsvField(entry.target ?? ''),
        escapeCsvField(entry.detail ?? ''),
        escapeCsvField(entry.ip ?? ''),
        escapeCsvField(entry.userAgent ?? ''),
        escapeCsvField(entry.traceId),
      ].join(','),
    ),
  ];

  const csv = csvRows.join('\n');
  const filename = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
