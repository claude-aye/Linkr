'use client';

import { useRef, useState } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

/**
 * The card form itself — everything that has to live INSIDE `<Elements>`.
 *
 * It is split from the dialog for one structural reason: `useStripe()` and
 * `useElements()` only resolve under the `<Elements>` provider, so the component
 * that confirms the SetupIntent cannot be the one that renders the provider.
 * That is also why the shared `ConfirmDialog` is not reused for this modal — its
 * confirm button lives outside the body it injects, i.e. outside `<Elements>`.
 *
 * ⚠️ `redirect: 'if_required'` IS DELIBERATE. Card 3-D Secure plays inside
 * Stripe's own iframe, over this page; nobody leaves, nothing needs a return
 * URL, and the modal keeps its state. Switching to the default (`'always'`)
 * would send the client to a return page this application does not have.
 *
 * ⚠️ NO STRIPE MESSAGE IS EVER SHOWN. `error.message` is an untranslated API
 * string that sometimes names an internal identifier — same rule as the
 * deposit-failure emails. The client is told what to do, not what Stripe said.
 */

/** Frozen FR copy — mapped by outcome / HTTP status alone, never by body. */
const AUTHENTICATION_FAILED =
  "Votre carte n'a pas pu être vérifiée. Vérifiez les informations saisies ou utilisez une autre carte.";
const ALREADY_SAVED = 'Cette carte est déjà enregistrée sur votre compte.';
const SERVICE_UNAVAILABLE =
  'Le service de paiement est momentanément indisponible. Veuillez réessayer dans quelques minutes.';
const UNSUPPORTED = "Ce moyen de paiement n'est pas accepté.";
const SESSION_EXPIRED = 'Votre session a expiré. Veuillez vous reconnecter.';
const UNEXPECTED =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

function saveMessageForStatus(status: number): string {
  switch (status) {
    case 401:
      return SESSION_EXPIRED;
    case 409:
      return ALREADY_SAVED;
    case 422:
      return UNSUPPORTED;
    case 502:
      return SERVICE_UNAVAILABLE;
    default:
      return UNEXPECTED;
  }
}

export interface CardFormProps {
  /** Cancel — the parent closes the dialog. */
  onCancel: () => void;
  /** The card is saved: the parent closes, refreshes the list and says so. */
  onSaved: () => void;
}

export function CardForm({ onCancel, onSaved }: CardFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚠️ A CONFIRMED SETUPINTENT CANNOT BE CONFIRMED TWICE. If the card
   * authenticates but the save call then fails (502, a dropped connection), the
   * retry must NOT replay `confirmSetup` — Stripe answers « already succeeded »
   * and the client would read « votre carte n'a pas pu être vérifiée » about a
   * card their bank just approved. Remembering the method id turns that retry
   * into what it actually is: a second attempt at the save alone.
   */
  const confirmedMethodId = useRef<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || pending) return;

    setPending(true);
    setError(null);

    let methodId = confirmedMethodId.current;

    if (!methodId) {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
      });

      if (confirmError || !setupIntent || setupIntent.status !== 'succeeded') {
        // Covers a declined card, a failed 3-D Secure challenge, an incomplete
        // form and a browser-side network failure — one message, because the
        // client's next move is the same in every one of those cases.
        setError(AUTHENTICATION_FAILED);
        setPending(false);
        return;
      }

      const method = setupIntent.payment_method;
      methodId = typeof method === 'string' ? method : (method?.id ?? null);
      if (!methodId) {
        setError(UNEXPECTED);
        setPending(false);
        return;
      }
      confirmedMethodId.current = methodId;
    }

    let response: Response;
    try {
      /**
       * ⚠️ `setDefault: true` IS DELIBERATE. Whoever reaches this screen is very
       * often coming from a deposit that was just refused; they are not adding a
       * spare card, they are replacing the one that failed. Saving it as
       * anything but the default would leave the broken card in charge of the
       * next retry, and the client would have fixed nothing.
       */
      response = await fetch('/api/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripePaymentMethodId: methodId, setDefault: true }),
      });
    } catch {
      setError(UNEXPECTED);
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(saveMessageForStatus(response.status));
      setPending(false);
      return;
    }

    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <PaymentElement onReady={() => setReady(true)} />

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={!stripe || !ready || pending}
          aria-busy={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending && (
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
          )}
          Enregistrer la carte
        </button>
      </div>
    </form>
  );
}
