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
        <header className="portal-hero">
          <div className="portal-hero-text">
            <p className="portal-hero-eyebrow">Welcome to the LGU Portal</p>
            <h1 className="portal-hero-title">
              {user.displayName.split(' ')[0]},<br />
              <span className="portal-hero-title-accent">what would you like to do?</span>
            </h1>
            <p className="portal-hero-description">
              {available.length} system{available.length === 1 ? '' : 's'} available to your
              role{user.roles.length > 1 ? 's' : ''} ({user.roles.join(', ')}). Launch any system below — you will not be asked to sign in again.
            </p>
          </div>

          <div className="portal-hero-stats">
            <div className="portal-stat">
              <span className="portal-stat-value">{available.length}</span>
              <span className="portal-stat-label">Available</span>
            </div>
            <div className="portal-stat-divider" aria-hidden="true" />
            <div className="portal-stat">
              <span className="portal-stat-value">{CATEGORIES.length}</span>
              <span className="portal-stat-label">Categories</span>
            </div>
            {degraded > 0 && (
              <>
                <div className="portal-stat-divider" aria-hidden="true" />
                <div className="portal-stat">
                  <span className="portal-stat-value portal-stat-value--warning">{degraded}</span>
                  <span className="portal-stat-label">Degraded</span>
                </div>
              </>
            )}
            {inMaintenance > 0 && (
              <>
                <div className="portal-stat-divider" aria-hidden="true" />
                <div className="portal-stat">
                  <span className="portal-stat-value portal-stat-value--muted">{inMaintenance}</span>
                  <span className="portal-stat-label">Maintenance</span>
                </div>
              </>
            )}
          </div>
        </header>

        <SystemDirectory available={available} restricted={restricted} />
      </main>
    </div>
  );
}