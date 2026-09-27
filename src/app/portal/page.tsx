/**
 * /portal — the system directory. The post-login destination.
 *
 * Server component. The catalogue, the viewer's roles and the access decision
 * are all resolved here; the client only receives two already-partitioned lists
 * and does the filtering.
 */

import type { Metadata } from 'next';
import { requireViewerWithSystems } from '@/lib/auth/guards';
import { PortalNav } from '@/components/PortalNav';
import { SystemDirectory } from '@/components/SystemDirectory';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { CATEGORIES } from '@/lib/systems';

export const metadata: Metadata = {
  title: 'Systems',
  description: 'All connected systems reachable through the LGU single sign-on gateway.',
};

export const dynamic = 'force-dynamic';

export default async function PortalPage() {
  const viewer = await requireViewerWithSystems();
  const { available, restricted, user } = viewer;

  const inMaintenance = available.filter((system) => system.status === 'maintenance').length;
  const degraded = available.filter((system) => system.status === 'degraded').length;

  // Pass only serializable data to client components
  const portalNavViewer = {
    user: {
      displayName: user.displayName,
      email: user.email,
      avatarHue: user.avatarHue,
      roles: user.roles,
    },
  };

  return (
    <div className="page-shell">
      <AuroraBackdrop />
      <PortalNav viewer={portalNavViewer} active="/portal" />

      <main className="container page-body" id="main">
        <header className="page-head">
          <div className="page-head-text">
            <p className="eyebrow">Signed in as {user.employeeId}</p>
            <h1 className="display-1">
              Good day, {user.displayName.split(' ')[0]}.
            </h1>
            <p className="text-body">
              {available.length} system{available.length === 1 ? '' : 's'} available to your
              role{user.roles.length > 1 ? 's' : ''} ({user.roles.join(', ')}). Select one to
              launch — you will not be asked to sign in again.
            </p>
          </div>

          <div className="page-stats">
            <div className="stat">
              <span className="stat-value">{available.length}</span>
              <span className="stat-label">Available</span>
            </div>
            <div className="stat">
              <span className="stat-value">{CATEGORIES.length}</span>
              <span className="stat-label">Categories</span>
            </div>
            {degraded > 0 ? (
              <div className="stat">
                <span className="stat-value">{degraded}</span>
                <span className="stat-label">Degraded</span>
              </div>
            ) : null}
            {inMaintenance > 0 ? (
              <div className="stat">
                <span className="stat-value">{inMaintenance}</span>
                <span className="stat-label">Maintenance</span>
              </div>
            ) : null}
          </div>
        </header>

        <SystemDirectory available={available} restricted={restricted} />
      </main>
    </div>
  );
}