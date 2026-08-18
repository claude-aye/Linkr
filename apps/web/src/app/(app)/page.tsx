import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerApiClient } from '@/lib/auth/session';
import { tradesOfferedAtLaunch } from '@/lib/catalog/launch-scope';
import { pickTranslation } from '@/lib/i18n/translations';
import { getShellCapabilities } from '@/lib/nav/capabilities';
import type { CategoryOption } from '@/lib/providers/discovery-types';

// Reads the session cookie — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * Client hub — the post-login landing (Phase 3.13-PR2), turned into a
 * TRADE-FIRST entry point in chantier H.
 *
 * ⚠️ THE ORDER OF THE PAGE IS THE POINT, NOT DECORATION. Until H, finding a pro
 * meant: open `/recherche`, pick a trade in a `<select>`, then locate yourself.
 * That is the order of the DATABASE (a category is a foreign key), not the order
 * of the client's head — they arrive with « mon lavabo coule », not with a
 * taxonomy. H puts the trade first, on the page every session lands on.
 *
 * ⚠️ TILES, NOT A DROPDOWN — A MEASURED DECISION. SQL probe on the real stack:
 * the catalog holds exactly **7** active categories (3 REGULATED, 4 INFORMAL), of
 * which **4** are offered here (see below). A handful of trades fit on one screen
 * as tappable tiles; seventy would not, and would need a `<select>` or a search
 * field. If the catalog ever outgrows a screen, THAT is when to revisit this
 * shape — re-run the count, do not guess.
 *
 * ⚠️ ONLY THE TRADES OFFERED AT LAUNCH ARE TILED — the regulated ones are gone.
 * This REVERSES the H-tranche-1 decision recorded here (« every trade is shown and
 * every trade is clickable »), and the reversal is deliberate: that call assumed a
 * regulated search merely lands on an honest empty state, which is true but
 * incomplete. No provider can supply a regulated trade at all today — the
 * dashboard selector hard-blocks the declaration and no upload screen exists — so
 * those three tiles were three doors that could never open. The reason and the
 * one line that reopens them live in `lib/catalog/launch-scope.ts`.
 *
 * The route is NOT closed, only the entry: `/recherche?categoryId=<regulated>`
 * from a bookmark or a shared link still renders the honest empty state, which is
 * why the filter is applied to the OFFERED list and never to the lookup set.
 * There is deliberately NO « bientôt disponible » on the removed trades: a promise
 * with no date and no way to follow up is a debt owed to the user (demand capture,
 * H tranche 2, is the right home for it and does not exist yet).
 *
 * A tile carries ONLY `?categoryId=` — no coordinates. That is the existing URL
 * joint (`/recherche` STATE 0), so this reuses the 3.13/3.14 chain instead of
 * opening a parallel path: trade → `/recherche` → locate → discover → profile →
 * booking.
 */
export default async function HubPage() {
  const { user, isProvider } = await getShellCapabilities();

  // Session gate (defence-in-depth — proxy.ts redirects first). `redirect`
  // throws, so it is called outside any try/catch.
  if (!user) {
    redirect('/login');
  }

  const firstName =
    user.firstName?.trim() || user.displayName?.trim() || user.email;

  const trades = await loadTrades();

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Bonjour, {firstName}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Que souhaitez-vous faire aujourd’hui&nbsp;?
          </p>
        </header>

        {/* Trade-first entry. Renders nothing at all when the catalog read fails
            — the hub keeps routing (the cards below are unaffected) rather than
            showing an error the visitor cannot act on. */}
        {trades.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Quel service vous faut-il&nbsp;?
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Choisissez un métier, puis indiquez où vous êtes.
            </p>

            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {trades.map((trade) => (
                <li key={trade.id}>
                  <Link
                    href={`/recherche?categoryId=${trade.id}`}
                    className="flex min-h-[3.5rem] items-center rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-700"
                  >
                    {trade.label}
                  </Link>
                </li>
              ))}
            </ul>

            {/* The generic entry SURVIVES, demoted from a card to an escape
                hatch: the tiles are the fast path, `/recherche` is still the full
                form (any trade + « Près de moi » + address). Same label and same
                destination as the nav link — kept identical on purpose. */}
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              Vous cherchez autre chose&nbsp;?{' '}
              <Link
                href="/recherche"
                className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                Trouver un pro
              </Link>
            </p>
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <HubCard
            href="/requests"
            title="Mes demandes"
            description="Suivez vos réservations et vos projets en cours."
          />
          {/* Card for the OTHER side of the marketplace, shown only to a session
              that is not a provider yet — the mirror image of the dashboard
              shortcut below. It reuses `isProvider`, ALREADY resolved above: no
              extra request (`GET /service-providers/me` has two call sites — the
              shell helper this page shares with the layout, and the dashboard —
              and this adds no third one). */}
          {!isProvider && (
            <HubCard
              href="/providers/new"
              title="Devenir prestataire"
              description="Créez votre profil pour offrir vos services et recevoir des demandes."
            />
          )}
        </div>

        {isProvider && (
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Accéder à mon espace pro →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * The trades OFFERED at launch, ordered, with labels resolved in the reader's
 * locale.
 *
 * Read SERVER-SIDE with the shared client — the same call `/recherche` already
 * makes, and both surfaces narrow it through the SAME
 * `tradesOfferedAtLaunch`, so the two trade lists can never show different sets.
 * `pickTranslation` keeps a UUID off the screen; a category with an empty map
 * resolves to `—` rather than throwing.
 *
 * Defensive by design: ANY failure (5xx, network, a non-array body) yields an
 * empty list and the trade section simply does not render. The hub must keep
 * routing even when the catalog is down — it is the page every session lands on.
 */
async function loadTrades(): Promise<Array<{ id: string; label: string }>> {
  const client = await getServerApiClient();
  try {
    // `GET /service-categories` ships no response schema (`content: never`) and
    // returns a bare array — read through the minimal shared `CategoryOption`,
    // the same mirror `/recherche` and « Mes métiers » use.
    const { data, error, response } = await client.GET('/service-categories');
    if (error || !response.ok || !Array.isArray(data)) return [];

    // Launch scope: informal trades only. The hub has no lookup duty (it only
    // OFFERS), so unlike `/recherche` it can narrow the list right here.
    return tradesOfferedAtLaunch(data as unknown as CategoryOption[])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({
        id: category.id,
        label: pickTranslation(category.nameTranslations),
      }));
  } catch {
    return [];
  }
}

function HubCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
        <span
          aria-hidden
          className="ml-1 inline-block transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
    </Link>
  );
}
