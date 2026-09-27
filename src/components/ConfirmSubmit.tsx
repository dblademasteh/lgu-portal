'use client';

/**
 * Submit button that asks for confirmation first.
 *
 * Server Components cannot define event handlers, so destructive admin actions
 * used to inline `onClick={(e) => { if (!confirm(...)) e.preventDefault(); }}`
 * directly in pages like /admin/users. Next rejects that at render time with
 * "Event handlers cannot be passed to Client Component props", which took the
 * entire page down to a 500. The confirmation lives here on the client instead,
 * and the surrounding `<form action={serverAction}>` is left untouched — so this
 * stays a plain POST that works without JavaScript beyond the confirm dialog.
 */

import type { ReactNode } from 'react';

export function ConfirmSubmit({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
