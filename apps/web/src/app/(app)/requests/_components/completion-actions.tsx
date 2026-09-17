'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SUPPORT_EMAIL } from '@/lib/constants';

/**
 * The client's two moves on a COMPLETED job: release the balance early, or
 * freeze it.
 *
 * Both are rendered together because they are one decision with two answers,
 * and a client who sees only « Confirmer » would read it as the only way out.
 *
 * ⚠️ VISIBILITY IS DECIDED BY THE CALLER, and strictly: `status === 'COMPLETED'`
 * AND `contestedAtUtc === null` — exactly the window the API accepts, no browser
 * clock. Never `now < completedAtUtc + 72h`: the auto-release cron is the
 * authority, and a front-side cutoff would open a no man's land whenever the
 * cron runs a few minutes late. When the balance settles the request flips to
 * PAID, the status changes, and these buttons disappear on their own — which is
 * also what keeps the API from seeing a 409.
 *
 * ⚠️ CONTESTING SETS A FLAG AND NOTHING ELSE. There is no dispute state machine
 * in the MVP: `contested_at_utc` freezes the auto-release timer so a human can
 * arbitrate OFF-PLATFORM (the client writes to support, an admin settles it
 * through the refund endpoint). Hence no claim field in the dialog — a text box
 * here would promise a ticketing system that does not exist. The frozen-state
 * notice carries the next step instead; see {@link ContestedNotice}.
 *
 * That is also why the button ships at all despite leading to no screen: without
 * it, an unhappy client has to find us from outside the app while the 72 h clock
 * runs, and loses the funds by procedural forfeit. Freeze first, arbitrate
 * after.
 */
export interface CompletionActionsProps {
  requestId: string;
}

/** Frozen FR fallback for any unmapped status and for network/transport errors. */
const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Maps a relayed API status to the FROZEN French copy. Decision locked (3.12b):
 * mapping is by HTTP status ALONE — the response body is never parsed.
 *
 * 409 covers three upstream causes that cannot be told apart from the status
 * (not COMPLETED, already contested, deposit not settled), so the copy names
 * none of them and sends the client to a refreshed page — the card will then
 * show the state that actually applies.
 */
function confirmMessageForStatus(status: number): string {
  switch (status) {
    case 409:
      return 'Cette demande ne peut plus être confirmée. Veuillez rafraîchir la page.';
    case 404:
      return "Cette demande n'est plus accessible.";
    case 502:
      return "Le paiement n'a pas pu être effectué. Veuillez réessayer dans quelques minutes.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/** Contest reaches no Stripe call, so no 502 can arise from this transition. */
function contestMessageForStatus(status: number): string {
  switch (status) {
    case 409:
      return 'Cette demande ne peut plus être contestée. Veuillez rafraîchir la page.';
    case 404:
      return "Cette demande n'est plus accessible.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}

export function CompletionActions({ requestId }: CompletionActionsProps) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<'confirm' | 'contest' | null>(null);

  /**
   * ⚠️ THE CONFIRM CALL IS SYNCHRONOUS, THE STATE CHANGE IS NOT.
   *
   * `confirm-completion` captures the balance and answers 200 — the money is
   * gone at that point. But the request only flips COMPLETED→PAID when Stripe's
   * webhook comes back, seconds later at best. `router.refresh()` runs long
   * before that, so the card re-renders IDENTICAL: same status, same buttons,
   * and a client who just paid is looking at a screen that still asks them to
   * decide. Clicking again earns a 409, because the BALANCE row already exists.
   *
   * Hence this local flag. It is not a cache of server state and never
   * contradicts it: it only covers the gap between "the call succeeded" and
   * "the server agrees", and disappears with the component once the status
   * actually changes.
   */
  const [balanceReleased, setBalanceReleased] = useState(false);

  async function post(
    path: string,
    messageForStatus: (status: number) => string,
  ): Promise<void> {
    let response: Response;
    try {
      // Same BFF channel as the provider-side actions: same-origin POST, cookies
      // sent, no body.
      response = await fetch(`/api/service-requests/${requestId}/${path}`, {
        method: 'POST',
      });
    } catch {
      // Network/transport failure → the "unexpected" bucket of the frozen table.
      throw new Error(UNEXPECTED_MESSAGE);
    }

    if (!response.ok) {
      throw new Error(messageForStatus(response.status));
    }

    setOpenDialog(null);
    if (path === 'confirm-completion') {
      setBalanceReleased(true);
    }
    router.refresh();
  }

  // The gap state: the call went through, the server has not caught up yet.
  // Showing the buttons here would invite a second click the API answers 409.
  if (balanceReleased) {
    return (
      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          Versement effectué
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Le solde a été versé au prestataire. La demande passera à
          « Payée » d’ici quelques instants.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Le prestataire a marqué ces travaux comme terminés.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Sans action de votre part, le solde lui sera versé automatiquement après
        le délai prévu. Confirmez pour le verser tout de suite, ou signalez un
        problème pour suspendre le versement.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpenDialog('confirm')}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Confirmer la fin des travaux
        </button>
        <button
          type="button"
          onClick={() => setOpenDialog('contest')}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Signaler un problème
        </button>
      </div>

      <ConfirmDialog
        isOpen={openDialog === 'confirm'}
        onClose={() => setOpenDialog(null)}
        title="Confirmer la fin des travaux"
        confirmLabel="Confirmer et verser"
        onConfirm={() => post('confirm-completion', confirmMessageForStatus)}
      >
        <p>
          Le solde sera versé au prestataire immédiatement. Cette action est
          définitive.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={openDialog === 'contest'}
        onClose={() => setOpenDialog(null)}
        title="Signaler un problème"
        confirmLabel="Suspendre le versement"
        onConfirm={() => post('contest', contestMessageForStatus)}
      >
        <p>
          Le versement au prestataire sera suspendu, le temps qu'un
          administrateur examine votre dossier.
        </p>
        <p className="mt-2">
          Le signalement n&apos;ouvre pas de dossier à lui seul :{' '}
          <strong>vous devez écrire à {SUPPORT_EMAIL}</strong> pour expliquer la
          situation.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Shown instead of the buttons once the request is contested.
 *
 * This notice is what makes the contest button honest. Clicking it opens no
 * ticket and reaches no screen; the resolution happens by email with a human.
 * If this text did not name the address and the responsibility, the client
 * would be left frozen with no idea what comes next — the dead end the button
 * was accused of creating.
 */
export function ContestedNotice() {
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        Demande contestée — versement suspendu
      </p>
      <p className="mt-1 text-amber-800 dark:text-amber-300">
        Le paiement au prestataire est gelé. Écrivez dès maintenant à{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Demande contestée')}`}
          className="font-medium underline underline-offset-2"
        >
          {SUPPORT_EMAIL}
        </a>{' '}
        pour expliquer votre situation. Un administrateur traitera votre dossier.
      </p>
    </div>
  );
}
