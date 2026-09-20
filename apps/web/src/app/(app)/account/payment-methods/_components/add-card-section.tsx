'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Elements } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';

import { getStripe } from '@/lib/stripe/client';

import { CardForm } from './card-form';

/**
 * « Ajouter une carte » — the button, the modal behind it, and the confirmation
 * that follows. The only client island on this screen besides the per-card
 * actions; the list itself stays a Server Component.
 *
 * ⚠️ THE MODAL IS NEVER AN ENTRY POINT. It opens from this button and nowhere
 * else: no URL, no `?modal=` parameter, no deep link. The emailed CTA lands on
 * the page, which lists what exists and offers to add to it — a link that
 * dropped someone straight into a half-initialised card form would break the
 * back button and re-open a SetupIntent on every reload.
 *
 * ⚠️ AND IT IS NOT A NATIVE `<dialog showModal()>`, UNLIKE EVERY OTHER MODAL IN
 * THIS APP. `showModal()` promotes the element to the browser's TOP LAYER, which
 * paints above every z-index on the page — including the overlay Stripe.js
 * appends to `<body>` for the 3-D Secure challenge. The challenge would load
 * hidden behind this dialog, and the client would sit in front of a spinner that
 * never resolves: exactly the silent failure `usage: 'off_session'` exists to
 * avoid. So this one modal is a plain fixed overlay, and Stripe's own overlay
 * stacks over it normally. Escape, the backdrop click and the focus handling
 * below are what the platform would have given us for free — they are the price
 * of that, and they are not optional.
 */

const SETUP_UNAVAILABLE =
  "Le formulaire de carte n'a pas pu être ouvert. Veuillez réessayer dans quelques minutes.";
const SESSION_EXPIRED = 'Votre session a expiré. Veuillez vous reconnecter.';
const CARD_ENTRY_UNAVAILABLE =
  "L'ajout d'une carte n'est pas disponible pour le moment. Veuillez réessayer plus tard.";

/** Everything inside the panel that can take focus — the Stripe iframe included. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export function AddCardSection() {
  const router = useRouter();
  const titleId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Loaded once per tab; `null` only when the publishable key is missing from
  // the build, in which case the card form cannot be offered at all.
  const stripePromise = getStripe();

  const close = useCallback(() => {
    setIsOpen(false);
    setClientSecret(null);
    setError(null);
    setLoading(false);
    // The platform restores focus for a native <dialog>; here we do it by hand.
    triggerRef.current?.focus();
  }, []);

  async function open() {
    setIsOpen(true);
    setSaved(false);
    setError(null);
    setClientSecret(null);
    setLoading(true);

    let response: Response;
    try {
      response = await fetch('/api/payment-methods/setup-intent', { method: 'POST' });
    } catch {
      setError(SETUP_UNAVAILABLE);
      setLoading(false);
      return;
    }

    if (!response.ok) {
      setError(response.status === 401 ? SESSION_EXPIRED : SETUP_UNAVAILABLE);
      setLoading(false);
      return;
    }

    try {
      const body: unknown = await response.json();
      const secret = (body as { clientSecret?: unknown } | null)?.clientSecret;
      if (typeof secret !== 'string' || secret.length === 0) {
        setError(SETUP_UNAVAILABLE);
      } else {
        setClientSecret(secret);
      }
    } catch {
      setError(SETUP_UNAVAILABLE);
    }
    setLoading(false);
  }

  // Escape closes — the one keyboard affordance a modal must have.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  // Land focus inside the panel on open, so a keyboard user is not left behind
  // on the page underneath.
  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  /**
   * Tab containment, done by hand for the reason given at the top of the file.
   * The `iframe` in the selector matters: the card fields are one, and leaving
   * it out would let Tab walk straight out of the modal and into the page.
   */
  function containFocus(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  /**
   * Elements options are frozen at mount, so they are computed once per client
   * secret and the provider is keyed on it. `theme: 'night'` follows the OS
   * preference the rest of the app follows through Tailwind's `dark:` — without
   * it, the card fields render near-black text on a zinc-900 panel.
   */
  const options: StripeElementsOptions | null = useMemo(() => {
    if (!clientSecret) return null;
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    return {
      clientSecret,
      locale: 'fr-CA',
      appearance: { theme: prefersDark ? 'night' : 'stripe' },
    };
  }, [clientSecret]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Ajouter une carte
      </button>

      {/*
        The confirmation lives on the PAGE, not in the modal: the modal closes on
        success (the refreshed list behind it is the real answer), and this is
        what tells the client the job is done — plus the way back to what they
        were doing when the deposit failed.
      */}
      {saved && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/40"
        >
          <p className="font-medium text-emerald-900 dark:text-emerald-200">
            Carte enregistrée
          </p>
          <p className="mt-1 text-emerald-800 dark:text-emerald-300">
            Elle est désormais votre moyen de paiement par défaut. Le prestataire
            pourra relancer le prélèvement de l’acompte.
          </p>
          <Link
            href="/requests"
            className="mt-2 inline-block font-medium text-emerald-900 underline underline-offset-2 dark:text-emerald-200"
          >
            Retour à mes demandes
          </Link>
        </div>
      )}

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4"
          // `mousedown` on the backdrop only: a click that STARTS inside the
          // panel and ends on the backdrop (selecting text) must not close it.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={containFocus}
            className="max-h-[85vh] w-[92vw] max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              Ajouter une carte
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Aucun montant n’est prélevé maintenant. La carte servira à régler
              l’acompte de vos demandes.
            </p>

            {!stripePromise ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {CARD_ENTRY_UNAVAILABLE}
              </p>
            ) : loading ? (
              <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
                Préparation du formulaire…
              </p>
            ) : error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            ) : options && clientSecret ? (
              <Elements key={clientSecret} stripe={stripePromise} options={options}>
                <CardForm
                  onCancel={close}
                  onSaved={() => {
                    close();
                    setSaved(true);
                    // The Server Component is the source of truth for the list.
                    router.refresh();
                  }}
                />
              </Elements>
            ) : null}

            {(error || !stripePromise) && (
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
