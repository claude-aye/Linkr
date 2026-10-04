import { PaymentStatus } from './enums/payment-status.enum';

/**
 * Statuses of a DEPOSIT row (WITH a PaymentIntent on file) that the CLIENT can
 * still confirm from their browser — the ONE definition read by:
 *   - the « deposits to confirm » list (`ServiceRequestRepository`, in SQL);
 *   - the confirmation endpoint (`PaymentsService.prepareClientDepositConfirmation`);
 *   - its conditional card write (`PaymentRepository.setPaymentMethodWhileAwaitingClient`).
 * Three readers, one list: the page cannot offer a button the endpoint
 * refuses, and the endpoint cannot accept a row its own write then skips.
 *
 * - `FAILED` — the off-session charge was refused (3-D Secure demanded on every
 *   payment, or a declined card).
 * - `REQUIRES_ACTION` — ⚠️ NOT a narrow race, and the reason this list has two
 *   entries. The client opens the 3-D Secure challenge and abandons it: the
 *   intent stays `requires_action` while the row stays FAILED. When the
 *   provider later retries, `retryFailedDeposit` counts `requires_action`
 *   among the LIVE intents and reconciles the row to REQUIRES_ACTION — which
 *   the provider's retry then short-circuits (only FAILED is retried). With
 *   FAILED alone here, the row would leave the list and nobody could ever act
 *   on it again. Only the client can clear a challenge, so the client keeps
 *   the button.
 */
export const CLIENT_CONFIRMABLE_DEPOSIT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.REQUIRES_ACTION,
];

/** SQL list literal of the statuses above, e.g. `'FAILED', 'REQUIRES_ACTION'`. */
export const CLIENT_CONFIRMABLE_DEPOSIT_STATUSES_SQL = CLIENT_CONFIRMABLE_DEPOSIT_STATUSES.map(
  (s) => `'${s}'`,
).join(', ');
