'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Deposit recovery on a job the provider already holds.
 *
 * It exists because accepting can now end in a 202 — assigned, deposit
 * unsettled — and a state you cannot leave is not an explicit state, it is a
 * dead end with better wording. This is the way out.
 *
 * It uses {@link ConfirmDialog} rather than the direct click of
 * `JobPipelineAction`, and the difference is not stylistic: start / complete are
 * financially INERT, this one charges the client's card. Friction proportional
 * to risk (3.12b) — same reason the accept modal exists.
 *
 * Idempotent server-side: the capture short-circuits on anything but a FAILED
 * deposit, and a retry never creates a second PaymentIntent. Clicking twice
 * cannot charge twice; `pending` is about the UI, not about safety.
 */
export interface RetryDepositActionProps {
  requestId: string;
  /** Request title, shown in the modal so the provider knows which job. */
  title: string;
}

/** Frozen FR fallback for any unmapped status and for network/transport errors. */
const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Maps a relayed API status to FROZEN French copy. Locked convention: the
 * mapping is by HTTP status ALONE — the response body is never parsed.
 *
 * 502 is the case that will actually happen: the card was refused again. Its
 * copy says so plainly and does not promise that waiting will help, because
 * usually only a different card will.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 502:
      return 'Le prélèvement a de nouveau été refusé. Le mandat reste à vous ; le client doit mettre à jour son moyen de paiement.';
    case 409:
      return "Ce mandat n'est plus dans un état où un dépôt s'applique.";
    case 422:
      return "Ce mandat n'a pas de montant estimé : aucun dépôt ne peut être calculé.";
    case 404:
      return "Ce mandat n'est plus accessible.";
    case 403:
      return "Ce mandat ne vous est plus assigné.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}

export function RetryDepositAction({ requestId, title }: RetryDepositActionProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  async function handleConfirm(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`/api/service-requests/${requestId}/retry-deposit`, {
        method: 'POST',
      });
    } catch {
      throw new Error(UNEXPECTED_MESSAGE);
    }

    if (!response.ok) {
      throw new Error(messageForStatus(response.status));
    }

    // The deposit settled: the notice on the card disappears on refresh.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950"
      >
        Relancer le prélèvement
      </button>

      <ConfirmDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Relancer le prélèvement"
        confirmLabel="Relancer"
        onConfirm={handleConfirm}
      >
        <p>
          Nous tenterons de prélever à nouveau le dépôt sur le moyen de paiement
          du client pour&nbsp;:{' '}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {title}
          </span>
          .
        </p>
        <p className="mt-2">
          Le mandat reste à vous quel que soit le résultat.
        </p>
      </ConfirmDialog>
    </>
  );
}
