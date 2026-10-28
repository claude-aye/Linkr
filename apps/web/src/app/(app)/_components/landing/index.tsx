import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { ProSection } from './pro-section';
import { Trades } from './trades';
import { Trust } from './trust';

/**
 * The public home (R5a skeleton, R5b full page) — what an UNRECOGNISED visitor
 * sees on `/`. `(app)/page.tsx` renders it when no user resolves; a signed-in
 * user gets the hub. The `(app)` layout shows no nav without a user, so this
 * owns its whole screen; the legal footer stays (the layout renders it).
 *
 * Direction A tokens only (CLAUDE.md §13.1 nº 20). « Linkr » is a `<p>`,
 * never the `<h1>` (§13.1 nº 24): the one `<h1>` is the hero tagline, and each
 * section has one `<h2>`. ONE `backdrop-filter` on the page: the hero panel.
 * Images: pre-optimised AVIF/WebP files, metadata stripped (§13.1 nº 26).
 *
 * ⚠️ EVERY CALL TO ACTION GOES TO `/signup` (or `/login`). `/recherche` is
 * private: a direct link would bounce through `/login` and land back on `/`.
 * Nothing here promises a search or a profile reachable without an account.
 */
export function Landing() {
  return (
    <main className="flex flex-1 flex-col bg-bg">
      <Hero />
      <Trades />
      <HowItWorks />
      <Trust />
      <ProSection />
    </main>
  );
}
