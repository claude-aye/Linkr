import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { InvalidStateTransitionException } from './exceptions/service-request.exceptions';

/**
 * Single source of truth for all allowed status transitions.
 * null represents the initial state (no status yet — record being created).
 *
 * Only null→OPEN, OPEN→CANCELLED, and OPEN→EXPIRED are triggered by real
 * endpoints/crons in phase 3.8a. The remaining transitions are encoded now
 * for completeness and will be wired in 3.8c / 3.9 / 3.10.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<ServiceRequestStatus | 'null', ServiceRequestStatus[]>
> = {
  null: [ServiceRequestStatus.DRAFT, ServiceRequestStatus.OPEN],
  [ServiceRequestStatus.DRAFT]: [ServiceRequestStatus.OPEN, ServiceRequestStatus.CANCELLED],
  [ServiceRequestStatus.OPEN]: [
    ServiceRequestStatus.ASSIGNED,
    ServiceRequestStatus.EXPIRED,
    ServiceRequestStatus.CANCELLED,
  ],
  [ServiceRequestStatus.ASSIGNED]: [
    ServiceRequestStatus.IN_PROGRESS,
    ServiceRequestStatus.CANCELLED,
  ],
  [ServiceRequestStatus.IN_PROGRESS]: [
    ServiceRequestStatus.COMPLETED,
    ServiceRequestStatus.CANCELLED,
  ],
  [ServiceRequestStatus.COMPLETED]: [
    ServiceRequestStatus.PAID,
    ServiceRequestStatus.REFUNDED,
  ],
  [ServiceRequestStatus.PAID]: [ServiceRequestStatus.REFUNDED],
  [ServiceRequestStatus.EXPIRED]: [],
  [ServiceRequestStatus.CANCELLED]: [],
  [ServiceRequestStatus.REFUNDED]: [],
};

export interface TransitionContext {
  cancelledByUserId?: string;
  cancellationReason?: string;
}

export interface TransitionTarget {
  status: ServiceRequestStatus;
  cancelledAtUtc?: Date;
  cancellationReason?: string | null;
  cancelledByUserId?: string | null;
}

/**
 * Validate and build the update payload for a state transition.
 * Throws InvalidStateTransitionException (409) if the jump is disallowed.
 *
 * Callers must persist the returned fields — no DB writes happen here.
 */
export function buildTransition(
  currentStatus: ServiceRequestStatus | null,
  newStatus: ServiceRequestStatus,
  context: TransitionContext = {},
): TransitionTarget {
  const key = currentStatus ?? 'null';
  const allowed = ALLOWED_TRANSITIONS[key];

  if (!allowed.includes(newStatus)) {
    throw new InvalidStateTransitionException(currentStatus, newStatus);
  }

  const payload: TransitionTarget = { status: newStatus };

  if (newStatus === ServiceRequestStatus.CANCELLED) {
    payload.cancelledAtUtc = new Date();
    payload.cancellationReason = context.cancellationReason ?? null;
    payload.cancelledByUserId = context.cancelledByUserId ?? null;
  }

  return payload;
}
