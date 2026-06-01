import { HttpException, HttpStatus } from '@nestjs/common';

/** 409 — an owner (user or org) already has an active service provider. */
export class ProviderOwnerConflictException extends HttpException {
  constructor(message = 'This owner already has an active service provider') {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 403 — the acting user has not reached PHONE verification, required for Pro mode. */
export class PhoneVerificationRequiredException extends HttpException {
  constructor(
    message = 'Phone verification is required to activate Pro mode',
  ) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 403 — the acting user is not the owner/authorized manager of the provider. */
export class NotProviderOwnerException extends HttpException {
  constructor(
    message = 'You are not authorized to manage this service provider',
  ) {
    super(message, HttpStatus.FORBIDDEN);
  }
}
