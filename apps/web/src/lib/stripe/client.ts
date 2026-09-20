import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * The browser-side Stripe.js loader, memoised.
 *
 * ⚠️ ONE PROMISE FOR THE WHOLE TAB. `loadStripe` injects the Stripe.js script
 * and returns a promise; calling it per render would re-enter that work on
 * every open of the card modal. The module-level cache is the pattern Stripe
 * documents, and it also means `<Elements stripe={…}>` keeps receiving the same
 * object — the prop is immutable once set.
 *
 * ⚠️ THE KEY IS INLINED AT BUILD TIME. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is
 * substituted into the bundle by Next, so it must be present when `next build`
 * runs — a deployment that sets it only at runtime ships a bundle with no key.
 * The expression is written out in full on purpose: Next substitutes the literal
 * `process.env.NEXT_PUBLIC_…` text, and a destructured or computed read would
 * silently come back `undefined`.
 *
 * Returns `null` when the key is missing, instead of throwing: a misconfigured
 * deployment must still render the list of saved cards (and let them be removed
 * or promoted). Only the « add a card » path goes dark, and it says so.
 */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY) return null;
  stripePromise ??= loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}
