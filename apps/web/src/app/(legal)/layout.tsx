import Link from 'next/link';

/**
 * `(legal)` route-group layout — the four legal pages (PR L1).
 *
 * A route group adds NO URL segment: the pages answer at `/confidentialite`,
 * `/conditions`, `/privacy` and `/terms`. Only the root layout owns
 * `<html>`/`<body>`; this one adds a bare header and nothing else.
 *
 * ⚠️ NO APP NAV, DELIBERATELY. These pages are read by anonymous visitors as
 * much as by signed-in users, and the `(app)` nav resolves a session on every
 * request. A document to read wants a quiet frame; the footer (rendered by each
 * page, in the page's language) carries the links back.
 *
 * ⚠️ THESE PATHS MUST STAY IN `LEGAL_PATHS` (`lib/legal/legal-pages.ts`), which
 * `proxy.ts` lets through BEFORE its public-pages branch — otherwise an
 * anonymous visitor is bounced to `/login`, and a signed-in one to
 * `/dashboard`.
 */
export default function LegalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-900">
        <Link
          href="/"
          className="-mx-2 inline-flex min-h-11 items-center px-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          Linkr
        </Link>
      </header>
      {children}
    </>
  );
}
