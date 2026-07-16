/**
 * « Mes demandes » — CLIENT-side stub (Phase 3.13-PR2).
 *
 * Placeholder so the shared nav is testable end-to-end. The real client request
 * list lands in phase 3.13 (tâche 4) — this file will be REPLACED there. No data
 * yet, no fake rows.
 *
 * NB: this is the CLIENT list at `/requests`. It is distinct from the PROVIDER
 * stub at `/dashboard/requests/[id]` — do not conflate the two.
 */
export default function RequestsPage() {
  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mes demandes
          </h1>
        </header>
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            Bientôt disponible.
          </p>
          <p className="mt-1">
            Le suivi de vos demandes arrive à la phase 3.13 (tâche&nbsp;4).
          </p>
        </div>
      </section>
    </main>
  );
}
