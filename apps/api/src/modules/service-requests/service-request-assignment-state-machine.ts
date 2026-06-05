import { ServiceRequestAssignmentStatus } from './enums/service-request-assignment-status.enum';
import { InvalidStateTransitionException } from './exceptions/service-request.exceptions';
import { ServiceRequestStatus } from './enums/service-request-status.enum';

const ALLOWED_ASSIGNMENT_TRANSITIONS: Readonly<
  Record<ServiceRequestAssignmentStatus | 'null', ServiceRequestAssignmentStatus[]>
> = {
  null: [ServiceRequestAssignmentStatus.ASSIGNED],
  [ServiceRequestAssignmentStatus.ASSIGNED]: [
    ServiceRequestAssignmentStatus.ACCEPTED_BY_WORKER,
    ServiceRequestAssignmentStatus.DECLINED_BY_WORKER,
  ],
  [ServiceRequestAssignmentStatus.ACCEPTED_BY_WORKER]: [
    ServiceRequestAssignmentStatus.COMPLETED,
  ],
  [ServiceRequestAssignmentStatus.DECLINED_BY_WORKER]: [],
  [ServiceRequestAssignmentStatus.COMPLETED]: [],
};

export interface AssignmentTransitionTarget {
  status: ServiceRequestAssignmentStatus;
  acknowledgedAtUtc?: Date;
  declinedAtUtc?: Date;
  completedAtUtc?: Date;
}

export function buildAssignmentTransition(
  currentStatus: ServiceRequestAssignmentStatus | null,
  newStatus: ServiceRequestAssignmentStatus,
): AssignmentTransitionTarget {
  const key = currentStatus ?? 'null';
  const allowed = ALLOWED_ASSIGNMENT_TRANSITIONS[key];

  if (!allowed.includes(newStatus)) {
    // Reuse the same 409 exception — the from/to types are compatible via string union.
    throw new InvalidStateTransitionException(
      currentStatus as unknown as ServiceRequestStatus,
      newStatus as unknown as ServiceRequestStatus,
    );
  }

  const payload: AssignmentTransitionTarget = { status: newStatus };

  if (newStatus === ServiceRequestAssignmentStatus.ACCEPTED_BY_WORKER) {
    payload.acknowledgedAtUtc = new Date();
  }
  if (newStatus === ServiceRequestAssignmentStatus.DECLINED_BY_WORKER) {
    payload.declinedAtUtc = new Date();
  }
  if (newStatus === ServiceRequestAssignmentStatus.COMPLETED) {
    payload.completedAtUtc = new Date();
  }

  return payload;
}
