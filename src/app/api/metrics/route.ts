/**
 * Prometheus Metrics Endpoint.
 */

import { getMetrics, getMetricsContentType } from '@/lib/metrics';

export async function GET() {
  const metrics = await getMetrics();
  const contentType = await getMetricsContentType();

  return new Response(metrics, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}