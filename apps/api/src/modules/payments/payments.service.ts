import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from '../stripe-connect/stripe.service';
import { StripeConnectAccountRepository } from '../stripe-connect/repositories/stripe-connect-account.repository';
import { UsersRepository } from '../users/users.repository';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import {
  fromMinorUnits,
  percentageOf,
  toMinorUnits,
} from '../../common/money/money';
import { PaymentRepository, PaymentRecord } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PaymentType } from './enums/payment-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import {
  BalanceAmountUnavailableException,
  BalanceChargeFailedException,
  BalanceNotCapturableException,
  ClientPaymentMethodRequiredException,
  DepositAmountUnavailableException,
  DepositChargeFailedException,
  DepositNotSettledException,
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

export interface CaptureBalanceParams {
  serviceRequestId: string;
  /** Current request status — must be COMPLETED (safety net; caller pre-checks). */
  requestStatus: ServiceRequestStatus;
  /** Must be null — a contested request never auto-/confirm-releases. */
  contestedAtUtc: Date | null;
  /**
   * Agreed total, same source the deposit used: quote.amount (tender) or
   * request.estimated_amount (booking). `balance = agreed − deposit.gross`.
   */
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
    await this.chargeAndPersist({
      paymentId,
      serviceRequestId,
      paymentType: PaymentType.DEPOSIT,
      amountMinor: depositMinor,
      feeMinor,
      currency,
      stripeCustomerId: client.stripeCustomerId,
      stripePaymentMethodId: pm.stripePaymentMethodId,
      destinationAccountId: connect.stripeAccountId,
      idempotencyKey: `dep_${serviceRequestId}`,
      grossAmount,
      platformFeeAmount,
      providerNetAmount,
      onStripeError: (detail) => new DepositChargeFailedException(detail),
    });
  }

  /**
   * Capture the 80% balance — the SHARED method triggered only by the client's
   * confirm-completion endpoint or the auto-release cron (Part 3/4), NEVER by
   * the provider marking the job done. Mirrors {@link captureDeposit}: a
   * destination charge confirmed off-session, finalized by the webhook worker.
   *
   * Preconditions (else a domain exception): request COMPLETED + not contested,
   * and the DEPOSIT exists and is SUCCEEDED. Idempotent via the
   * UNIQUE(service_request_id, payment_type) BALANCE guard — a second confirm /
   * cron trigger short-circuits (no double charge). The COMPLETED→PAID
   * transition is NOT done here; the webhook worker drives it once the BALANCE
   * PaymentIntent succeeds (Part 5).
   */
  async captureBalance(params: CaptureBalanceParams): Promise<void> {
    const { serviceRequestId } = params;

    // Request-state safety net (the endpoint / cron already filtered these).
    if (params.requestStatus !== ServiceRequestStatus.COMPLETED) {
      throw new BalanceNotCapturableException(
        'The request is not awaiting release (must be COMPLETED)',
      );
    }
    if (params.contestedAtUtc !== null) {
      throw new BalanceNotCapturableException(
        'The request is contested; the balance is frozen pending admin review',
      );
    }

    // The DEPOSIT is the source of truth for payer/recipient/currency and must
    // have settled before the balance can be charged.
    const deposit = await this.paymentRepo.findByServiceRequestAndType(
      serviceRequestId,
      PaymentType.DEPOSIT,
    );
    if (!deposit || deposit.status !== PaymentStatus.SUCCEEDED) {
      throw new DepositNotSettledException();
    }

    // Idempotency short-circuit (one BALANCE per request) — the retry / double-
    // trigger guard shared by confirm + cron.
    const existingBalance = await this.paymentRepo.findByServiceRequestAndType(
      serviceRequestId,
      PaymentType.BALANCE,
    );
    if (existingBalance) {
      this.logger.log(
        `Balance already recorded for request ${serviceRequestId} (payment ${existingBalance.id}); skipping`,
      );
      return;
    }

    if (params.agreedAmount === null || params.agreedCurrency === null) {
      throw new BalanceAmountUnavailableException();
    }
    // Currency is authoritative from the deposit; the agreed source must match.
    const currency = deposit.currency.toUpperCase();
    if (params.agreedCurrency.toUpperCase() !== currency) {
      throw new BalanceAmountUnavailableException(
        `Agreed currency ${params.agreedCurrency} does not match the deposit currency ${currency}`,
      );
    }

    // balance = agreed − deposit (exact, in minor units) ⇒ deposit + balance == agreed.
    const agreedMinor = toMinorUnits(params.agreedAmount, currency);
    const depositMinor = toMinorUnits(deposit.grossAmount, currency);
    const balanceMinor = agreedMinor - depositMinor;
    if (balanceMinor <= 0) {
      throw new BalanceAmountUnavailableException(
        'The agreed amount leaves no positive balance after the deposit',
      );
    }
    const feeMinor = percentageOf(balanceMinor, this.commissionRatePercent);
    const taxMinor = 0;
    const netMinor = balanceMinor - feeMinor - taxMinor;

    const grossAmount = fromMinorUnits(balanceMinor, currency);
    const platformFeeAmount = fromMinorUnits(feeMinor, currency);
    const taxAmount = fromMinorUnits(taxMinor, currency);
    const providerNetAmount = fromMinorUnits(netMinor, currency);

    // Re-resolve the client's CURRENT default PM + the prerequisites (capture
    // runs long after assignment; the default may have changed).
    const pm = await this.pmRepo.findDefaultByUserId(deposit.payerUserId);
    if (!pm) throw new ClientPaymentMethodRequiredException();

    const connect = await this.connectRepo.findByServiceProviderId(
      deposit.recipientServiceProviderId,
    );
    if (!connect || !connect.chargesEnabled) {
      throw new ProviderNotChargeableException();
    }

    const client = await this.usersRepo.findById(deposit.payerUserId);
    if (!client) throw new NotFoundException('Client user not found');
    if (!client.stripeCustomerId) {
      throw new ClientPaymentMethodRequiredException(
        'Client has no Stripe customer on file; re-add a payment method',
      );
    }

    // Persist the BALANCE row first (status PENDING). The UNIQUE guard makes a
    // concurrent confirm+cron race a no-op.
    let paymentId: string;
    try {
      const payment = await this.paymentRepo.create({
        serviceRequestId,
        paymentType: PaymentType.BALANCE,
        payerUserId: deposit.payerUserId,
        recipientServiceProviderId: deposit.recipientServiceProviderId,
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
          `Balance created concurrently for request ${serviceRequestId}; skipping`,
        );
        return;
      }
      throw err;
    }

    await this.chargeAndPersist({
      paymentId,
      serviceRequestId,
      paymentType: PaymentType.BALANCE,
      amountMinor: balanceMinor,
      feeMinor,
      currency,
      stripeCustomerId: client.stripeCustomerId,
      stripePaymentMethodId: pm.stripePaymentMethodId,
      destinationAccountId: connect.stripeAccountId,
      idempotencyKey: `bal_${serviceRequestId}`,
      grossAmount,
      platformFeeAmount,
      providerNetAmount,
      onStripeError: (detail) => new BalanceChargeFailedException(detail),
    });
  }

  /**
   * Shared tail of deposit/balance capture: create the off-session destination
   * charge, persist the intent id + derived status, and on a Stripe error mark
   * the row FAILED and surface the caller's domain exception (502).
   */
  private async chargeAndPersist(opts: {
    paymentId: string;
    serviceRequestId: string;
    paymentType: PaymentType;
    amountMinor: number;
    feeMinor: number;
    /** UPPERCASE ISO 4217. */
    currency: string;
    stripeCustomerId: string;
    stripePaymentMethodId: string;
    destinationAccountId: string;
    idempotencyKey: string;
    grossAmount: string;
    platformFeeAmount: string;
    providerNetAmount: string;
    onStripeError: (detail: string) => HttpException;
  }): Promise<void> {
    try {
      const intent = await this.stripe.client.paymentIntents.create(
        {
          amount: opts.amountMinor,
          currency: opts.currency.toLowerCase(),
          customer: opts.stripeCustomerId,
          payment_method: opts.stripePaymentMethodId,
          application_fee_amount: opts.feeMinor,
          transfer_data: { destination: opts.destinationAccountId },
          off_session: true,
          confirm: true,
          metadata: {
            service_request_id: opts.serviceRequestId,
            payment_id: opts.paymentId,
            payment_type: opts.paymentType,
          },
        },
        { idempotencyKey: opts.idempotencyKey },
      );

      const status = mapPaymentIntentStatus(intent.status);
      const capturedAt = status === PaymentStatus.SUCCEEDED ? new Date() : null;
      await this.paymentRepo.attachIntent(opts.paymentId, intent.id, status, capturedAt);
      this.logger.log(
        `${opts.paymentType} ${opts.grossAmount} ${opts.currency} for request ${opts.serviceRequestId}: ` +
          `PI ${intent.id} → ${status} (fee ${opts.platformFeeAmount}, net ${opts.providerNetAmount})`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.paymentRepo.recordFailure(opts.paymentId, detail, intentIdFromError(err));
      if (err instanceof Stripe.errors.StripeError) {
        this.logger.error(
          `${opts.paymentType} charge failed for request ${opts.serviceRequestId}: ${detail}`,
        );
        throw opts.onStripeError(detail);
      }
      throw err instanceof Error ? err : new Error(detail);
    }
  }

  // --- webhook worker handlers (forward-only) --------------------------------

  /**
   * Forward-only "succeeded" sync. Returns the POST-state payment row (even on a
   * replay where the conditional UPDATE was a no-op) so the webhook worker can
   * idempotently drive a BALANCE → request PAID transition (Part 5).
   */
  async markSucceeded(stripePaymentIntentId: string): Promise<PaymentRecord | null> {
    const updated = await this.paymentRepo.markSucceededByIntentId(stripePaymentIntentId);
    const row =
      updated ?? (await this.paymentRepo.findByStripeIntentId(stripePaymentIntentId));
    this.logSync('succeeded', stripePaymentIntentId, row?.id ?? null);
    return row;
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
