import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/guards';
import { AdminNav } from '@/components/AdminNav';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import '@/components/admin.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · LGU Portal Admin' },
  description: 'LGU Portal administration console.',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="page-shell admin-shell">
      <AuroraBackdrop />
      <AdminNav admin={admin} />
      <main className="admin-main" id="main">
        {children}
      </main>
    </div>
  );
}