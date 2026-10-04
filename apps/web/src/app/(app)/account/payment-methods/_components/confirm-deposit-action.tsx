'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getStripe } from '@/lib/stripe/client';
import {
  CONFIRMATION_FAILED_MESSAGE,
  CONFIRMED_MESSAGE,
  STRIPE_UNAVAILABLE_MESSAGE,
  UNEXPECTED_MESSAGE,
  isSettledIntentStatus,
  prepareErrorMessage,
} from '@/lib/payment-methods/deposit-confirmation';

/**
 * « Confirmer le paiement » — the client's way out of a deposit the bank
 * refused off-session (3-D Secure demanded on every payment, or a declined card
 * since replaced). Without it, the deposit-failure email led here to a page with
 * no button that could pay.
 *
 * The click, in order:
 *   1. `POST /api/service-requests/{id}/deposit-confirmation` — the API reads
 *      the PaymentIntent at Stripe, points the payment row at the CURRENT
 *      default card, and returns the intent's client secret + that card's id.
 *      Nothing is created server-side.
 *   2. `stripe.confirmCardPayment(clientSecret, { payment_method })` — confirms
 *      THE SAME intent, so at most one charge is representable, even if the
 *      provider retries at the same moment. The card is passed EXPLICITLY: a
 *      PaymentIntent does not follow a change of default card.
 *   3. On success, the SAME POST again: the API sees the intent settled,
 *      reconciles the row and answers 409 « already paid ». That is what keeps
 *      the banner from coming back while the webhook is still on its way. Its
 *      answer is not read — the next `router.refresh()` shows the truth.
 *
 * ⚠️ NO `<dialog showModal()>` ANYWHERE NEAR THIS (CLAUDE.md §13.1 nº 19 (e)).
 * Stripe.js paints the 3-D Secure challenge as an overlay appended to `<body>`;
 * the browser's top layer would bury it under a modal dialog, and the client
 * would face a spinner forever. A plain button on the page has no top layer.
 *
 * ⚠️ NO STRIPE MESSAGE IS EVER SHOWN, same rule as `card-form.tsx`.
 */
export function ConfirmDepositAction({ serviceRequestId }: { serviceRequestId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'pending' | 'confirmed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/service-requests/${serviceRequestId}/deposit-confirmation`;

  async function prepare(): Promise<Response | null> {
    try {
      return await fetch(endpoint, { method: 'POST' });
    } catch {
      return null;
    }
  }

  async function handleClick() {
    if (phase !== 'idle') return; // anti double-click
    setPhase('pending');
    setError(null);

    const response = await prepare();
    if (!response) {
      setError(UNEXPECTED_MESSAGE);
      setPhase('idle');
      return;
    }
    if (!response.ok) {
      setError(prepareErrorMessage(response.status));
      setPhase('idle');
      // « Nothing to confirm here » — most often the deposit has just been
      // reconciled as paid. The refreshed page is the answer.
      if (response.status === 409) router.refresh();
      return;
    }

    let body: { clientSecret?: string; stripePaymentMethodId?: string };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = {};
    }
    if (!body.clientSecret || !body.stripePaymentMethodId) {
      setError(UNEXPECTED_MESSAGE);
      setPhase('idle');
      return;
    }

    const stripe = await (getStripe() ?? Promise.resolve(null)).catch(() => null);
    if (!stripe) {
      setError(STRIPE_UNAVAILABLE_MESSAGE);
      setPhase('idle');
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
      body.clientSecret,
      { payment_method: body.stripePaymentMethodId },
    );
    if (confirmError || !isSettledIntentStatus(paymentIntent?.status)) {
      // A failed or abandoned challenge, a decline, a browser-side network
      // failure. The row stays (or becomes) FAILED and stays listed — a
      // REQUIRES_ACTION row is listed too — so the banner stays: try again, or
      // replace the card below.
      setError(CONFIRMATION_FAILED_MESSAGE);
      setPhase('idle');
      return;
    }

    // Paid. The phase sticks for this request: if the sync below fails and the
    // refreshed page still lists the deposit, this island keeps saying so
    // instead of offering to pay again.
    setPhase('confirmed');
    await prepare();
    router.refresh();
  }

  return (
    <div className="mt-4">
      {phase !== 'confirmed' && (
        <button
          type="button"
          onClick={handleClick}
          disabled={phase === 'pending'}
          aria-busy={phase === 'pending'}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {phase === 'pending' ? 'Confirmation…' : 'Confirmer le paiement'}
        </button>
      )}

      {/* Present even when empty: a region inserted together with its content
          is often not announced. */}
      <p aria-live="polite" className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
        {phase === 'confirmed' ? CONFIRMED_MESSAGE : ''}
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
