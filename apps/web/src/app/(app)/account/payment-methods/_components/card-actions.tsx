'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * The two moves available on a saved card: promote it, or remove it.
 *
 * Both go through the BFF relays and both end in `router.refresh()` — the list
 * is a Server Component and stays the source of truth. Nothing here mirrors
 * server state locally: there is no optimistic badge move, because the API
 * decides which row ends up default (notably on a removal, where it promotes
 * the most recent survivor).
 *
 * ⚠️ « Définir par défaut » IS ABSENT ON THE CURRENT DEFAULT, not disabled. A
 * greyed button on the one card that already carries the badge is a dead
 * control that invites a click and answers nothing.
 *
 * ⚠️ REMOVAL IS CONFIRMED, PROMOTION IS NOT. Deleting a card is irreversible
 * and re-entering it is a chore; promoting one is a single click to undo. The
 * dialog names the card it is about to remove — « Visa •••• 4242 » — because a
 * wallet of same-brand cards is otherwise indistinguishable at a glance.
 *
 * Messages are mapped by HTTP STATUS ALONE (locked since 3.12b) — the relayed
 * body is never parsed, and no Stripe wording ever reaches the screen.
 */

const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 403:
    case 404:
      // Both mean « this card is not yours to act on any more ». The page is
      // one refresh away from showing the truth.
      return "Ce moyen de paiement n'est plus accessible. Veuillez rafraîchir la page.";
    case 502:
      return 'Le service de paiement est momentanément indisponible. Veuillez réessayer dans quelques minutes.';
    default:
      return UNEXPECTED_MESSAGE;
  }
}

export interface CardActionsProps {
  id: string;
  isDefault: boolean;
  /** « Visa •••• 4242 » — what the removal dialog must name. */
  summary: string;
}

export function CardActions({ id, isDefault, summary }: CardActionsProps) {
  const router = useRouter();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: 'POST' | 'DELETE'): Promise<void> {
    let response: Response;
    try {
      // Same BFF channel as every other mutation: same-origin, cookies sent.
      response = await fetch(path, { method });
    } catch {
      throw new Error(UNEXPECTED_MESSAGE);
    }
    if (!response.ok) {
      throw new Error(messageForStatus(response.status));
    }
    router.refresh();
  }

  async function setAsDefault() {
    setError(null);
    setPending(true);
    try {
      await call(`/api/payment-methods/${id}/default`, 'POST');
    } catch (err) {
      setError(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex flex-wrap gap-2">
        {!isDefault && (
          <button
            type="button"
            onClick={setAsDefault}
            disabled={pending}
            aria-busy={pending}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Définir par défaut
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmingRemoval(true)}
          disabled={pending}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Supprimer
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ConfirmDialog
        isOpen={confirmingRemoval}
        onClose={() => setConfirmingRemoval(false)}
        title="Supprimer ce moyen de paiement"
        confirmLabel="Supprimer"
        // Resolving is what closes it — ConfirmDialog calls `onClose` itself.
        onConfirm={() => call(`/api/payment-methods/${id}`, 'DELETE')}
      >
        <p>
          <strong>{summary}</strong> sera retirée de votre compte. Vous pourrez
          l’enregistrer à nouveau plus tard.
        </p>
        {isDefault && (
          <p className="mt-2">
            C’est votre moyen de paiement par défaut : une autre carte
            enregistrée prendra automatiquement le relais. S’il n’en reste
            aucune, vous devrez en ajouter une avant votre prochaine demande.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
