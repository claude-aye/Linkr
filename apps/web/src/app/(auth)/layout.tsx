import { LegalFooter } from '@/components/legal/legal-footer';

/**
 * `(auth)` route-group layout (Phase 3.13-PR1, direction A in R4).
 *
 * A route group `(auth)` adds NO URL segment. Only the root layout
 * (`app/layout.tsx`) owns `<html>`/`<body>` and the global stylesheet; a nested
 * layout that re-declared them would emit a second document. This group is the
 * auth surface (sign-in), deliberately OUTSIDE the shared app nav shell.
 *
 * Since R4 this layout owns the `<main>` of the four screens: the beige ground
 * (`bg-bg`, the same as the legal footer's, so no band separates them), the
 * decorative halos, and the « Linkr » mark above the card. Each page renders
 * its card only, with its own single `<h1>`.
 *
 * The legal footer (PR L1): the sign-up screen is where a visitor decides to
 * hand over their email, so the privacy policy and the terms must be one click
 * away from it. `<main>` is `flex-1`, so the footer sits at the bottom of the
 * viewport on short screens.
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {/* `isolate` keeps the halos' negative z-index inside this screen. The
          halos' own wrapper carries `overflow-hidden` rather than `<main>`: on
          a flex item, `overflow-hidden` turns `min-height: auto` into 0, and a
          tall form (/signup on a phone, keyboard open) could then be clipped
          instead of making the page scroll. */}
      <main className="relative isolate flex flex-1 flex-col items-center justify-center bg-bg px-4 py-8 sm:p-6">
        {/* Decorative halos, beige → bordeaux. Plain CSS (`filter: blur`), no
            animation, and NOT a `backdrop-filter`: the card stays the screen's
            only one. Kept away from the bottom edge so the footer's hairline
            never cuts through a halo. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute top-1/4 -left-40 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        {/* The brand, never an `<h1>`: each screen's one heading is its form's
            title. Plain text for now, not a link. */}
        <p className="mb-6 font-script text-6xl leading-none text-accent">Linkr</p>

        {children}
      </main>
      <LegalFooter />
    </>
  );
}
