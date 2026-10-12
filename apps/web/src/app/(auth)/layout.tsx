import { LegalFooter } from '@/components/legal/legal-footer';

/**
 * `(auth)` route-group layout (Phase 3.13-PR1).
 *
 * A route group `(auth)` adds NO URL segment. Only the root layout
 * (`app/layout.tsx`) owns `<html>`/`<body>` and the global stylesheet; a nested
 * layout that re-declared them would emit a second document. This group is the
 * auth surface (sign-in), deliberately OUTSIDE the shared app nav shell.
 *
 * Its only markup is the legal footer (PR L1): the sign-up screen is where a
 * visitor decides to hand over their email, so the privacy policy and the terms
 * must be one click away from it. Each page's `<main>` is `flex-1`, so the
 * footer sits at the bottom of the viewport on short screens.
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <LegalFooter />
    </>
  );
}
