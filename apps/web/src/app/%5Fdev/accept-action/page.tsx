'use client';

import { useEffect } from 'react';

import { AcceptRequestAction } from '@/app/dashboard/_actions/accept-request-action';

/**
 * THROWAWAY dev harness (never part of a real flow) to exercise
 * AcceptRequestAction in isolation in the browser — no backend required.
 *
 * A scoped `window.fetch` mock (installed on mount, restored on unmount)
 * intercepts `/api/service-requests/mock-<code>/accept` and replies with that
 * HTTP status after a short delay (so the pending state is observable). Each
 * scenario card encodes its target status in the `requestId`, so a single mock
 * drives success + every mapped error. The null-amount card fires NO request:
 * the confirm button is disabled and the business guard refuses.
 *
 * Debt: to be purged at the end of PR 2 (with the confirm-dialog harness).
 */

const MOCK_LATENCY_MS = 700;

interface Scenario {
  key: string;
  label: string;
  hint: string;
  amount: string | null;
  currency: string | null;
  requestId: string;
}

const scenarios: Scenario[] = [
  {
    key: 'success',
    label: 'Succès (200)',
    hint: 'Le dépôt réussit → router.refresh() puis le dialogue se ferme de lui-même.',
    amount: '120.00',
    currency: 'CAD',
    requestId: 'mock-200',
  },
  {
    key: 'conflict',
    label: 'Conflit (409)',
    hint: 'Message attendu : « Cette demande n’est plus disponible ou un problème de paiement… »',
    amount: '250.00',
    currency: 'CAD',
    requestId: 'mock-409',
  },
  {
    key: 'gateway',
    label: 'Passerelle (502)',
    hint: 'Message attendu : « Le prélèvement du dépôt a échoué. Veuillez réessayer… »',
    amount: '80.50',
    currency: 'CAD',
    requestId: 'mock-502',
  },
  {
    key: 'notfound',
    label: 'Introuvable (404)',
    hint: 'Message attendu : « Cette demande n’est plus accessible. »',
    amount: '999.00',
    currency: 'CAD',
    requestId: 'mock-404',
  },
  {
    key: 'other',
    label: 'Autre statut (500)',
    hint: 'Message fourre-tout attendu : « Une erreur inattendue est survenue… »',
    amount: '42.00',
    currency: 'CAD',
    requestId: 'mock-500',
  },
  {
    key: 'noamount',
    label: 'Sans montant estimé (null)',
    hint: 'Avertissement affiché + bouton « Accepter » de la modale désactivé — aucun appel réseau.',
    amount: null,
    currency: null,
    requestId: 'mock-should-not-fire',
  },
];

export default function AcceptActionHarnessPage() {
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
      const match = url.match(/\/api\/service-requests\/mock-(\d+)\/accept$/);
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
            Harnais — AcceptRequestAction
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Page de développement jetable (<code>_dev</code>). <code>fetch</code>{' '}
            est simulé&nbsp;: chaque scénario encode son statut HTTP cible dans le{' '}
            <code>requestId</code> (<code>mock-409</code>…). Aucun backend requis.
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Le taux/montant du dépôt (20&nbsp;%) n&apos;est jamais affiché — seul le
            total estimé l&apos;est.
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
              <AcceptRequestAction
                requestId={s.requestId}
                title="Réparer un robinet qui fuit"
                clientDisplayName="Marie Tremblay"
                serviceAddress="1234 rue Sainte-Catherine O, Montréal, QC H3G 1P1"
                estimatedAmount={s.amount}
                estimatedCurrency={s.currency}
              />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
