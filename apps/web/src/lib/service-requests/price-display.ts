/**
 * Which price a request card shows, and what it calls it.
 *
 * The API exposes `agreedAmount` / `agreedCurrency`: the price both parties
 * agreed to, i.e. the amount the deposit and the balance are computed from. It
 * is NOT always `estimatedAmount` — a PROJECT_TENDER is charged on its ACCEPTED
 * quote, while its `estimatedAmount` stays the client's indicative BUDGET
 * forever. `agreedAmount` is null until the request is accepted, and null on an
 * accepted request whose price cannot be determined (a tender accepted with no
 * ACCEPTED quote — a data anomaly, logged by the API).
 *
 * The rule, and it is the whole point of this module:
 *
 *  • `agreedAmount` present  → « Prix convenu » + that amount. It REPLACES any
 *    budget or estimate: one amount on the card, never two. No condition on the
 *    status — a request CANCELLED after acceptance keeps the price it was
 *    accepted at, because that is history, not a live state.
 *  • otherwise               → the view's own fallback label and the ESTIMATE,
 *    exactly as before.
 *
 * ⚠️ Never a label that affirms a price over an amount nobody agreed to. In the
 * fallback branch the label always names an ESTIMATE or a BUDGET. That is why a
 * tender falls back to « Budget indicatif » in BOTH views — including the job
 * card, where the only way to land there is the anomaly above.
 *
 * The fallback labels differ by view (the client says « Montant estimé », the
 * provider says « Prix estimé » for a direct job) and are an EXPLICIT
 * parameter: {@link CLIENT_PRICE_LABELS} and {@link JOB_PRICE_LABELS} are the
 * two sets, exported so the cards and the tests read the same constants.
 *
 * Pure, and it imports nothing — the web unit tests run in CI without an
 * install, and Node strips the types natively.
 */

/** `ServiceRequestType`, spelled out to keep this module import-free. */
export type PriceRequestType = 'DIRECT_BOOKING' | 'PROJECT_TENDER';

/** What the rule reads. Both DTOs (client and provider job) satisfy it. */
export interface PriceDisplayInput {
  requestType: PriceRequestType;
  estimatedAmount: string | null | undefined;
  estimatedCurrency: string | null | undefined;
  agreedAmount: string | null | undefined;
  agreedCurrency: string | null | undefined;
}

/** The label to show while there is no agreed price, per request type. */
export interface PriceFallbackLabels {
  direct: string;
  tender: string;
}

export interface PriceDisplay {
  label: string;
  /** Decimal string, or null when there is nothing to show (render « — »). */
  amount: string | null;
  currency: string | null;
}

export const AGREED_PRICE_LABEL = 'Prix convenu';

/** The client's card (`/requests`). */
export const CLIENT_PRICE_LABELS: PriceFallbackLabels = {
  direct: 'Montant estimé',
  tender: 'Budget indicatif',
};

/** The provider's job card (`/dashboard`, « Mes jobs »). */
export const JOB_PRICE_LABELS: PriceFallbackLabels = {
  direct: 'Prix estimé',
  tender: 'Budget indicatif',
};

export function priceDisplay(
  request: PriceDisplayInput,
  fallbackLabels: PriceFallbackLabels,
): PriceDisplay {
  if (request.agreedAmount != null) {
    return {
      label: AGREED_PRICE_LABEL,
      amount: request.agreedAmount,
      currency: request.agreedCurrency ?? null,
    };
  }

  return {
    label:
      request.requestType === 'PROJECT_TENDER'
        ? fallbackLabels.tender
        : fallbackLabels.direct,
    amount: request.estimatedAmount ?? null,
    currency: request.estimatedCurrency ?? null,
  };
}
