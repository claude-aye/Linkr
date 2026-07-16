import { getShellCapabilities } from '@/lib/nav/capabilities';

import { Nav } from './nav';

/**
 * `(app)` route-group layout — the shared authenticated shell (Phase 3.13-PR2).
 *
 * A route group `(app)` adds NO URL segment. The root layout (`app/layout.tsx`)
 * still owns `<html>`/`<body>` + the global stylesheet; this nested layout adds
 * ONLY the shared chrome, never a second document. It is an async Server
 * Component (no `'use client'`) that resolves `getShellCapabilities()` ONCE per
 * request and renders the role-conditional `<Nav>` above the page.
 *
 * If there is no user (theoretical — `proxy.ts` redirects unauthenticated
 * requests before we get here), render `children` WITHOUT the nav rather than
 * crash: the page's own session gate then handles the redirect.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, isProvider } = await getShellCapabilities();

  if (!user) {
    return children;
  }

  return (
    <>
      <Nav isProvider={isProvider} />
      {children}
    </>
  );
}
