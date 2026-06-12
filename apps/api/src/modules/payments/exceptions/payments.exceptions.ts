import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 409 — the recipient provider cannot accept charges yet (no Stripe Connect
 * account, or `charges_enabled` is false). Blocks the OPEN→ASSIGNED transition.
 */
export class ProviderNotChargeableException extends HttpException {
  constructor(
    message = 'The provider is not able to accept payments yet (Stripe Connect onboarding incomplete)',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 409 — the client has no default, non-deleted payment method on file, so the
 * deposit cannot be charged. Blocks the OPEN→ASSIGNED transition.
 */
export class ClientPaymentMethodRequiredException extends HttpException {
  constructor(
    message = 'The client has no default payment method; add one before booking',
  ) {
    super(message, HttpStatus.CONFLICT);
  }
}

/**
 * 422 — no agreed amount is available to base the deposit on (a DIRECT_BOOKING
 * with no estimate, or a missing quote amount/currency).
 */
export class DepositAmountUnavailableException extends HttpException {
  constructor(
    message = 'No agreed amount is available to compute the deposit',
  ) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * 502 — Stripe rejected the deposit PaymentIntent (e.g. card declined
 * off-session). The payment row is marked FAILED with the Stripe message.
 */
export class DepositChargeFailedException extends HttpException {
  constructor(detail: string) {
    super(`Deposit charge failed: ${detail}`, HttpStatus.BAD_GATEWAY);
  }
}

/** 404 — payment method not found (or not visible to the caller). */
export class PaymentMethodNotFoundException extends HttpException {
  constructor(message = 'Payment method not found') {
    super(message, HttpStatus.NOT_FOUND);
  }
}

/** 403 — the caller does not own this payment method. */
export class NotPaymentMethodOwnerException extends HttpException {
  constructor(message = 'You are not authorized to manage this payment method') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

/** 409 — this Stripe payment method is already saved. */
export class PaymentMethodAlreadyExistsException extends HttpException {
  constructor(message = 'This payment method is already saved') {
    super(message, HttpStatus.CONFLICT);
  }
}

/** 422 — the Stripe payment method type is not supported in this phase. */
export class UnsupportedPaymentMethodTypeException extends HttpException {
  constructor(detail: string) {
    super(
      `Unsupported payment method type: ${detail}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 502 — a Stripe API call failed during a payment-method operation. */
export class StripePaymentMethodOperationFailedException extends HttpException {
  constructor(detail: string) {
    super(`Stripe payment method operation failed: ${detail}`, HttpStatus.BAD_GATEWAY);
  }
}
