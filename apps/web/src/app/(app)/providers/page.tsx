/**
 * « Trouver un pro » — stub (Phase 3.13-PR2).
 *
 * Placeholder so the shared nav is testable end-to-end. Real provider discovery
 * / search lands in phase 3.13 (tâche 2), then geo discovery in 3.14 — this file
 * will be REPLACED, not extended here. No listing, no search, no geo call yet.
 */
export default function ProvidersPage() {
  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Trouver un pro
          </h1>
        </header>
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            Bientôt disponible.
          </p>
          <p className="mt-1">
            La recherche de prestataires arrive à la phase 3.13 (tâche&nbsp;2).
          </p>
        </div>
      </section>
    </main>
  );
}
