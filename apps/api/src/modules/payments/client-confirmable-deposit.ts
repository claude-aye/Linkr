import { PaymentStatus } from './enums/payment-status.enum';

/**
 * Statuses of a payment row (WITH a PaymentIntent on file) that the CLIENT can
 * still confirm from their browser — the ONE definition read by:
 *   - the « payments to confirm » list (`ServiceRequestRepository`, in SQL);
 *   - the confirmation endpoints (`PaymentsService.prepareClientDepositConfirmation`
 *     and `prepareClientBalanceConfirmation`);
 *   - their conditional card write (`PaymentRepository.setPaymentMethodWhileAwaitingClient`).
 * Three readers, one list: the page cannot offer a button the endpoint
 * refuses, and the endpoint cannot accept a row its own write then skips.
 *
 * ⚠️ SHARED BY THE DEPOSIT AND THE BALANCE (3-D Secure chantier, balance lot).
 * The name says DEPOSIT because the deposit came first; the list does not
 * depend on the payment type, because both are charged by the same
 * `chargeAndPersist` and an off-session refusal leaves both in the same state
 * (FAILED with the intent id, Stripe status `requires_payment_method`). The
 * balance reuses this mechanism — it does not get a list of its own that could
 * drift from this one.
 *
 * - `FAILED` — the off-session charge was refused (3-D Secure demanded on every
 *   payment, or a declined card). The two causes leave the SAME intent status
 *   (`requires_payment_method`) and cannot be told apart; the gesture is the
 *   same anyway — confirm the same intent with the current default card.
 * - `REQUIRES_ACTION` — ⚠️ NOT a narrow race, and the reason this list has two
 *   entries. The client opens the 3-D Secure challenge and abandons it: the
 *   intent stays `requires_action` while the row stays FAILED. When the
 *   provider later retries a DEPOSIT, `retryFailedDeposit` counts
 *   `requires_action` among the LIVE intents and reconciles the row to
 *   REQUIRES_ACTION — which the provider's retry then short-circuits (only
 *   FAILED is retried). With FAILED alone here, the row would leave the list
 *   and nobody could ever act on it again. Only the client can clear a
 *   challenge, so the client keeps the button.
 */
export const CLIENT_CONFIRMABLE_DEPOSIT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.REQUIRES_ACTION,
];

/** SQL list literal of the statuses above, e.g. `'FAILED', 'REQUIRES_ACTION'`. */
export const CLIENT_CONFIRMABLE_DEPOSIT_STATUSES_SQL = CLIENT_CONFIRMABLE_DEPOSIT_STATUSES.map(
  (s) => `'${s}'`,
).join(', ');

/**
 * Whether a payment row is awaiting the CLIENT's confirmation, row-side: a
 * confirmable status AND an intent to confirm. The same two terms the list's
 * SQL reads (`status IN (…)` and `stripe_payment_intent_id IS NOT NULL`).
 *
 * A FAILED row with NO intent (an invalid card id, a network failure before
 * Stripe answered) is NOT awaiting the client: the browser would have nothing
 * to confirm, and the page offers no button for it.
 */
export function isAwaitingClientConfirmation(row: {
  status: PaymentStatus;
  stripePaymentIntentId: string | null;
}): boolean {
  return (
    CLIENT_CONFIRMABLE_DEPOSIT_STATUSES.includes(row.status) && row.stripePaymentIntentId !== null
  );
}
