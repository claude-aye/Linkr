'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Decline action for an OPEN direct booking targeted at the provider (Phase B,
 * PR 2 — second consumer of {@link ConfirmDialog}).
 *
 * Declining is financially INERT: server-side it moves the request
 * OPEN→CANCELLED with NO Stripe movement. So the confirmation is intentionally
 * LIGHT — a single sentence, no amount/address/client — friction proportional to
 * the (nil) financial risk. The action is irreversible but debits nothing.
 *
 * Mirrors {@link AcceptRequestAction}'s shape (button → isOpen → ConfirmDialog →
 * onConfirm → router.refresh()) in a stripped-down form: it reads nothing (no
 * fetch for display) and needs only the request id.
 */
export interface DeclineRequestActionProps {
  requestId: string;
}

/** Frozen FR fallback for any unmapped status and for network/transport errors. */
const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Maps a relayed API status to the FROZEN French copy (see PR spec). Decision is
 * locked: mapping is by HTTP status ALONE — the response body is never parsed.
 *
 * Only 409 and 404 are mapped: a decline touches no Stripe (no 502) and needs no
 * amount (no 422), so those codes cannot arise from this transition. Everything
 * else — including a BFF 502 on transport failure — falls through to the generic
 * copy; we never map a code that cannot occur here.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 409:
      return "Cette demande n'est plus disponible et ne peut être refusée. Veuillez rafraîchir la page.";
    case 404:
      return "Cette demande n'est plus accessible.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}

export function DeclineRequestAction({ requestId }: DeclineRequestActionProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  async function handleConfirm(): Promise<void> {
    let response: Response;
    try {
      // Same BFF channel as accept-request-action.tsx: same-origin POST, cookies
      // sent. NO body — the decline carries no reason at this step (the API's
      // optional `reason` is deliberately unused).
      response = await fetch(`/api/service-requests/${requestId}/decline`, {
        method: 'POST',
      });
    } catch {
      // Network/transport failure → the "unexpected" bucket of the frozen table.
      throw new Error(UNEXPECTED_MESSAGE);
    }

    if (!response.ok) {
      // Status-only mapping (locked). ConfirmDialog shows this verbatim.
      throw new Error(messageForStatus(response.status));
    }

    // Success: the request migrated OPEN→CANCELLED server-side. Refresh so the
    // Server Component re-fetches the list and the request drops out of "En
    // attente de réponse"; then resolve → ConfirmDialog closes.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Refuser
      </button>

      <ConfirmDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Refuser la demande"
        confirmLabel="Confirmer le refus"
        onConfirm={handleConfirm}
      >
        <p>
          Êtes-vous sûr de vouloir refuser cette demande ? Cette action est
          définitive.
        </p>
      </ConfirmDialog>
    </>
  );
}
