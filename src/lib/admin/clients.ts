/**
 * Server actions for OIDC client management.
 */

'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guards';
import { registerClient, rotateClientSecret, deleteClient } from '@/lib/oidc';

export { registerClient, rotateClientSecret, deleteClient };

export async function registerClientAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const clientId = String(formData.get('clientId') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const redirectUris = formData.getAll('redirectUris').map(String).filter(Boolean);
  const scopes = formData.getAll('scopes').map(String).filter(Boolean);
  const systemSlug = String(formData.get('systemSlug') ?? '').trim();

  if (!clientId || !name || redirectUris.length === 0 || scopes.length === 0 || !systemSlug) {
    return redirect('/admin/clients/new?error=missing_fields');
  }

  try {
    const client = await registerClient({
      clientId,
      name,
      redirectUris,
      scopes,
      systemSlug,
    });

    redirect(`/admin/clients/${client.clientId}/edit?created=1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    redirect(`/admin/clients/new?error=${encodeURIComponent(message)}`);
  }
}

export async function rotateClientSecretAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const clientId = String(formData.get('clientId') ?? '');
  if (!clientId) return redirect('/admin/clients?error=missing_id');

  try {
    await rotateClientSecret(clientId);
    redirect(`/admin/clients/${clientId}/edit?rotated=1`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rotation failed';
    redirect(`/admin/clients?error=${encodeURIComponent(message)}`);
  }
}

export async function deleteClientAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return redirect('/unauthorized?reason=admin_required');

  const clientId = String(formData.get('clientId') ?? '');
  if (!clientId) return redirect('/admin/clients?error=missing_id');

  // Prevent deleting system clients
  if (clientId.startsWith('lgu-')) {
    return redirect('/admin/clients?error=cannot_delete_system_client');
  }

  await deleteClient(clientId);

  redirect('/admin/clients?deleted=1');
}