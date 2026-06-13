import { HttpException, HttpStatus } from '@nestjs/common';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';

/** 409 — the requested status transition is not allowed by the state machine. */
export class InvalidStateTransitionException extends HttpException {
  constructor(from: ServiceRequestStatus | null, to: ServiceRequestStatus) {
    super(
      `Transition from ${from ?? 'null'} to ${to} is not allowed`,
      HttpStatus.CONFLICT,
    );
  }
}

/** 403 — the acting user is not the owner of this service request. */
export class NotRequestOwnerException extends HttpException {
  constructor(message = 'You are not authorized to manage this service request') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 400 — DIRECT_BOOKING requires both service_item_id and requested_service_provider_id. */
export class DirectBookingValidationException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

/** 400 — PROJECT_TENDER must not have requested_service_provider_id. */
export class TenderValidationException extends HttpException {
  constructor(message = 'PROJECT_TENDER must not specify a requested_service_provider_id') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

/** 422 — ORGANIZATION dispatch is not supported in MVP (deferred to future phase). */
export class OrganizationDispatchNotSupportedException extends HttpException {
  constructor() {
    super(
      'Dispatch for ORGANIZATION providers is not supported in MVP',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 409 — the request is not COMPLETED (awaiting release), so it cannot be
 * confirmed or contested by the client.
 */
export class RequestNotCompletedException extends HttpException {
  constructor(
    message = 'The request is not awaiting release (must be COMPLETED)',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 409 — the request is contested; confirm-completion is frozen pending admin. */
export class RequestContestedException extends HttpException {
  constructor(
    message = 'The request is contested; release is frozen pending admin review',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 409 — the request has already been contested. */
export class RequestAlreadyContestedException extends HttpException {
  constructor(message = 'The request has already been contested') {
    super(message, HttpStatus.CONFLICT);
  }
}
