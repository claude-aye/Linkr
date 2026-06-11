import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from '../stripe-connect/stripe.service';
import { StripeConnectAccountRepository } from '../stripe-connect/repositories/stripe-connect-account.repository';
import { UsersRepository } from '../users/users.repository';
import {
  fromMinorUnits,
  percentageOf,
  toMinorUnits,
} from '../../common/money/money';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PaymentType } from './enums/payment-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import {
  ClientPaymentMethodRequiredException,
  DepositAmountUnavailableException,
  DepositChargeFailedException,
  ProviderNotChargeableException,
} from './exceptions/payments.exceptions';

/** Postgres unique-violation SQLSTATE (the UNIQUE(service_request_id, payment_type) guard). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

/** Map a Stripe PaymentIntent status to our local payment status. */
function mapPaymentIntentStatus(stripeStatus: string): PaymentStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return PaymentStatus.SUCCEEDED;
    case 'processing':
      return PaymentStatus.PROCESSING;
    case 'requires_action':
    case 'requires_confirmation':
    case 'requires_payment_method':
      return PaymentStatus.REQUIRES_ACTION;
    case 'canceled':
      return PaymentStatus.CANCELLED;
    default:
      return PaymentStatus.PENDING;
  }
}

/** Off-session card errors carry the created PaymentIntent — surface its id. */
function intentIdFromError(err: unknown): string | null {
  const pi = (err as { payment_intent?: { id?: string } }).payment_intent;
  return pi?.id ?? null;
}

export interface CaptureDepositParams {
  serviceRequestId: string;
  /** The paying client (request.client_user_id). */
  clientUserId: string;
  /** The recipient INDIVIDUAL provider. */
  serviceProviderId: string;
  /** Agreed amount: quote.amount (tender) or request.estimated_amount (booking). */
  agreedAmount: string | null;
  agreedCurrency: string | null;
}

/**
 * Service-payment orchestration (3.10b): the payability guard enforced at
 * assignment, the 20% deposit capture via a Stripe destination charge, and the
 * forward-only status sync driven by the webhook worker.
 *
 * B2C / INDIVIDUAL provider only — B2B (org payer, subscriptions) is deferred.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly depositRatePercent: string;
  private readonly commissionRatePercent: string;

  constructor(
    private readonly stripe: StripeService,
    private readonly paymentRepo: PaymentRepository,
    private readonly pmRepo: PaymentMethodRepository,
    private readonly connectRepo: StripeConnectAccountRepository,
    private readonly usersRepo: UsersRepository,
    config: ConfigService,
  ) {
    // Normalized to 2-decimal strings so the stored snapshot is exact.
    this.depositRatePercent = Number(
      config.getOrThrow<number>('PLATFORM_DEPOSIT_RATE_PERCENT'),
    ).toFixed(2);
    this.commissionRatePercent = Number(
      config.getOrThrow<number>('PLATFORM_COMMISSION_RATE_PERCENT'),
    ).toFixed(2);
  }

  /**
   * Payability guard (Part 4). Run inside the assignment transaction, before
   * OPEN→ASSIGNED: a throw here rolls the caller's transaction back.
   *   (a) the recipient provider can take charges (Connect charges_enabled);
   *   (b) the client has a default, non-deleted payment method.
   */
  async assertPayable(
    clientUserId: string,
    serviceProviderId: string,
  ): Promise<void> {
    const connect = await this.connectRepo.findByServiceProviderId(serviceProviderId);
    if (!connect || !connect.chargesEnabled) {
      throw new ProviderNotChargeableException();
    }
    const pm = await this.pmRepo.findDefaultByUserId(clientUserId);
    if (!pm) {
      throw new ClientPaymentMethodRequiredException();
    }
  }

  /**
   * Capture the 20% deposit (Part 5) AFTER the assignment transaction commits.
   * Idempotent: the UNIQUE(service_request_id, payment_type) guard (and an
   * up-front existence check) make a second call a no-op. The PaymentIntent is
   * a destination charge confirmed off-session; the webhook worker finalizes
   * the status. On a Stripe error the payment row is marked FAILED and a clear
   * domain exception is surfaced.
   */
  async captureDeposit(params: CaptureDepositParams): Promise<void> {
    const { serviceRequestId, clientUserId, serviceProviderId } = params;

    // Idempotency short-circuit (one DEPOSIT per request).
    const existing = await this.paymentRepo.findByServiceRequestAndType(
      serviceRequestId,
      PaymentType.DEPOSIT,
    );
    if (existing) {
      this.logger.log(
        `Deposit already recorded for request ${serviceRequestId} (payment ${existing.id}); skipping`,
      );
      return;
    }

    if (params.agreedAmount === null || params.agreedCurrency === null) {
      throw new DepositAmountUnavailableException();
    }
    const currency = params.agreedCurrency.toUpperCase();

    // Resolve the three Stripe-side prerequisites (these mirror assertPayable,
    // re-checked here because capture runs outside the assignment transaction).
    const pm = await this.pmRepo.findDefaultByUserId(clientUserId);
    if (!pm) throw new ClientPaymentMethodRequiredException();

    const connect = await this.connectRepo.findByServiceProviderId(serviceProviderId);
    if (!connect || !connect.chargesEnabled) {
      throw new ProviderNotChargeableException();
    }

    const client = await this.usersRepo.findById(clientUserId);
    if (!client) throw new NotFoundException('Client user not found');
    if (!client.stripeCustomerId) {
      throw new ClientPaymentMethodRequiredException(
        'Client has no Stripe customer on file; re-add a payment method',
      );
    }

    // Deposit breakdown — all arithmetic in integer minor units (exact, HALF-UP)
    // so `net = gross - fee - tax` holds to the cent.
    const agreedMinor = toMinorUnits(params.agreedAmount, currency);
    const depositMinor = percentageOf(agreedMinor, this.depositRatePercent);
    if (depositMinor <= 0) {
      throw new DepositAmountUnavailableException(
        'The agreed amount is too small to compute a non-zero deposit',
      );
    }
    const feeMinor = percentageOf(depositMinor, this.commissionRatePercent);
    const taxMinor = 0;
    const netMinor = depositMinor - feeMinor - taxMinor;

    const grossAmount = fromMinorUnits(depositMinor, currency);
    const platformFeeAmount = fromMinorUnits(feeMinor, currency);
    const taxAmount = fromMinorUnits(taxMinor, currency);
    const providerNetAmount = fromMinorUnits(netMinor, currency);

    // Persist the payment row first (status PENDING).
    let paymentId: string;
    try {
      const payment = await this.paymentRepo.create({
        serviceRequestId,
        paymentType: PaymentType.DEPOSIT,
        payerUserId: clientUserId,
        recipientServiceProviderId: serviceProviderId,
        paymentMethodId: pm.id,
        status: PaymentStatus.PENDING,
        grossAmount,
        currency,
        commissionRatePercent: this.commissionRatePercent,
        platformFeeAmount,
        taxAmount,
        providerNetAmount,
      });
      paymentId = payment.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.log(
          `Deposit created concurrently for request ${serviceRequestId}; skipping`,
        );
        return;
      }
      throw err;
    }

    // Destination charge, confirmed off-session. The already-computed minor
    // amounts ARE toMinorUnits(grossAmount) / toMinorUnits(platformFeeAmount).
    try {
      const intent = await this.stripe.client.paymentIntents.create(
        {
          amount: depositMinor,
          currency: currency.toLowerCase(),
          customer: client.stripeCustomerId,
          payment_method: pm.stripePaymentMethodId,
          application_fee_amount: feeMinor,
          transfer_data: { destination: connect.stripeAccountId },
          off_session: true,
          confirm: true,
          metadata: {
            service_request_id: serviceRequestId,
            payment_id: paymentId,
            payment_type: PaymentType.DEPOSIT,
          },
        },
        { idempotencyKey: `dep_${serviceRequestId}` },
      );

      const status = mapPaymentIntentStatus(intent.status);
      const capturedAt = status === PaymentStatus.SUCCEEDED ? new Date() : null;
      await this.paymentRepo.attachIntent(paymentId, intent.id, status, capturedAt);
      this.logger.log(
        `Deposit ${grossAmount} ${currency} for request ${serviceRequestId}: ` +
          `PI ${intent.id} → ${status} (fee ${platformFeeAmount}, net ${providerNetAmount})`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.paymentRepo.recordFailure(paymentId, detail, intentIdFromError(err));
      if (err instanceof Stripe.errors.StripeError) {
        this.logger.error(
          `Deposit charge failed for request ${serviceRequestId}: ${detail}`,
        );
        throw new DepositChargeFailedException(detail);
      }
      throw err instanceof Error ? err : new Error(detail);
    }
  }

  // --- webhook worker handlers (forward-only) --------------------------------

  async markSucceeded(stripePaymentIntentId: string): Promise<void> {
    const updated = await this.paymentRepo.markSucceededByIntentId(stripePaymentIntentId);
    this.logSync('succeeded', stripePaymentIntentId, updated?.id ?? null);
  }

  async markFailed(
    stripePaymentIntentId: string,
    failureReason: string | null,
  ): Promise<void> {
    const updated = await this.paymentRepo.markFailedByIntentId(
      stripePaymentIntentId,
      failureReason,
    );
    this.logSync('failed', stripePaymentIntentId, updated?.id ?? null);
  }

  async markProcessing(stripePaymentIntentId: string): Promise<void> {
    const updated = await this.paymentRepo.markProcessingByIntentId(stripePaymentIntentId);
    this.logSync('processing', stripePaymentIntentId, updated?.id ?? null);
  }

  private logSync(
    outcome: string,
    intentId: string,
    paymentId: string | null,
  ): void {
    if (paymentId) {
      this.logger.log(`payment_intent.${outcome} ${intentId} → payment ${paymentId}`);
    } else {
      this.logger.log(
        `payment_intent.${outcome} ${intentId} → no-op (unknown intent or terminal status)`,
      );
    }
  }
}
