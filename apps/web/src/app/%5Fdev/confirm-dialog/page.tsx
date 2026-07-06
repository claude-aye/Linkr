'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * THROWAWAY dev harness (never part of a real flow) to exercise ConfirmDialog
 * in isolation in the browser. Two demos: one that resolves after ~1s (the
 * dialog closes) and one that rejects after ~1s (the dialog stays open and
 * shows the French error). Both prove the pending state during the await.
 */
type Demo = 'success' | 'failure';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function ConfirmDialogHarnessPage() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const isSuccess = demo === 'success';

  async function handleConfirm() {
    // Wait ~1s so the pending state (disabled buttons + spinner) is observable.
    await sleep(1000);
    if (demo === 'failure') {
      // Message already in French — ConfirmDialog shows it verbatim.
      throw new Error("Message d'erreur de test en français.");
    }
    // Resolve → ConfirmDialog calls onClose and the dialog closes.
  }

  const buttonClass =
    'rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200';

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Harnais — ConfirmDialog
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Page de développement jetable (<code>_dev</code>). Elle ne fait
            partie d&apos;aucun flux réel — elle sert uniquement à valider le
            composant isolément.
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setDemo('success')}
            className={buttonClass}
          >
            Confirmer (succès)
          </button>
          <button
            type="button"
            onClick={() => setDemo('failure')}
            className={buttonClass}
          >
            Confirmer (échec)
          </button>
        </div>

        <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
          Chaque démo attend ~1&nbsp;s avant de résoudre ou rejeter. Pendant
          l&apos;attente, les boutons du dialogue sont désactivés (état
          <span className="font-medium"> pending</span>) et Échap/overlay sont
          neutralisés.
        </p>
      </section>

      <ConfirmDialog
        isOpen={demo !== null}
        onClose={() => setDemo(null)}
        title={isSuccess ? 'Démo — succès' : 'Démo — échec'}
        confirmLabel="Confirmer"
        onConfirm={handleConfirm}
      >
        {isSuccess ? (
          <p>
            À la confirmation, l&apos;action attend ~1&nbsp;s puis{' '}
            <span className="font-medium">résout</span> : le dialogue se ferme.
          </p>
        ) : (
          <p>
            À la confirmation, l&apos;action attend ~1&nbsp;s puis{' '}
            <span className="font-medium">rejette</span> : le dialogue reste
            ouvert et affiche le message d&apos;erreur ci-dessous.
          </p>
        )}
      </ConfirmDialog>
    </main>
  );
}
