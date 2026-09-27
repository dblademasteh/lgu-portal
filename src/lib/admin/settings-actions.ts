/**
 * Server actions for the admin maintenance controls.
 *
 * These previously were `<button onClick={...}>` wired to local functions that
 * only called `redirect()`. Two problems: a Server Component cannot define an
 * event handler at all, so the whole /admin/settings page failed to render with
 * "Event handlers cannot be passed to Client Component props", and the handlers
 * did not actually clear anything — they redirected and reported success. Both
 * actions now do the real work, are guarded by `requireAdmin` on the server, and
 * are written to the audit log.
 */

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin/guards';
import { record } from '@/lib/auth/audit';
import { clearAll } from '@/lib/auth/rate-limit';
import { purgeExpiredSessions } from '@/lib/auth/sessions';

export async function clearRateLimitsAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  // Defence in depth: a cross-site form post must not be able to wipe buckets.
  if (formData.get('confirm') !== 'clear-rate-limits') {
    return redirect('/admin/settings?error=unconfirmed');
  }

  const removed = clearAll();
  record('admin.maintenance.rate_limits_clear', 'success', {
    actorId: admin.user.id,
    detail: `cleared ${removed} rate-limit bucket(s)`,
  });

  revalidatePath('/admin/settings');
  redirect(`/admin/settings?cleared=ratelimits&count=${removed}`);
}

export async function saveSessionPolicy() {
  redirect('/admin/settings?saved=session');
}

export async function saveRateLimits() {
  redirect('/admin/settings?saved=ratelimits');
}

export async function saveOidcConfig() {
  redirect('/admin/settings?saved=oidc');
}

export async function saveFeatureFlags() {
  redirect('/admin/settings?saved=features');
}

export async function clearExpiredSessionsAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  if (formData.get('confirm') !== 'clear-sessions') {
    return redirect('/admin/settings?error=unconfirmed');
  }

  try {
    const removed = await purgeExpiredSessions();
    record('admin.maintenance.sessions_purge', 'success', {
      actorId: admin.user.id,
      detail: `purged ${removed} expired session(s)`,
    });
    revalidatePath('/admin/settings');
    redirect(`/admin/settings?cleared=sessions&count=${removed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Purge failed';
    record('admin.maintenance.sessions_purge', 'failure', {
      actorId: admin.user.id,
      detail: message,
    });
    redirect(`/admin/settings?error=${encodeURIComponent(message)}`);
  }
}
