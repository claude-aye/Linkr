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
 * LIGHT — no amount, no address, no client — friction proportional to the (nil)
 * financial risk. The action is irreversible but debits nothing.
 *
 * ⚠️ THE "NO REASON" LOCK WAS REVERSED (2026-09-13). PR 2 deliberately sent no
 * body, leaving the API's optional `reason` unused. It now sends one, because a
 * declined client receives an email and a refusal with no explanation reads as
 * abandonment.
 *
 * The original intent is preserved, not discarded: the field is OPTIONAL, never
 * validated, and the confirm button stays enabled on an empty box. "I decline
 * without saying anything" costs exactly what it cost before. The lock changed
 * from "no reason" to "a reason, never demanded" — a provider who hesitates to
 * decline lets the request expire instead, which is worse for the client than a
 * blunt refusal.
 *
 * The BFF relay already accepted an optional `{ reason }` body and forwarded it
 * upstream; only this component was silent.
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
 * Mirrors REASON_MAX_CHARS in request-declined.template.ts. Capped here so what
 * the provider types is what the client reads — the template truncates beyond
 * this, and a message silently cut mid-sentence is worse than one that could
 * not be over-typed in the first place.
 */
const REASON_MAX_CHARS = 300;

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
  const [reason, setReason] = useState('');

  function handleClose(): void {
    setIsOpen(false);
    // Drop the draft: a reason typed then cancelled must not resurface on the
    // next request the provider declines.
    setReason('');
  }

  async function handleConfirm(): Promise<void> {
    const trimmed = reason.trim();

    let response: Response;
    try {
      // Same BFF channel as accept-request-action.tsx: same-origin POST, cookies
      // sent. The body carries the reason ONLY when one was typed — an empty box
      // sends no body at all, exactly as before the lock was reversed.
      response = await fetch(`/api/service-requests/${requestId}/decline`, {
        method: 'POST',
        ...(trimmed
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: trimmed }),
            }
          : {}),
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
        onClose={handleClose}
        title="Refuser la demande"
        confirmLabel="Confirmer le refus"
        onConfirm={handleConfirm}
      >
        <p>
          Êtes-vous sûr de vouloir refuser cette demande ? Cette action est
          définitive.
        </p>

        <label
          htmlFor={`decline-reason-${requestId}`}
          className="mt-4 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Message au client{' '}
          <span className="font-normal text-zinc-500 dark:text-zinc-400">
            (facultatif)
          </span>
        </label>
        <textarea
          id={`decline-reason-${requestId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={REASON_MAX_CHARS}
          rows={2}
          placeholder="Ex. : je ne suis pas disponible à cette date."
          className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Le client le recevra par courriel. Vous pouvez refuser sans rien
          écrire.
        </p>
      </ConfirmDialog>
    </>
  );
}
