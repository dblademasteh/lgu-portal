/**
 * Server actions for RS256 key management.
 *
 * Replaces a client-side stub that called `alert()` and logged to the console.
 * These actions are the real thing: they generate a genuine RSA key pair, and
 * they are guarded by `requireAdmin` on the server, so authorisation does not
 * depend on the button being hidden in the UI.
 *
 * Every mutation is written to the audit log, because a key rotation is
 * exactly the kind of event an incident review needs to see.
 */

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin/guards';
import { record } from '@/lib/auth/audit';
import { getSigningKeys, revokeKey, rotateSigningKeys } from '@/lib/admin/keys';

export async function rotateSigningKeysAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  // Defence in depth: a cross-site form post must not be able to rotate keys.
  const confirmed = formData.get('confirm') === 'rotate';
  if (!confirmed) return redirect('/admin/keys?error=unconfirmed');

  try {
    const key = await rotateSigningKeys();
    record('admin.keys.rotate', 'success', {
      actorId: admin.user.id,
      target: key.kid,
      detail: `promoted ${key.kid} to active`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rotation failed';
    record('admin.keys.rotate', 'failure', { actorId: admin.user.id, detail: message });
    return redirect(`/admin/keys?error=${encodeURIComponent(message)}`);
  }

  revalidatePath('/admin/keys');
  redirect('/admin/keys?rotated=1');
}

export async function revokeSigningKeyAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const kid = String(formData.get('kid') ?? '').trim();
  if (!kid) return redirect('/admin/keys?error=missing_kid');

  const revoked = await revokeKey(kid);
  if (!revoked) {
    // The usual cause is trying to revoke the only active key, which would
    // leave the portal unable to sign.
    record('admin.keys.revoke', 'denied', { actorId: admin.user.id, target: kid });
    return redirect('/admin/keys?error=cannot_revoke');
  }

  record('admin.keys.revoke', 'success', {
    actorId: admin.user.id,
    target: kid,
    detail: 'key withdrawn from the published JWKS',
  });

  revalidatePath('/admin/keys');
  redirect('/admin/keys?revoked=1');
}

/** Exposed so the page can show the current keyring alongside the JWKS. */
export async function listSigningKeys() {
  await requireAdmin();
  return getSigningKeys();
}
