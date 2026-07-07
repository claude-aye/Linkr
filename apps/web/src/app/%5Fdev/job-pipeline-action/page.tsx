'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { JobPipelineAction } from '@/app/dashboard/_actions/job-pipeline-action';

/**
 * THROWAWAY dev harness (never part of a real flow) to exercise
 * JobPipelineAction in isolation in the browser — no backend required.
 *
 * Two isolation seams, neither of which mutates anything the platform owns:
 *
 *  1. `window.fetch` — a scoped mock (installed on mount, restored on unmount)
 *     intercepts `/api/service-requests/mock-<code>/(start|complete)`. A numeric
 *     code replies with that HTTP status after a short delay (so the pending
 *     state is observable); the `mock-network` id rejects to simulate a
 *     transport failure. One mock drives success + every mapped error + the
 *     network fallback, for BOTH the start and complete endpoints.
 *
 *  2. A MOCK ROUTER injected via `AppRouterContext.Provider`. The child's
 *     `useRouter()` reads the nearest `AppRouterContext`, so wrapping the cards
 *     in a provider whose `refresh` bumps a visible counter is how the harness
 *     PROVES the behavior — a 409 (and a success) must bump the counter; a 404 /
 *     500 / network error must NOT. We provide our own router object rather than
 *     mutate the real one (React 19 forbids modifying a hook's return value —
 *     `react-hooks/immutability`).
 *
 * Debt: to be purged at the end of PR 2 (with the confirm-dialog, accept-action
 * and decline-action harnesses).
 */

const MOCK_LATENCY_MS = 700;

interface Scenario {
  key: string;
  label: string;
  hint: string;
  /** Drives which button renders (ASSIGNED → Démarrer, IN_PROGRESS → Compléter). */
  status: string;
  /** Encodes the mocked HTTP outcome (`mock-200`, `mock-409`, `mock-network`…). */
  requestId: string;
}

const scenarios: Scenario[] = [
  {
    key: 'start-success',
    label: 'Démarrer · Succès (200)',
    hint: 'Statut ASSIGNED → bouton « Démarrer ». Succès → router.refresh() (le compteur monte de 1), pas d’erreur.',
    status: 'ASSIGNED',
    requestId: 'mock-200',
  },
  {
    key: 'complete-success',
    label: 'Compléter · Succès (200)',
    hint: 'Statut IN_PROGRESS → bouton « Compléter ». Succès → router.refresh() (le compteur monte de 1), pas d’erreur.',
    status: 'IN_PROGRESS',
    requestId: 'mock-200',
  },
  {
    key: 'conflict',
    label: 'Démarrer · Conflit (409)',
    hint: 'Message attendu : « Ce mandat n’est plus dans l’état attendu. La page va être actualisée. » ET router.refresh() déclenché (le compteur monte).',
    status: 'ASSIGNED',
    requestId: 'mock-409',
  },
  {
    key: 'notfound',
    label: 'Compléter · Introuvable (404)',
    hint: 'Message attendu : « Ce mandat n’est plus accessible. » — SANS refresh (le compteur ne bouge pas).',
    status: 'IN_PROGRESS',
    requestId: 'mock-404',
  },
  {
    key: 'other',
    label: 'Démarrer · Autre statut (500)',
    hint: 'Message fourre-tout attendu : « Une erreur inattendue est survenue… » — SANS refresh (le compteur ne bouge pas).',
    status: 'ASSIGNED',
    requestId: 'mock-500',
  },
  {
    key: 'network',
    label: 'Compléter · Erreur réseau (fetch rejette)',
    hint: 'Même message fourre-tout : « Une erreur inattendue est survenue… » — SANS refresh (le compteur ne bouge pas).',
    status: 'IN_PROGRESS',
    requestId: 'mock-network',
  },
  {
    key: 'noop',
    label: 'Statut non concerné (COMPLETED)',
    hint: 'Le composant ne rend RIEN (aucun bouton ci-contre) — c’est le résultat attendu.',
    status: 'COMPLETED',
    requestId: 'mock-should-not-fire',
  },
];

export default function JobPipelineActionHarnessPage() {
  const [refreshCount, setRefreshCount] = useState(0);

  // Mock router injected below via AppRouterContext.Provider. Only `refresh` is
  // meaningful (bumps the counter); the rest are inert no-ops. Stable identity.
  const mockRouter = useMemo<AppRouterInstance>(
    () => ({
      back: () => {},
      forward: () => {},
      refresh: () => setRefreshCount((n) => n + 1),
      push: () => {},
      replace: () => {},
      prefetch: () => {},
    }),
    [],
  );

  // Scoped fetch mock: install on mount, restore the real fetch on unmount.
  useEffect(() => {
    const originalFetch = window.fetch;
    const mock: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      // Simulated transport failure → exercises the fetch try/catch branch.
      if (
        /\/api\/service-requests\/mock-network\/(?:start|complete)$/.test(url)
      ) {
        await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
        throw new TypeError('Failed to fetch (simulé)');
      }

      const match = url.match(
        /\/api\/service-requests\/mock-(\d+)\/(?:start|complete)$/,
      );
      if (match) {
        const status = Number(match[1]);
        // Delay so the pending state (spinner + disabled button) is visible.
        await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
        return new Response(JSON.stringify({ mocked: true, status }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    };
    window.fetch = mock;
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Harnais — JobPipelineAction
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Page de développement jetable (<code>_dev</code>). <code>fetch</code>{' '}
            est simulé&nbsp;: chaque scénario encode son statut HTTP cible dans le{' '}
            <code>requestId</code> (<code>mock-409</code>, <code>mock-network</code>
            …). Le bouton affiché dépend du <code>status</code> passé au composant
            (ASSIGNED → « Démarrer », IN_PROGRESS → « Compléter »). Aucun backend
            requis.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Ces transitions sont financièrement inertes — aucun mouvement Stripe,
            donc ni 502 ni 422&nbsp;: seuls 409 / 404 sont mappés, le reste
            retombe sur le message fourre-tout.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              <code>router.refresh()</code> appelé&nbsp;:{' '}
              <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {refreshCount}
              </span>{' '}
              fois
            </span>
            <button
              type="button"
              onClick={() => setRefreshCount(0)}
              className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Réinitialiser le compteur
            </button>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Succès &amp; 409 le font monter&nbsp;; 404 / 500 / réseau NON.
            </span>
          </div>
        </header>

        {/* Inject the mock router: the child's useRouter() reads this provider. */}
        <AppRouterContext.Provider value={mockRouter}>
          <ul className="space-y-3">
            {scenarios.map((s) => (
              <li
                key={s.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {s.label}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    {s.hint}
                  </p>
                </div>
                <JobPipelineAction requestId={s.requestId} status={s.status} />
              </li>
            ))}
          </ul>
        </AppRouterContext.Provider>
      </section>
    </main>
  );
}
