/**
 * `(auth)` route-group layout — neutral pass-through (Phase 3.13-PR1).
 *
 * A route group `(auth)` adds NO URL segment and, here, NO markup. Only the root
 * layout (`app/layout.tsx`) owns `<html>`/`<body>` and the global stylesheet; a
 * nested layout that re-declared them would emit a second document. This group is
 * the auth surface (sign-in), deliberately OUTSIDE the shared app nav shell. It
 * renders its children verbatim so behaviour is byte-for-byte unchanged.
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
