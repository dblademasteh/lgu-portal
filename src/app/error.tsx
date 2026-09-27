'use client';

/**
 * Route-level error boundary.
 *
 * The error is logged to the console with its digest but never rendered as text:
 * stack traces and internal messages in a portal UI are an information leak,
 * and they are not actionable for the person looking at the screen. What they
 * do get is a reference they can quote to the service desk, and two ways out.
 */

import { useEffect } from 'react';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[portal] unhandled route error', error);
  }, [error]);

  return (
    <div className="page-shell">
      <main className="container page-body" id="main">
        <section className="glass panel denial" role="alert">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="display-1">This page could not be loaded</h1>
          <p className="text-body">
            The request failed before it reached the authorisation server. Nothing was changed and
            no credential was submitted. Try again; if it persists, quote the reference below to
            the ICT Service Desk.
          </p>

          {error.digest ? (
            <dl className="definition-list">
              <dt>Reference</dt>
              <dd className="mono">{error.digest}</dd>
            </dl>
          ) : null}

          <div className="denial-actions">
            <button type="button" className="btn btn-primary btn-md" onClick={reset}>
              <span className="btn-label">Try again</span>
            </button>
            <a className="btn btn-secondary btn-md" href="/portal">
              <span className="btn-label">Back to systems</span>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
