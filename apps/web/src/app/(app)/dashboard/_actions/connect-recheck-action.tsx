'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * « Vérifier de nouveau » — re-reads the account from Stripe through
 * `POST /api/service-providers/{id}/connect/sync` and overwrites the local
 * mirror.
 *
 * ⚠️ WHY THIS COMPARES BEFORE/AFTER INSTEAD OF JUST CALLING `router.refresh()`.
 *
 * Manual review at Stripe takes hours or days, so the overwhelmingly common
 * outcome of this click is that the state is IDENTICAL to what it was. A silent
 * refresh cannot tell « nothing changed » from « nothing happened »: the page
 * would repaint unchanged and the button would read as broken, so the provider
 * clicks again, and again. We therefore keep the pre-click state in props,
 * compare it against what the sync returned, and SAY which of the two occurred.
 *
 * Reading the response body here is for its DATA (the refreshed state), not to
 * choose an error message — the 3.12b lock is about the latter, and the failure
 * path below still maps by HTTP status alone.
 */
export interface ConnectRecheckActionProps {
  providerId: string;
  /** Pre-click state, straight from the same mirror the band rendered. */
  onboardingStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

const UNCHANGED_MESSAGE =
  'Votre dossier est toujours en cours d’examen chez Stripe. Rien n’a changé ' +
  'pour le moment.';

const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

const UPSTREAM_MESSAGE =
  'Stripe est momentanément indisponible. Veuillez réessayer plus tard.';

const NOT_FOUND_MESSAGE =
  'Votre compte de paiement est introuvable. Veuillez rafraîchir la page.';

const SESSION_MESSAGE = 'Votre session a expiré. Veuillez vous reconnecter.';

/** Locked mapping: HTTP status alone (see the sibling link action). */
function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return SESSION_MESSAGE;
    case 404:
      return NOT_FOUND_MESSAGE;
    case 502:
      return UPSTREAM_MESSAGE;
    default:
      return UNEXPECTED_MESSAGE;
  }
}

interface SyncedState {
  onboardingStatus?: unknown;
  chargesEnabled?: unknown;
  payoutsEnabled?: unknown;
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function ConnectRecheckAction({
  providerId,
  onboardingStatus,
  chargesEnabled,
  payoutsEnabled,
}: ConnectRecheckActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unchanged, setUnchanged] = useState(false);

  async function handleClick(): Promise<void> {
    setError(null);
    setUnchanged(false);
    setPending(true);

    let response: Response;
    try {
      response = await fetch(
        `/api/service-providers/${providerId}/connect/sync`,
        { method: 'POST' },
      );
    } catch {
      setError(UNEXPECTED_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(messageForStatus(response.status));
      setPending(false);
      return;
    }

    let synced: SyncedState = {};
    try {
      synced = (await response.json()) as SyncedState;
    } catch {
      // A 2xx we cannot read: the sync did happen server-side, so refresh and
      // let the re-rendered page be the answer rather than asserting anything.
      router.refresh();
      setPending(false);
      return;
    }

    const changed =
      synced.onboardingStatus !== onboardingStatus ||
      synced.chargesEnabled !== chargesEnabled ||
      synced.payoutsEnabled !== payoutsEnabled;

    if (!changed) {
      // The whole point of this component: name the outcome instead of
      // repainting an identical page.
      setUnchanged(true);
      setPending(false);
      return;
    }

    // Something moved — the Server Component is the source of truth for what.
    router.refresh();
    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 underline-offset-2 transition hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400"
      >
        {pending && <Spinner />}
        {pending ? 'Vérification…' : 'Vérifier de nouveau'}
      </button>

      {/* An outcome the provider asked for, so it is announced politely rather
          than as an error — `role="alert"` stays reserved for action failures. */}
      {unchanged && (
        <p
          aria-live="polite"
          className="max-w-sm text-sm text-zinc-600 dark:text-zinc-300"
        >
          {UNCHANGED_MESSAGE}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="max-w-sm rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
