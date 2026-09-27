import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';

import type { MyReview } from '@/lib/reviews/types';

import { RequestCard, type ClientRequest } from './_components/request-card';

// Reads the access cookie + the client's live requests — rendered per request.
export const dynamic = 'force-dynamic';

/**
 * Server-side split (Option A, pagination deferred — same debt as the provider
 * dashboard: a single `?limit=100` page carries both sections). « En cours »
 * groups the live statuses; everything else falls into « Terminées ».
 */
const ACTIVE_STATUSES = new Set<ClientRequest['status']>([
  'DRAFT',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
]);

function Section({
  title,
  requests,
  reviews,
}: {
  title: string;
  requests: ClientRequest[];
  reviews: Map<string, MyReview>;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <ul className="space-y-4">
        {requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            review={reviews.get(request.id) ?? null}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Set by the tender form after a successful publication (PR 1b). A plain query
 * flag read by this Server Component — the list itself is the proof, the banner
 * only says so.
 */
const PUBLISHED_TENDER_FLAG = 'appel-offres';

/**
 * Set by « Devis reçus » after an accepted quote (PR 4b), one flag per HTTP
 * success the API can answer. The two are NOT the same news: on 202 the job is
 * the provider's but the deposit was not taken, and this banner is the ONLY
 * place the client is told — the request card has no deposit field (the client
 * DTO carries none). No retry button: `retry-deposit` is the assigned
 * provider's, a client would get 403.
 */
const QUOTE_ACCEPTED_FLAG = 'accepte';
const QUOTE_ACCEPTED_DEPOSIT_FAILED_FLAG = 'acompte-en-echec';

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ publie?: string | string[]; devis?: string | string[] }>;
}) {
  // Session gate — `redirect` throws, so it runs OUTSIDE any try/catch. The page
  // is PRIVATE (under `(app)`): an expired session must not render.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { publie, devis } = await searchParams;
  const justPublishedTender = publie === PUBLISHED_TENDER_FLAG;
  const quoteAccepted = devis === QUOTE_ACCEPTED_FLAG;
  const quoteAcceptedDepositFailed = devis === QUOTE_ACCEPTED_DEPOSIT_FAILED_FLAG;

  const client = await getServerApiClient();

  // ONE call, no `status` filter — the server splits the single page in two.
  // The pagination envelope is typed NATIVELY by `ServiceRequestListDto`
  // (PR A / #42): `data.items` / `data.total` / … carry no local cast.
  let requests: ClientRequest[] | null = null;
  try {
    const { data, error, response } = await client.GET('/service-requests', {
      params: { query: { limit: 100 } },
    });
    if (!error && response.ok && data && Array.isArray(data.items)) {
      requests = data.items;
    }
  } catch {
    requests = null;
  }

  /**
   * The caller's own reviews, in ONE call, joined against the page by request id
   * — never one lookup per card.
   *
   * ⚠️ THIS READ IS WHAT MAKES « SEE » AND « RETRACT » SURVIVE A RELOAD. The
   * public review item deliberately carries neither the request id nor an author
   * id, so nothing else can tell a client which review is theirs; without this,
   * the id would live only in the POST response and the right of retraction
   * (D-3) would last exactly one page view.
   *
   * Degraded on its own: a failure here empties the map, so every finished job
   * shows the form instead of the review. That is the honest degradation — the
   * API still answers 409 on a duplicate — and it must never blank the whole
   * page, which is why it has its own try/catch and never touches `requests`.
   * The envelope AND its items are typed natively — no mirror, no cast.
   */
  const reviews = new Map<string, MyReview>();
  try {
    const { data, error, response } = await client.GET('/reviews/mine', {});
    if (!error && response.ok && data && Array.isArray(data.items)) {
      for (const review of data.items) {
        reviews.set(review.serviceRequestId, review);
      }
    }
  } catch {
    // Map stays empty — see above.
  }

  // API guarantees `created_at DESC` — `filter` preserves that order per section.
  const active = requests?.filter((r) => ACTIVE_STATUSES.has(r.status)) ?? [];
  const done = requests?.filter((r) => !ACTIVE_STATUSES.has(r.status)) ?? [];
  const isEmpty = requests !== null && active.length === 0 && done.length === 0;

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mes demandes
          </h1>
          {/* The ONE entry to the tender form. Rendered in every state below —
              an empty list or a failed read must not hide the way to publish. */}
          <Link
            href="/requests/new-tender"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"
          >
            Publier un appel d’offres
          </Link>
        </header>

        {justPublishedTender && (
          // Plain text, no `role="alert"`: the navigation already moved the
          // user here, this is a displayed state, not an action error.
          <p className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Votre appel d’offres est publié. Les prestataires qui couvrent votre secteur en
            sont avisés et peuvent vous envoyer un devis jusqu’à la date limite.
          </p>
        )}

        {quoteAccepted && (
          <p className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Devis accepté. L’acompte a été prélevé.
          </p>
        )}

        {quoteAcceptedDepositFailed && (
          <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Le devis est accepté et le travail est confié au prestataire. Toutefois, le
            prélèvement de l’acompte a échoué. Vérifiez votre{' '}
            <Link href="/account/payment-methods" className="font-medium underline underline-offset-2">
              moyen de paiement
            </Link>{' '}
            ; le prestataire pourra relancer le prélèvement depuis son espace.
          </p>
        )}

        {requests === null ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Chargement impossible
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Vos demandes n’ont pas pu être récupérées. Veuillez réessayer plus tard.
            </p>
          </div>
        ) : isEmpty ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">
              Vous n’avez pas encore de demande.
            </p>
            <p className="mt-1">
              <Link
                href="/"
                className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                Trouver un prestataire
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* A section header renders only when its bucket has ≥1 item — no
                orphan « Terminées » heading above an empty list. */}
            {active.length > 0 && (
              <Section title="En cours" requests={active} reviews={reviews} />
            )}
            {done.length > 0 && (
              <Section title="Terminées" requests={done} reviews={reviews} />
            )}
          </div>
        )}
      </section>
    </main>
  );
}
