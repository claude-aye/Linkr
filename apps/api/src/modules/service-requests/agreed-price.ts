import { ServiceRequestType } from './enums/service-request-type.enum';

/** The amount/currency of a request's ACCEPTED quote, as read from `quotes`. */
export interface AcceptedQuotePrice {
  amount: string;
  currency: string;
}

/** The subset of a request the rule reads — both record shapes satisfy it. */
export interface AgreedPriceRequest {
  requestType: ServiceRequestType;
  acceptedAtUtc: Date | null;
  estimatedAmount: string | null;
  estimatedCurrency: string | null;
}

export interface AgreedPrice {
  agreedAmount: string | null;
  agreedCurrency: string | null;
}

const NOT_AGREED: AgreedPrice = Object.freeze({
  agreedAmount: null,
  agreedCurrency: null,
});

/**
 * The price both parties have agreed to — the amount the deposit and the
 * balance are actually computed from, which is NOT always `estimatedAmount`:
 *
 *  • DIRECT_BOOKING  → the request's own estimate (what `captureDeposit` uses);
 *  • PROJECT_TENDER  → the ACCEPTED quote (what `findAcceptedQuoteAmount` feeds
 *    to the capture). A tender's `estimatedAmount` is only the client's
 *    indicative BUDGET and is never overwritten on acceptance.
 *
 * `acceptedAtUtc` governs, and alone: it is stamped once, on the OPEN→ASSIGNED
 * transition, and never cleared. So a request that was never accepted has no
 * agreed price whatever a stray ACCEPTED quote row might say (an inconsistent
 * input, answered with null rather than with a number nobody agreed to), and a
 * request accepted and later CANCELLED / REFUNDED keeps reporting the price it
 * was accepted at — that is history, not a live state.
 *
 * Amount and currency travel as a PAIR: either both or neither. Pure — no I/O,
 * no logging; the warning for the one anomalous case (an accepted tender with
 * no ACCEPTED quote) belongs to the caller that owns a logger.
 */
export function resolveAgreedPrice(
  request: AgreedPriceRequest,
  acceptedQuote: AcceptedQuotePrice | null,
): AgreedPrice {
  if (request.acceptedAtUtc === null) return NOT_AGREED;

  if (request.requestType === ServiceRequestType.PROJECT_TENDER) {
    return acceptedQuote
      ? { agreedAmount: acceptedQuote.amount, agreedCurrency: acceptedQuote.currency }
      : NOT_AGREED;
  }

  return request.estimatedAmount !== null && request.estimatedCurrency !== null
    ? {
        agreedAmount: request.estimatedAmount,
        agreedCurrency: request.estimatedCurrency,
      }
    : NOT_AGREED;
}
