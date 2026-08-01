import { HttpException, HttpStatus } from '@nestjs/common';

/** 409 — an owner (user or org) already has an active service provider. */
export class ProviderOwnerConflictException extends HttpException {
  constructor(message = 'This owner already has an active service provider') {
    super(message, HttpStatus.CONFLICT);
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

/** 409 — the provider already practices this service category. */
export class ProviderCategoryConflictException extends HttpException {
  constructor(
    message = 'This service category is already added for this provider',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 409 — this service item is already offered within this provider category. */
export class ProviderServiceConflictException extends HttpException {
  constructor(message = 'This service is already offered in this category') {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 422 — the service item does not belong to the provider category's service category. */
export class ServiceItemNotInCategoryException extends HttpException {
  constructor(
    message = 'This service item does not belong to the specified service category',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 422 — the service item is not in APPROVED status. */
export class ServiceItemNotApprovedException extends HttpException {
  constructor(message = 'This service item is not approved for use') {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
