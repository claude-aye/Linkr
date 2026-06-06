import { QuoteStatus } from './enums/quote-status.enum';
import { InvalidStateTransitionException } from '../service-requests/exceptions/service-request.exceptions';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';

/**
 * Single source of truth for allowed quote status transitions.
 * `null` represents the initial state (record being created).
 *
 * SUBMITTED is the only non-terminal state: it can be accepted, withdrawn,
 * rejected (sibling auto-reject on acceptance) or expired (hourly sweep).
 */
const ALLOWED_QUOTE_TRANSITIONS: Readonly<
  Record<QuoteStatus | 'null', QuoteStatus[]>
> = {
  null: [QuoteStatus.SUBMITTED],
  [QuoteStatus.SUBMITTED]: [
    QuoteStatus.ACCEPTED,
    QuoteStatus.WITHDRAWN,
    QuoteStatus.REJECTED,
    QuoteStatus.EXPIRED,
  ],
  [QuoteStatus.ACCEPTED]: [],
  [QuoteStatus.WITHDRAWN]: [],
  [QuoteStatus.REJECTED]: [],
  [QuoteStatus.EXPIRED]: [],
};

export interface QuoteTransitionTarget {
  status: QuoteStatus;
}

/**
 * Validate a quote state transition. Throws InvalidStateTransitionException
 * (409) — reused from the service-requests domain — if the jump is disallowed.
 */
export function buildQuoteTransition(
  currentStatus: QuoteStatus | null,
  newStatus: QuoteStatus,
): QuoteTransitionTarget {
  const key = currentStatus ?? 'null';
  const allowed = ALLOWED_QUOTE_TRANSITIONS[key];

  if (!allowed.includes(newStatus)) {
    // Reuse the same 409 exception — the from/to types are compatible via the
    // string union, matching the service-request-assignment state machine.
    throw new InvalidStateTransitionException(
      currentStatus as unknown as ServiceRequestStatus,
      newStatus as unknown as ServiceRequestStatus,
    );
  }

  return { status: newStatus };
}
