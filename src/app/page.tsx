/**
 * / — entry point.
 *
 * Sends signed-in users to the portal and signed-out users to sign in. There is
 * no marketing page: this is an internal gateway, and a landing page in front
 * of it would only add a click.
 */

import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/guards';

export default async function RootPage() {
  const viewer = await getViewer();
  redirect(viewer ? '/portal' : '/login');
}
