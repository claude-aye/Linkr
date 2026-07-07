'use client';

import { useEffect } from 'react';

import { DeclineRequestAction } from '@/app/dashboard/_actions/decline-request-action';

/**
 * THROWAWAY dev harness (never part of a real flow) to exercise
 * DeclineRequestAction in isolation in the browser — no backend required.
 *
 * A scoped `window.fetch` mock (installed on mount, restored on unmount)
 * intercepts `/api/service-requests/mock-<code>/decline`. A numeric code replies
 * with that HTTP status after a short delay (so the pending state is
 * observable); the `mock-network` id rejects to simulate a transport failure.
 * Each scenario card encodes its case in the `requestId`, so a single mock drives
 * success + every mapped error + the network fallback.
 *
 * Debt: to be purged at the end of PR 2 (with the accept-action and
 * confirm-dialog harnesses).
 */

const MOCK_LATENCY_MS = 700;

interface Scenario {
  key: string;
  label: string;
  hint: string;
  requestId: string;
}

const scenarios: Scenario[] = [
  {
    key: 'success',
    label: 'Succès (200)',
    hint: 'Le refus réussit → router.refresh() puis le dialogue se ferme de lui-même.',
    requestId: 'mock-200',
  },
  {
    key: 'conflict',
    label: 'Conflit (409)',
    hint: 'Message attendu : « Cette demande n’est plus disponible et ne peut être refusée. Veuillez rafraîchir la page. »',
    requestId: 'mock-409',
  },
  {
    key: 'notfound',
    label: 'Introuvable (404)',
    hint: 'Message attendu : « Cette demande n’est plus accessible. »',
    requestId: 'mock-404',
  },
  {
    key: 'other',
    label: 'Autre statut (500)',
    hint: 'Message fourre-tout attendu : « Une erreur inattendue est survenue… »',
    requestId: 'mock-500',
  },
  {
    key: 'network',
    label: 'Erreur réseau (fetch rejette)',
    hint: 'Même message fourre-tout : « Une erreur inattendue est survenue… »',
    requestId: 'mock-network',
  },
];

export default function DeclineActionHarnessPage() {
  // Install the scoped fetch mock once; restore the real fetch on unmount.
  useEffect(() => {
    const original = window.fetch;
    const mock: typeof window.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      // Simulated transport failure → exercises the fetch try/catch branch.
      if (/\/api\/service-requests\/mock-network\/decline$/.test(url)) {
        await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
        throw new TypeError('Failed to fetch (simulé)');
      }

      const match = url.match(/\/api\/service-requests\/mock-(\d+)\/decline$/);
      if (match) {
        const status = Number(match[1]);
        // Delay so the pending state (spinner + disabled buttons) is visible.
        await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
        return new Response(JSON.stringify({ mocked: true, status }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
    window.fetch = mock;
    return () => {
      window.fetch = original;
    };
  }, []);

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Harnais — DeclineRequestAction
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Page de développement jetable (<code>_dev</code>). <code>fetch</code>{' '}
            est simulé&nbsp;: chaque scénario encode son cas dans le{' '}
            <code>requestId</code> (<code>mock-409</code>,{' '}
            <code>mock-network</code>…). Aucun backend requis.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Le refus est financièrement inerte — aucun mouvement Stripe, donc ni
            502 ni 422 possibles.
          </p>
        </header>

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
              <DeclineRequestAction requestId={s.requestId} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
