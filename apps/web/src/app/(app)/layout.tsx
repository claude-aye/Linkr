import { LegalFooter } from '@/components/legal/legal-footer';
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
 * If there is no user, render `children` WITHOUT the nav. That is the normal
 * case on `/` since R5a (the public home renders its own screen); on every other
 * `(app)` page `proxy.ts` redirects first, and the page's own session gate
 * handles a dead cookie.
 *
 * The legal footer (PR L1) closes every page, with or without the nav: the
 * privacy policy and the terms must stay one click away from any screen.
 */
export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, isProvider } = await getShellCapabilities();

  return (
    <>
      {user ? <Nav isProvider={isProvider} /> : null}
      {children}
      <LegalFooter />
    </>
  );
}
