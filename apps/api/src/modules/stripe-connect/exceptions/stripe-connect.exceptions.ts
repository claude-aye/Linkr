import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 501 — onboarding an ORGANIZATION provider to Stripe Connect is deferred.
 * 3.10a supports INDIVIDUAL providers only, consistent with the quotes module's
 * ORG handling (OrganizationQuoteDispatchNotImplementedException).
 */
export class OrganizationConnectOnboardingNotImplementedException extends HttpException {
  constructor(
    message = 'Stripe Connect onboarding for organization providers is not yet implemented',
  ) {
    super(message, HttpStatus.NOT_IMPLEMENTED);
  }
}

/** 403 — the caller does not own the INDIVIDUAL provider being onboarded. */
export class NotConnectAccountOwnerException extends HttpException {
  constructor(
    message = 'You are not authorized to manage this provider’s Stripe Connect account',
  ) {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 404 — no local Stripe Connect mirror row exists for this provider yet. */
export class ConnectAccountNotFoundException extends HttpException {
  constructor(
    message = 'No Stripe Connect account exists for this provider; start onboarding first',
  ) {
    super(message, HttpStatus.NOT_FOUND);
  }
}

/**
 * 502 — a Stripe API call failed (e.g. the platform’s Connect profile is
 * incomplete, or Stripe rejected the request). The underlying Stripe message is
 * surfaced to make platform-setup errors actionable.
 */
export class StripeConnectOperationFailedException extends HttpException {
  constructor(detail: string) {
    super(
      `Stripe Connect operation failed: ${detail}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
