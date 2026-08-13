'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  type ServiceLocationPrecision,
  providerLocationPrecisionNotice,
} from '@/lib/service-requests/location-precision';

/**
 * Accept action for an OPEN direct booking targeted at the provider (Phase B,
 * PR 2 — first consumer of {@link ConfirmDialog}).
 *
 * Accepting has a REAL financial effect: server-side it captures a Stripe
 * deposit on the client's payment method. The wording stays honest — we mention
 * "un dépôt" but NEVER show or compute the deposit rate/amount (20% lives
 * backend-only); only the total estimated amount is surfaced. Anti double-click
 * and the pending state are already owned by ConfirmDialog.
 *
 * All display fields come from `ProviderServiceRequestItemDto`, already fetched
 * by the dashboard — this component fetches nothing for reads.
 */
export interface AcceptRequestActionProps {
  requestId: string;
  /** Request title, shown in the modal. */
  title: string;
  /** Client display name, shown in the modal. */
  clientDisplayName: string;
  /** Human-readable service address, shown in the modal. */
  serviceAddress: string;
  /**
   * Provenance of the request's coordinate. Surfaced INSIDE the modal, before
   * the confirm button — accepting commits real money (Stripe deposit capture)
   * and a physical trip, so a degraded location must be visible at the moment
   * of decision, not only on the card behind. Friction proportional to risk
   * (3.12b). It informs, it never blocks: the provider decides.
   */
  serviceLocationPrecision: ServiceLocationPrecision;
  /** TOTAL estimated amount as a decimal string (e.g. "120.00"); nullable. */
  estimatedAmount: string | null;
  /** ISO 4217 code (e.g. "CAD"); nullable. */
  estimatedCurrency: string | null;
}

/** Frozen FR message reused by the null-amount guard and the 422 mapping. */
const MISSING_AMOUNT_MESSAGE =
  "Cette demande n'a pas de montant estimé et ne peut être acceptée.";

/** Frozen FR fallback for any unmapped status and for network/transport errors. */
const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Maps a relayed API status to the FROZEN French copy (see PR spec). Decision is
 * locked: mapping is by HTTP status ALONE — the response body is never parsed to
 * pick a message.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 409:
      return "Cette demande n'est plus disponible ou un problème de paiement empêche l'acceptation. Veuillez rafraîchir la page et réessayer.";
    case 502:
      return 'Le prélèvement du dépôt a échoué. Veuillez réessayer dans quelques instants.';
    case 422:
      return MISSING_AMOUNT_MESSAGE;
    case 404:
      return "Cette demande n'est plus accessible.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/** fr-CA currency formatting; degrades to the raw pair on an unknown ISO code. */
function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="font-medium text-zinc-800 sm:text-right dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}

export function AcceptRequestAction({
  requestId,
  title,
  clientDisplayName,
  serviceAddress,
  serviceLocationPrecision,
  estimatedAmount,
  estimatedCurrency,
}: AcceptRequestActionProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // A request with no agreed amount would be rejected 422 by the API (no deposit
  // basis). Guard it: the confirm button is disabled and, defensively, the
  // business path below refuses too — we never fire an accept doomed to 422.
  const hasAmount = estimatedAmount !== null && estimatedCurrency !== null;

  // Exception marker: `null` on GEOCODED, so a precise request shows nothing.
  const locationNotice = providerLocationPrecisionNotice(serviceLocationPrecision);

  async function handleConfirm(): Promise<void> {
    // Defense-in-depth for a money operation: unreachable while the confirm
    // button is disabled, but the guarantee "never send a doomed accept" lives
    // here, at the business layer — not only in the UI.
    if (!hasAmount) {
      throw new Error(MISSING_AMOUNT_MESSAGE);
    }

    let response: Response;
    try {
      // Same BFF channel as review-actions.tsx: same-origin POST, cookies sent.
      response = await fetch(`/api/service-requests/${requestId}/accept`, {
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

    // Success: the request migrated OPEN→ASSIGNED server-side. Refresh so the
    // Server Component re-fetches the list; then resolve → ConfirmDialog closes.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Accepter
      </button>

      <ConfirmDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Accepter la demande"
        confirmLabel="Accepter"
        confirmDisabled={!hasAmount}
        onConfirm={handleConfirm}
      >
        <div className="space-y-4">
          <dl className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <Row label="Demande">{title}</Row>
            <Row label="Client">{clientDisplayName}</Row>
            <Row label="Adresse">
              {serviceAddress}
              {/* Attached to the address it qualifies, so it is read as part of
                  the recap and lands ABOVE the confirm button. Plain text — no
                  `role="alert"`/`aria-live`: a displayed state, not an event
                  (unlike the null-amount guard below, which IS an error). */}
              {locationNotice && (
                <span className="mt-1 block text-xs font-normal text-amber-700 sm:text-right dark:text-amber-400">
                  {locationNotice}
                </span>
              )}
            </Row>
            {hasAmount && (
              <Row label="Montant total estimé">
                {formatMoney(estimatedAmount, estimatedCurrency)}
              </Row>
            )}
          </dl>

          {hasAmount ? (
            <p>
              En acceptant, un dépôt sera prélevé sur le moyen de paiement du
              client. Montant total estimé du projet&nbsp;:{' '}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {formatMoney(estimatedAmount, estimatedCurrency)}
              </span>
              .
            </p>
          ) : (
            <p
              role="alert"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              {MISSING_AMOUNT_MESSAGE}
            </p>
          )}
        </div>
      </ConfirmDialog>
    </>
  );
}
