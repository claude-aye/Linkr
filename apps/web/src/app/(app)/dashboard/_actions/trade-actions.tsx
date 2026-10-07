'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  TRADE_UNAVAILABLE_MESSAGE,
  canTogglePause,
  pauseConfirmationLines,
  pauseNeedsConfirmation,
  retireBlockedReason,
  retireConfirmationLines,
  tradeActionMessageForStatus,
  type TradeVerificationStatus,
} from '@/lib/provider-trades/trade-lifecycle';

/**
 * Pause, resume and retire ONE declared trade — the actions row of a trade
 * card in « Mes métiers » (Métiers — PR B).
 *
 *   - « Mettre en pause » / « Réactiver » — offered ONLY on an eligible trade
 *     (NOT_REQUIRED / VERIFIED). On PENDING or REJECTED it is absent: the badge
 *     reads `isActive ? status : « En pause »`, so pausing a refused trade
 *     would hide the refusal. Pause is ALWAYS permitted, active jobs or not —
 *     closing to new clients while finishing what is engaged is its whole
 *     point. It asks for confirmation only when bookings are pending on this
 *     trade (or when we could not count them); resuming is always immediate.
 *   - « Retirer ce métier » — offered on EVERY status: it is the way out of the
 *     REJECTED trap (`ux_psc_provider_category_active` ignores the status).
 *     Disabled while the trade has active jobs (ASSIGNED / IN_PROGRESS), or
 *     when they could not be counted; otherwise confirmed through
 *     `ConfirmDialog`, whose body lists every consequence.
 *
 * The counts are computed server-side by the page; `null` means UNKNOWN (failed
 * or truncated read) and is never shown as a zero. Every rule and every
 * sentence lives in `lib/provider-trades/trade-lifecycle.ts`. Mapping by HTTP
 * status ALONE (lock 3.12b). `router.refresh()` after each success.
 */
export interface TradeActionsProps {
  providerId: string;
  /** The claim (junction row) id — what the API's `{pscId}` names. */
  pscId: string;
  tradeLabel: string;
  status: TradeVerificationStatus;
  isActive: boolean;
  /** OPEN direct bookings targeted at this provider on this trade. */
  pendingBookings: number | null;
  /** ASSIGNED / IN_PROGRESS jobs on this trade. */
  activeJobs: number | null;
  /** Services hung under this trade claim. */
  serviceCount: number | null;
}

const secondaryButtonClass =
  'min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const dangerButtonClass =
  'min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950';

export function TradeActions({
  providerId,
  pscId,
  tradeLabel,
  status,
  isActive,
  pendingBookings,
  activeJobs,
  serviceCount,
}: TradeActionsProps) {
  const router = useRouter();
  const blockedId = useId();

  const pauseOffered = canTogglePause(status);
  const blockedReason = retireBlockedReason(activeJobs, pauseOffered && isActive);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pauseOpen, setPauseOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  // Same as PR A: keep the OLD screen (button busy) until the refreshed data
  // lands, so the badge and the button flip together.
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;

  const url = `/api/service-providers/${providerId}/categories/${pscId}`;

  /** PATCH `{ isActive }`; `null` on success, the FR message otherwise. */
  async function sendToggle(next: boolean): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
    } catch {
      return TRADE_UNAVAILABLE_MESSAGE;
    }
    return response.ok ? null : tradeActionMessageForStatus(response.status, 'toggle');
  }

  function announceToggle(next: boolean) {
    setAnnouncement(
      next
        ? 'Métier réactivé. Vous apparaissez de nouveau dans les recherches pour ce métier.'
        : 'Métier mis en pause. Vous n’apparaissez plus dans les recherches pour ce métier.',
    );
  }

  /** Immediate toggle — resuming always, pausing when nothing is pending. */
  async function toggleNow(next: boolean) {
    if (busy) return;
    setError(null);
    setPending(true);
    const message = await sendToggle(next);
    setPending(false);
    if (message !== null) {
      setError(message);
      return;
    }
    startRefresh(() => {
      announceToggle(next);
      router.refresh();
    });
  }

  function onPauseClick() {
    if (busy) return;
    setError(null);
    if (pauseNeedsConfirmation(pendingBookings)) {
      setPauseOpen(true);
    } else {
      void toggleNow(false);
    }
  }

  // ConfirmDialog channel: RESOLVE on success (the dialog closes), REJECT with
  // the French message (shown verbatim, the dialog stays open).
  async function confirmPause(): Promise<void> {
    const message = await sendToggle(false);
    if (message !== null) throw new Error(message);
    announceToggle(false);
    router.refresh();
  }

  async function confirmRetire(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, { method: 'DELETE' });
    } catch {
      throw new Error(TRADE_UNAVAILABLE_MESSAGE);
    }
    if (!response.ok) throw new Error(tradeActionMessageForStatus(response.status, 'retire'));
    // The card leaves the list on refresh, taking this component with it.
    router.refresh();
  }

  return (
    <div className="mt-3">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap gap-2">
        {pauseOffered &&
          (isActive ? (
            <button
              type="button"
              onClick={onPauseClick}
              disabled={busy}
              className={secondaryButtonClass}
            >
              {busy ? 'Mise en pause…' : 'Mettre en pause'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void toggleNow(true)}
              disabled={busy}
              className={secondaryButtonClass}
            >
              {busy ? 'Réactivation…' : 'Réactiver'}
            </button>
          ))}

        <button
          type="button"
          onClick={() => {
            setError(null);
            setRetireOpen(true);
          }}
          disabled={busy || blockedReason !== null}
          aria-describedby={blockedReason !== null ? blockedId : undefined}
          className={dangerButtonClass}
        >
          Retirer ce métier
        </button>
      </div>

      {blockedReason !== null && (
        <p id={blockedId} className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {blockedReason}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ConfirmDialog
        isOpen={pauseOpen}
        onClose={() => setPauseOpen(false)}
        title="Mettre ce métier en pause ?"
        confirmLabel="Mettre en pause"
        onConfirm={confirmPause}
      >
        <p className="font-medium text-zinc-800 dark:text-zinc-200">{tradeLabel}</p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          {pauseConfirmationLines(pendingBookings).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={retireOpen}
        onClose={() => setRetireOpen(false)}
        title="Retirer ce métier ?"
        confirmLabel="Confirmer le retrait"
        onConfirm={confirmRetire}
      >
        <p className="font-medium text-zinc-800 dark:text-zinc-200">{tradeLabel}</p>
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <ul className="list-disc space-y-2 pl-5">
            {retireConfirmationLines({
              serviceCount,
              pendingBookings,
              status,
              isActive,
            }).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </ConfirmDialog>
    </div>
  );
}
