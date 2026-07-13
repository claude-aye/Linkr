/**
 * `(app)` route-group layout — neutral pass-through (Phase 3.13-PR1).
 *
 * A route group `(app)` adds NO URL segment and, here, NO markup. Only the root
 * layout (`app/layout.tsx`) owns `<html>`/`<body>` and the global stylesheet; a
 * nested layout that re-declared them would emit a second document. This group is
 * the shared authenticated shell (provider dashboard + admin today, the future
 * role-conditional nav). For this restructure it stays a strict pass-through —
 * the shared chrome is wired in a later 3.13 PR — so behaviour is unchanged.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
