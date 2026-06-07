import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 409 — quotes can only be submitted on, or accepted for, a request that is
 * a PROJECT_TENDER currently in the OPEN state.
 */
export class RequestNotOpenForQuotingException extends HttpException {
  constructor(message = 'Quotes are only allowed on an OPEN project tender') {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 403 — the caller has no individual service provider profile to quote as. */
export class ProviderProfileRequiredException extends HttpException {
  constructor(
    message = 'You must have an individual service provider profile to submit quotes',
  ) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 403 — the provider is not verified/active for the request's service category. */
export class ProviderNotEligibleForCategoryException extends HttpException {
  constructor(
    message = 'Your provider profile is not eligible to quote in this service category',
  ) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 400 — `validUntilUtc` must be in the future at submission time. */
export class QuoteValidUntilInPastException extends HttpException {
  constructor(message = 'validUntilUtc must be in the future') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

/** 409 — an active (SUBMITTED) quote already exists for this provider on this request. */
export class ActiveQuoteExistsException extends HttpException {
  constructor(
    message = 'An active quote already exists for this request; withdraw it before submitting a new one',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 403 — the caller does not own the provider behind this quote. */
export class NotQuoteOwnerException extends HttpException {
  constructor(message = 'You are not authorized to manage this quote') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 409 — the quote's validity window has elapsed; it can no longer be accepted. */
export class QuoteExpiredException extends HttpException {
  constructor(message = 'This quote has expired and can no longer be accepted') {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 501 — accepting a quote from an ORGANIZATION provider requires worker
 * dispatch, which is not implemented yet (deferred). INDIVIDUAL providers
 * auto-self-assign; ORGANIZATIONs will need an explicit dispatch flow.
 */
export class OrganizationQuoteDispatchNotImplementedException extends HttpException {
  constructor(
    message = 'Accepting quotes from organization providers is not yet implemented',
  ) {
    super(message, HttpStatus.NOT_IMPLEMENTED);
  }
}
