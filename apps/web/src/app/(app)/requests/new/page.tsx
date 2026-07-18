import Link from 'next/link';

/**
 * « Nouvelle demande » — stub (Phase 3.13-2-front).
 *
 * Sole purpose: make the provider-profile « Demander » CTA testable end to end.
 * Echoing the two search params PROVES the link carries the right ids, and
 * gives task 3 a page to FILL rather than to create.
 *
 * STRICT bounds (do NOT extend here — that is task 3): no form, no field, no
 * fetch, no POST, no validation, no `'use client'`. The real booking form
 * re-reads the API from these ids to derive money (the price never travels
 * through the URL — `estimatedAmount` is unchecked on the backend).
 */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string; serviceId?: string }>;
}) {
  const { providerId, serviceId } = await searchParams;

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Nouvelle demande
          </h1>
        </header>

        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">Bientôt disponible.</p>
          <p className="mt-1">
            Le formulaire arrive à la phase 3.13 (tâche&nbsp;3).
          </p>

          <dl className="mt-6 space-y-2 text-left">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                providerId
              </dt>
              <dd className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                {providerId ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                serviceId
              </dt>
              <dd className="mt-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                {serviceId ?? '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/providers"
            className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            ← Trouver un pro
          </Link>
        </div>
      </section>
    </main>
  );
}
