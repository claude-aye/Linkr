import Link from 'next/link';

/**
 * The public home (R5a) — what an UNRECOGNISED visitor sees on `/`.
 *
 * A skeleton, enriched in R5b. `(app)/page.tsx` renders it when no user
 * resolves (no cookie, a dead cookie, or the API unreachable); a signed-in
 * user gets the hub instead. The `(app)` layout shows no nav when there is no
 * user, so this component owns its whole screen; the legal footer stays (the
 * layout renders it).
 *
 * Direction A tokens only (CLAUDE.md §13.1 nº 20), no image, no
 * `backdrop-filter`. « Linkr » is a `<p>`, never the `<h1>` (§13.1 nº 24): the
 * page's one heading is the promise.
 *
 * ⚠️ BOTH CALLS TO ACTION GO TO `/signup`. `/recherche` is private (`discover`
 * needs a token): sending « Trouver un pro » there would bounce through `/login`
 * and land on `/`, not on the search. After sign-up the hub's trade tiles are
 * one click from the search, and its « Devenir prestataire » card is the pro's
 * next step. A `?next=` return is tracked debt, not done here.
 */

const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const buttonBase =
  'inline-flex min-h-11 w-full items-center justify-center rounded-2xl px-6 text-base font-medium transition motion-reduce:transition-none sm:w-auto ' +
  focusRing;

export function Landing() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-bg px-4 py-12 sm:px-6 sm:py-20">
      <section className="w-full max-w-2xl text-center">
        <p className="font-script text-[2.5rem] leading-none text-accent sm:text-6xl">Linkr</p>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl">
          Vous avez un besoin&nbsp;? Ils ont du talent à revendre.
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-base text-pretty text-text-muted sm:text-lg">
          De la coiffure à domicile aux travaux spécialisés, trouvez le bon pro dans votre
          quartier.
        </p>

        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className={`${buttonBase} bg-accent text-on-accent hover:bg-accent/90`}
          >
            Trouver un pro
          </Link>
          <Link
            href="/signup"
            className={`${buttonBase} border border-accent text-accent hover:bg-accent/10`}
          >
            Je suis un pro
          </Link>
        </div>

        <p className="mt-6 text-sm text-text-muted">
          Déjà un compte&nbsp;?{' '}
          <Link
            href="/login"
            className={`inline-flex min-h-11 items-center rounded-sm font-medium text-accent underline-offset-2 hover:underline ${focusRing}`}
          >
            Se connecter
          </Link>
        </p>
      </section>
    </main>
  );
}
