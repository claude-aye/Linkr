import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripePaymentIntent, StripeService } from '../stripe-connect/stripe.service';
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
   * Deposit-basis guard, meant to run INSIDE the assignment transaction next to
   * {@link assertPayable} — a throw here rolls the assignment back.
   *
   * It exists because `estimated_amount` is OPTIONAL on a service request while
   * a deposit needs one. Left to `captureDeposit`, which runs after the commit,
   * a request with no amount produced a 422 on a job that had ALREADY been
   * assigned: the same stuck state the FAILED-deposit path used to produce, by
   * a second route. "We cannot even compute a deposit" is a precondition of the
   * request, not an outcome of the payment, so it belongs before the commit —
   * where refusing still costs nothing.
   *
   * The arithmetic mirrors `captureDeposit`, which re-runs it; both go through
   * `common/money` so they cannot disagree.
   */
  assertDepositBasis(agreedAmount: string | null, agreedCurrency: string | null): void {
    if (agreedAmount === null || agreedCurrency === null) {
      throw new DepositAmountUnavailableException();
    }
    const currency = agreedCurrency.toUpperCase();
    const depositMinor = percentageOf(
      toMinorUnits(agreedAmount, currency),
      this.depositRatePercent,
    );
    if (depositMinor <= 0) {
      throw new DepositAmountUnavailableException(
        'The agreed amount is too small to compute a non-zero deposit',
      );
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

    // One DEPOSIT per request, enforced by UNIQUE(service_request_id,
    // payment_type). A row that is NOT `FAILED` is settled, in flight, or
    // terminal — it short-circuits exactly as before.
    //
    // `FAILED` is the one retryable state, and the reason this check reads the
    // status at all (T3). It used to short-circuit on the row's mere existence,
    // which made a failed deposit a state nothing could leave: the request stayed
    // ASSIGNED with a dead payment row and no way to charge again, forever.
    const existing = await this.paymentRepo.findByServiceRequestAndType(
      serviceRequestId,
      PaymentType.DEPOSIT,
    );
    if (existing && existing.status !== PaymentStatus.FAILED) {
      this.logger.log(
        `Deposit already recorded for request ${serviceRequestId} ` +
          `(payment ${existing.id}, ${existing.status}); skipping`,
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

    // ── RETRY of a FAILED deposit (T3) ──────────────────────────────────────
    // Never a second INSERT (the unique guard) and — the part that matters —
    // never a second PaymentIntent when one already exists.
    if (existing) {
      await this.paymentRepo.prepareRetry(existing.id, {
        paymentMethodId: pm.id,
        grossAmount,
        currency,
        commissionRatePercent: this.commissionRatePercent,
        platformFeeAmount,
        taxAmount,
        providerNetAmount,
      });

      await this.retryFailedDeposit(existing, {
        serviceRequestId,
        currency,
        depositMinor,
        feeMinor,
        grossAmount,
        platformFeeAmount,
        providerNetAmount,
        stripeCustomerId: client.stripeCustomerId,
        stripePaymentMethodId: pm.stripePaymentMethodId,
        destinationAccountId: connect.stripeAccountId,
      });
      return;
    }

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
  /**
   * Stripe PaymentIntent statuses from which we cannot usefully charge again.
   * `requires_action` sits in this ALIVE set on purpose: off-session it means
   * the card is asking for 3-D Secure, which only the CLIENT can clear — so
   * retrying would not help, and re-charging would be wrong.
   */
  private static readonly LIVE_INTENT_STATUSES = new Set([
    'succeeded',
    'processing',
    'requires_action',
    'requires_capture',
  ]);

  /**
   * Re-attempt a deposit whose row is FAILED, WITHOUT EVER MAKING A SECOND
   * CHARGE POSSIBLE. Every branch below follows from measurements taken against
   * Stripe test mode, because this guarantee cannot be reasoned out from the
   * documentation alone:
   *
   *   - same key, same params, after a SUCCESS -> Stripe replays the very same
   *     PaymentIntent. One charge, not two. This is what protects the case that
   *     matters most: the charge went through and we never saw the response.
   *   - same key, DIFFERENT params (a new card, i.e. the realistic retry) ->
   *     `idempotency_error`. So the key alone cannot carry a retry.
   *   - same key after a CARD DECLINE -> the decline is replayed verbatim, and
   *     that decline had already created a PaymentIntent.
   *   - same key after an `invalid_request_error` (a payment method that does
   *     not exist — the failure every fixture in this repo produces) -> nothing
   *     was cached, the call runs fresh.
   *
   * Hence the split. If a PaymentIntent exists we NEVER create another one: we
   * either accept its verdict or confirm THAT one again, which is Stripe's own
   * retry flow and cannot double-charge, since one PaymentIntent yields at most
   * one successful charge. If none exists we re-issue under the SAME key, so a
   * previous attempt that silently charged replays instead of charging twice.
   */
  private async retryFailedDeposit(
    existing: PaymentRecord,
    opts: {
      serviceRequestId: string;
      currency: string;
      depositMinor: number;
      feeMinor: number;
      grossAmount: string;
      platformFeeAmount: string;
      providerNetAmount: string;
      stripeCustomerId: string;
      stripePaymentMethodId: string;
      destinationAccountId: string;
    },
  ): Promise<void> {
    if (!existing.stripePaymentIntentId) {
      // Nothing is known to exist at Stripe. Reusing the FIRST attempt's key is
      // deliberate, and is the entire double-charge guarantee on this branch.
      this.logger.log(
        `Retrying deposit for request ${opts.serviceRequestId} ` +
          `(payment ${existing.id}): no PaymentIntent on file, re-issuing`,
      );
      await this.chargeAndPersist({
        paymentId: existing.id,
        serviceRequestId: opts.serviceRequestId,
        paymentType: PaymentType.DEPOSIT,
        amountMinor: opts.depositMinor,
        feeMinor: opts.feeMinor,
        currency: opts.currency,
        stripeCustomerId: opts.stripeCustomerId,
        stripePaymentMethodId: opts.stripePaymentMethodId,
        destinationAccountId: opts.destinationAccountId,
        idempotencyKey: `dep_${opts.serviceRequestId}`,
        grossAmount: opts.grossAmount,
        platformFeeAmount: opts.platformFeeAmount,
        providerNetAmount: opts.providerNetAmount,
        onStripeError: (detail) => new DepositChargeFailedException(detail),
      });
      return;
    }

    const intentId = existing.stripePaymentIntentId;
    // `StripePaymentIntent`, not `Stripe.PaymentIntent`: the SDK ships two type
    // entry points whose namespaces differ, so this repo derives every Stripe
    // type from the client VALUE (see stripe.service.ts).
    let intent: StripePaymentIntent;
    try {
      intent = await this.stripe.client.paymentIntents.retrieve(intentId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Could not read PaymentIntent ${intentId} for request ${opts.serviceRequestId}: ${detail}`,
      );
      // Deliberately NOT falling through to a fresh charge: not knowing what
      // that intent did is exactly the state in which creating a second one is
      // how a client ends up debited twice.
      throw new DepositChargeFailedException(detail);
    }

    if (PaymentsService.LIVE_INTENT_STATUSES.has(intent.status)) {
      // The previous attempt did more than the local row believed. Reconcile
      // forward and charge nothing: the row was FAILED because we lost the
      // answer, not because the money stayed put.
      const status = mapPaymentIntentStatus(intent.status);
      const capturedAt = status === PaymentStatus.SUCCEEDED ? new Date() : null;
      await this.paymentRepo.attachIntent(existing.id, intent.id, status, capturedAt);
      this.logger.log(
        `Deposit retry for request ${opts.serviceRequestId}: PaymentIntent ` +
          `${intent.id} is already ${intent.status} -> reconciled to ${status}, no new charge`,
      );
      return;
    }

    if (intent.status === 'canceled') {
      // A cancelled intent can never be confirmed again — and, the part that
      // makes a fresh one safe, can never have charged anything either. It gets
      // a key derived from the dead intent: still deterministic, so a double
      // click on retry dedupes, without colliding with the first attempt's.
      this.logger.log(
        `Deposit retry for request ${opts.serviceRequestId}: PaymentIntent ` +
          `${intent.id} is canceled, issuing a fresh one`,
      );
      await this.chargeAndPersist({
        paymentId: existing.id,
        serviceRequestId: opts.serviceRequestId,
        paymentType: PaymentType.DEPOSIT,
        amountMinor: opts.depositMinor,
        feeMinor: opts.feeMinor,
        currency: opts.currency,
        stripeCustomerId: opts.stripeCustomerId,
        stripePaymentMethodId: opts.stripePaymentMethodId,
        destinationAccountId: opts.destinationAccountId,
        idempotencyKey: `dep_${opts.serviceRequestId}_after_${intent.id}`,
        grossAmount: opts.grossAmount,
        platformFeeAmount: opts.platformFeeAmount,
        providerNetAmount: opts.providerNetAmount,
        onStripeError: (detail) => new DepositChargeFailedException(detail),
      });
      return;
    }

    // `requires_payment_method` (what a decline leaves behind) or
    // `requires_confirmation`: confirm THIS intent with the client's current
    // default card. No new intent, so no second charge is representable.
    //
    // The amounts are NOT recomputed here: an intent's amount is fixed at
    // creation, so the row keeps the figures that intent was created with and
    // the two cannot disagree. Recomputation belongs to the branch that
    // actually creates an intent.
    await this.confirmAndPersist({
      paymentId: existing.id,
      serviceRequestId: opts.serviceRequestId,
      intentId,
      stripePaymentMethodId: opts.stripePaymentMethodId,
      grossAmount: existing.grossAmount,
      currency: existing.currency,
    });
  }

  /**
   * Confirm an EXISTING PaymentIntent — Stripe's own "that card was declined,
   * here is another one" flow. Mirrors {@link chargeAndPersist}'s persistence
   * and error handling; it differs only in never creating anything.
   */
  private async confirmAndPersist(opts: {
    paymentId: string;
    serviceRequestId: string;
    intentId: string;
    stripePaymentMethodId: string;
    grossAmount: string;
    currency: string;
  }): Promise<void> {
    try {
      const intent = await this.stripe.client.paymentIntents.confirm(opts.intentId, {
        payment_method: opts.stripePaymentMethodId,
        off_session: true,
      });

      const status = mapPaymentIntentStatus(intent.status);
      const capturedAt = status === PaymentStatus.SUCCEEDED ? new Date() : null;
      await this.paymentRepo.attachIntent(opts.paymentId, intent.id, status, capturedAt);
      this.logger.log(
        `DEPOSIT retry ${opts.grossAmount} ${opts.currency} for request ` +
          `${opts.serviceRequestId}: re-confirmed PI ${intent.id} -> ${status}`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await this.paymentRepo.recordFailure(opts.paymentId, detail, opts.intentId);
      if (err instanceof Stripe.errors.StripeError) {
        this.logger.error(
          `DEPOSIT re-confirm failed for request ${opts.serviceRequestId}: ${detail}`,
        );
        throw new DepositChargeFailedException(detail);
      }
      throw err instanceof Error ? err : new Error(detail);
    }
  }

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
