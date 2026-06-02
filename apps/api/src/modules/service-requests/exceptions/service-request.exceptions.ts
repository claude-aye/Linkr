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
