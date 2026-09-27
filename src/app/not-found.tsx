import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="page-shell">
      <main className="container page-body" id="main">
        <section className="glass panel denial">
          <p className="eyebrow">404</p>
          <h1 className="display-1">No such page</h1>
          <p className="text-body">
            That address does not match a page or a connected system. The link may be out of date,
            or the system may have been retired from the catalogue.
          </p>
          <div className="denial-actions">
            <Link className="btn btn-primary btn-md" href="/portal">
              <span className="btn-label">Back to systems</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
