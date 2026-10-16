import { ConfigService } from '@nestjs/config';
import { ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import { ServiceRequestsController } from './service-requests.controller';
import {
  DepositAwaitingConfirmationRecord,
  ServiceRequestReadRecord,
  ServiceRequestRepository,
} from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentRepository, PaymentRecord } from '../payments/repositories/payment.repository';
import { PaymentMethodRepository } from '../payments/repositories/payment-method.repository';
import { StripeConnectAccountRepository } from '../stripe-connect/repositories/stripe-connect-account.repository';
import { StripeService } from '../stripe-connect/stripe.service';
import { PaymentType } from '../payments/enums/payment-type.enum';
import { PaymentStatus } from '../payments/enums/payment-status.enum';
import { PaymentMethodType } from '../payments/enums/payment-method-type.enum';
import {
  BalanceAlreadySettledException,
  BalanceChargeFailedException,
  BalanceConfirmationCardRequiredException,
  BalanceIntentMismatchException,
  BalanceIntentUnreadableException,
  BalanceNotAwaitingConfirmationException,
  DepositNotSettledException,
} from '../payments/exceptions/payments.exceptions';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import {
  RequestContestedException,
  RequestNotCompletedException,
} from './exceptions/service-request.exceptions';
import { DepositAwaitingConfirmationItemDto } from './dto/deposit-awaiting-confirmation.dto';

/**
 * The 80% BALANCE refused off-session — 3-D Secure demanded on every payment
 * (`authentication_required`), or a declined card — and the client's way out.
 *
 * Real `ServiceRequestsService` + real `PaymentsService` (so the REAL
 * `captureBalance` and `chargeAndPersist` run); Stripe and the repositories are
 * stateful stand-ins. What is pinned here:
 *   - `confirm-completion` answers 202 (not 502, and no longer a false 200 on
 *     a second click) when the balance awaits the client;
 *   - the auto-release cron emails the client ONCE, at the real transition —
 *     two passes, one email — and never the provider;
 *   - `POST :id/balance-confirmation`: 404 → 403 → 409 on the request, then
 *     the shared row/intent guards, and the server never creates nor confirms
 *     an intent, and never moves the request.
 * The COMPLETED → PAID ordering (point 4) has its own file:
 * `balance-paid-ordering.spec.ts`.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const WORKER_ID = '66666666-6666-4666-8666-666666666666';
const DEPOSIT_ID = '77777777-7777-4777-8777-777777777777';
const BALANCE_ID = '78787878-7878-4878-8878-787878787878';
const PM_ROW_ID = '99999999-9999-4999-8999-999999999999';

function request(over: Partial<ServiceRequestReadRecord> = {}): ServiceRequestReadRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    status: ServiceRequestStatus.COMPLETED,
    serviceCategoryId: '44444444-4444-4444-8444-444444444444',
    serviceItemId: '45454545-4545-4545-8545-454545454545',
    requestedServiceProviderId: PROVIDER_ID,
    assignedServiceProviderId: PROVIDER_ID,
    title: 'Coloration',
    description: 'd',
    serviceAddress: '1 rue Test',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    desiredStartAtUtc: null,
    desiredEndAtUtc: null,
    scheduledAtUtc: null,
    estimatedAmount: '150.00',
    estimatedCurrency: 'CAD',
    finalAmount: null,
    finalCurrency: null,
    responseDeadlineUtc: null,
    quotesDeadlineUtc: null,
    acceptedAtUtc: new Date('2026-10-01T15:00:00Z'),
    completedAtUtc: new Date('2026-10-05T15:00:00Z'),
    paidAtUtc: null,
    contestedAtUtc: null,
    cancelledAtUtc: null,
    cancellationReason: null,
    cancelledByUserId: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    acceptedQuote: null,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord>): PaymentRecord {
  return {
    id: DEPOSIT_ID,
    serviceRequestId: REQUEST_ID,
    paymentType: PaymentType.DEPOSIT,
    payerUserId: CLIENT_ID,
    payerOrganizationId: null,
    recipientServiceProviderId: PROVIDER_ID,
    paymentMethodId: PM_ROW_ID,
    stripePaymentIntentId: 'pi_dep',
    status: PaymentStatus.SUCCEEDED,
    grossAmount: '30.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '3.00',
    taxAmount: '0.00',
    providerNetAmount: '27.00',
    capturedAtUtc: new Date(),
    failedAtUtc: null,
    failureReason: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...over,
  };
}

/** The balance row as the off-session 3-D Secure refusal leaves it. */
function failedBalance(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return payment({
    id: BALANCE_ID,
    paymentType: PaymentType.BALANCE,
    stripePaymentIntentId: 'pi_bal',
    status: PaymentStatus.FAILED,
    grossAmount: '120.00',
    platformFeeAmount: '12.00',
    providerNetAmount: '108.00',
    capturedAtUtc: null,
    failedAtUtc: new Date(),
    failureReason: 'Your card was declined. This transaction requires authentication.',
    ...over,
  });
}

/** What Stripe throws on an off-session charge of `4000 0027 6000 3184` (H1). */
function authenticationRequired(): Error {
  // The raw error type is not exported from the ESM namespace; the cast keeps
  // the one field the test needs (`payment_intent`, read by `intentIdFromError`).
  return new Stripe.errors.StripeCardError({
    message: 'Your card was declined. This transaction requires authentication.',
    type: 'card_error',
    code: 'authentication_required',
    payment_intent: { id: 'pi_bal', status: 'requires_payment_method' },
  } as unknown as ConstructorParameters<typeof Stripe.errors.StripeCardError>[0]);
}

/** A Stripe failure that carries NO PaymentIntent (nothing the client could confirm). */
function noIntentFailure(): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    message: "No such PaymentMethod: 'pm_dead'",
    type: 'invalid_request_error',
  });
}

type Intent = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  client_secret: string | null;
};

function buildHarness(opts: {
  record?: ServiceRequestReadRecord | null;
  /** Initial BALANCE row (default: none — the capture has not run yet). */
  balance?: PaymentRecord | null;
  /** What `paymentIntents.create` does: throw this, or succeed when omitted. */
  createThrows?: () => Error;
  retrieved?: Partial<Intent> | Error;
  defaultCard?: boolean;
}) {
  let record: ServiceRequestReadRecord | null =
    opts.record === undefined ? request() : opts.record;
  const rows: Record<string, PaymentRecord | null> = {
    [PaymentType.DEPOSIT]: payment({}),
    [PaymentType.BALANCE]: opts.balance ?? null,
  };
  const byId = (id: string): PaymentRecord | null =>
    Object.values(rows).find((r) => r?.id === id) ?? null;
  const patch = (id: string, over: Partial<PaymentRecord>): PaymentRecord | null => {
    const row = byId(id);
    if (!row) return null;
    const next = { ...row, ...over };
    rows[row.paymentType] = next;
    return next;
  };

  const intents = {
    create: jest.fn(async () => {
      if (opts.createThrows) throw opts.createThrows();
      return { id: 'pi_bal', status: 'succeeded' };
    }),
    confirm: jest.fn(),
    retrieve: jest.fn(async (): Promise<Intent> => {
      if (opts.retrieved instanceof Error) throw opts.retrieved;
      return {
        id: 'pi_bal',
        status: 'requires_payment_method',
        amount: 12000,
        currency: 'cad',
        client_secret: 'pi_bal_secret_abc',
        ...opts.retrieved,
      };
    }),
  };

  const paymentRepo = {
    findByServiceRequestAndType: jest.fn(async (_id: string, type: PaymentType) => rows[type] ?? null),
    create: jest.fn(async (data: Partial<PaymentRecord>) => {
      const row = payment({
        ...data,
        id: BALANCE_ID,
        stripePaymentIntentId: null,
        capturedAtUtc: null,
        failedAtUtc: null,
      });
      rows[row.paymentType] = row;
      return row;
    }),
    attachIntent: jest.fn(async (id: string, pi: string, status: PaymentStatus) =>
      patch(id, { stripePaymentIntentId: pi, status }),
    ),
    recordFailure: jest.fn(async (id: string, reason: string, pi: string | null) => {
      const row = byId(id);
      patch(id, {
        status: PaymentStatus.FAILED,
        failureReason: reason,
        failedAtUtc: new Date(),
        stripePaymentIntentId: row?.stripePaymentIntentId ?? pi,
      });
    }),
    setPaymentMethodWhileAwaitingClient: jest.fn(async (id: string, pm: string) => {
      const row = byId(id);
      if (!row || ![PaymentStatus.FAILED, PaymentStatus.REQUIRES_ACTION].includes(row.status)) {
        return false;
      }
      patch(id, { paymentMethodId: pm });
      return true;
    }),
    prepareRetry: jest.fn(),
    prepareConfirmRetry: jest.fn(),
  };

  const paymentsService = new PaymentsService(
    { client: { paymentIntents: intents } } as unknown as StripeService,
    paymentRepo as unknown as PaymentRepository,
    {
      findDefaultByUserId: jest.fn().mockResolvedValue(
        opts.defaultCard === false
          ? null
          : {
              id: PM_ROW_ID,
              ownerUserId: CLIENT_ID,
              ownerOrganizationId: null,
              stripePaymentMethodId: 'pm_current_default',
              type: PaymentMethodType.CARD,
              brand: 'VISA',
              last4: '3184',
              expMonth: 12,
              expYear: 2030,
              isDefault: true,
              createdAtUtc: new Date(),
              deletedAtUtc: null,
            },
      ),
    } as unknown as PaymentMethodRepository,
    {
      findByServiceProviderId: jest
        .fn()
        .mockResolvedValue({ stripeAccountId: 'acct_test', chargesEnabled: true }),
    } as unknown as StripeConnectAccountRepository,
    {
      findById: jest.fn().mockResolvedValue({ id: CLIENT_ID, stripeCustomerId: 'cus_test' }),
    } as unknown as UsersRepository,
    {
      getOrThrow: jest.fn((key: string) => (key === 'PLATFORM_DEPOSIT_RATE_PERCENT' ? 20 : 10)),
    } as unknown as ConfigService,
  );
  const prepareBalance = jest.spyOn(paymentsService, 'prepareClientBalanceConfirmation');

  const requestRepo = {
    findById: jest.fn(async () => record),
    findAwaitingRelease: jest.fn(async () =>
      record && record.status === ServiceRequestStatus.COMPLETED && !record.contestedAtUtc
        ? [record]
        : [],
    ),
    update: jest.fn(async (_id: string, data: Partial<ServiceRequestReadRecord>) => {
      record = record && { ...record, ...data };
    }),
  };

  // Every channel a notification could leave by. The provider-facing ones must
  // stay silent on a balance.
  const notifications = {
    notifyBalanceFailed: jest.fn().mockResolvedValue(undefined),
    notifyDepositFailed: jest.fn().mockResolvedValue(undefined),
    notifyJobCompleted: jest.fn().mockResolvedValue(undefined),
    notifyRequestAccepted: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ServiceRequestsService(
    requestRepo as unknown as ServiceRequestRepository,
    {
      findLiveByRequestId: jest.fn().mockResolvedValue({ workerUserId: WORKER_ID }),
    } as unknown as ServiceRequestAssignmentRepository,
    {} as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    notifications as unknown as NotificationsService,
    paymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    {
      isEligibleForCategory: jest.fn().mockResolvedValue(true),
    } as unknown as ProfessionalServiceCategoryRepository,
  );

  return {
    service,
    paymentsService,
    intents,
    paymentRepo,
    requestRepo,
    notifications,
    prepareBalance,
    balanceRow: () => rows[PaymentType.BALANCE],
    record: () => record,
  };
}

type Harness = ReturnType<typeof buildHarness>;

/** No intent is ever created or confirmed by the confirmation endpoint. */
function expectNoServerSideCharge(h: Harness): void {
  expect(h.intents.create).not.toHaveBeenCalled();
  expect(h.intents.confirm).not.toHaveBeenCalled();
}

/** `announceBalanceFailure` is detached: let its promise chain run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('confirm-completion — a balance the bank refuses off-session', () => {
  it('3-D Secure demanded → balanceAwaitingClient (the controller’s 202), NOT a 502', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });

    const outcome = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);

    expect(outcome.balanceAwaitingClient).toBe(true);
    expect(outcome.request.status).toBe(ServiceRequestStatus.COMPLETED);
    // The real `chargeAndPersist` left the row exactly as the list expects it.
    expect(h.balanceRow()).toMatchObject({
      paymentType: PaymentType.BALANCE,
      status: PaymentStatus.FAILED,
      stripePaymentIntentId: 'pi_bal',
      grossAmount: '120.00',
    });
    expect(h.intents.create).toHaveBeenCalledTimes(1);
  });

  it('the client is on screen: confirm-completion sends NO email, to anyone', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });
    await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);
    await flush();
    for (const notify of Object.values(h.notifications)) expect(notify).not.toHaveBeenCalled();
  });

  it('a SECOND click is 202 again — it used to answer 200 « paid » over an unpaid balance', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });
    await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);

    const again = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);

    expect(again.balanceAwaitingClient).toBe(true);
    // The short-circuit held: still ONE PaymentIntent, never a second charge.
    expect(h.intents.create).toHaveBeenCalledTimes(1);
  });

  it('a REQUIRES_ACTION row with an intent is awaiting the client too', async () => {
    const h = buildHarness({ balance: failedBalance({ status: PaymentStatus.REQUIRES_ACTION }) });
    const outcome = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);
    expect(outcome.balanceAwaitingClient).toBe(true);
    expect(h.intents.create).not.toHaveBeenCalled();
  });

  it('a charge that goes through → 200 (balanceAwaitingClient false), unchanged', async () => {
    const h = buildHarness({});
    const outcome = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);
    expect(outcome.balanceAwaitingClient).toBe(false);
    expect(h.balanceRow()?.status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('a Stripe failure with NO intent keeps its 502 — a 202 never promises a missing button', async () => {
    const h = buildHarness({ createThrows: noIntentFailure });
    await expect(h.service.confirmCompletion(REQUEST_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      BalanceChargeFailedException,
    );
    expect(h.balanceRow()).toMatchObject({ status: PaymentStatus.FAILED, stripePaymentIntentId: null });
  });

  it('the guards before the capture are unchanged (403, 409 not completed, 409 contested, deposit not settled)', async () => {
    await expect(
      buildHarness({}).service.confirmCompletion(REQUEST_ID, STRANGER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      buildHarness({ record: request({ status: ServiceRequestStatus.IN_PROGRESS }) }).service
        .confirmCompletion(REQUEST_ID, CLIENT_ID),
    ).rejects.toBeInstanceOf(RequestNotCompletedException);
    await expect(
      buildHarness({ record: request({ contestedAtUtc: new Date() }) }).service.confirmCompletion(
        REQUEST_ID,
        CLIENT_ID,
      ),
    ).rejects.toBeInstanceOf(RequestContestedException);

    const unsettled = buildHarness({});
    const depositRow = await unsettled.paymentRepo.findByServiceRequestAndType(REQUEST_ID, PaymentType.DEPOSIT);
    if (depositRow) depositRow.status = PaymentStatus.FAILED;
    await expect(unsettled.service.confirmCompletion(REQUEST_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      DepositNotSettledException,
    );
  });

  it('an already-PAID request stays a 200 no-op', async () => {
    const h = buildHarness({ record: request({ status: ServiceRequestStatus.PAID }) });
    const outcome = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);
    expect(outcome.balanceAwaitingClient).toBe(false);
    expect(h.intents.create).not.toHaveBeenCalled();
  });

  it('the controller turns balanceAwaitingClient into a 202, and leaves the 200 alone', async () => {
    for (const [createThrows, expected] of [
      [authenticationRequired, HttpStatus.ACCEPTED],
      [undefined, null],
    ] as const) {
      const h = buildHarness({ createThrows });
      const controller = new ServiceRequestsController(h.service);
      const res = { status: jest.fn() } as unknown as Response;

      const body = await controller.confirmCompletion({ sub: CLIENT_ID } as never, REQUEST_ID, res);

      expect(body.id).toBe(REQUEST_ID);
      if (expected === null) {
        expect(res.status).not.toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(expected);
      }
    }
  });
});

describe('auto-release cron — one email, at the real transition', () => {
  it('two passes over a 3-D Secure balance → ONE email to the client, ONE PaymentIntent', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });

    await h.service.runAutoReleaseCheck();
    await flush();
    await h.service.runAutoReleaseCheck();
    await flush();

    expect(h.notifications.notifyBalanceFailed).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyBalanceFailed).toHaveBeenCalledWith(
      expect.objectContaining({ id: REQUEST_ID, clientUserId: CLIENT_ID }),
    );
    expect(h.intents.create).toHaveBeenCalledTimes(1);
    expect(h.balanceRow()).toMatchObject({ status: PaymentStatus.FAILED, stripePaymentIntentId: 'pi_bal' });
  });

  it('the provider receives NOTHING', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });
    await h.service.runAutoReleaseCheck();
    await flush();
    expect(h.notifications.notifyDepositFailed).not.toHaveBeenCalled();
    expect(h.notifications.notifyRequestAccepted).not.toHaveBeenCalled();
  });

  it('a row the client’s own confirm-completion created first → the cron sends nothing', async () => {
    const h = buildHarness({ balance: failedBalance() });
    await h.service.runAutoReleaseCheck();
    await flush();
    expect(h.notifications.notifyBalanceFailed).not.toHaveBeenCalled();
    expect(h.intents.create).not.toHaveBeenCalled();
  });

  it('a charge that goes through → no email', async () => {
    const h = buildHarness({});
    const result = await h.service.runAutoReleaseCheck();
    await flush();
    expect(result).toEqual({ released: 1, failed: 0 });
    expect(h.notifications.notifyBalanceFailed).not.toHaveBeenCalled();
  });

  it('a failure with NO intent → no email (the page has no button for it)', async () => {
    const h = buildHarness({ createThrows: noIntentFailure });
    const result = await h.service.runAutoReleaseCheck();
    await flush();
    expect(result).toEqual({ released: 0, failed: 1 });
    expect(h.notifications.notifyBalanceFailed).not.toHaveBeenCalled();
  });

  it('a pass that cannot read the balance state never mails (unknown ≠ « no row before »)', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });
    jest
      .spyOn(h.paymentsService, 'balanceConfirmationState')
      .mockRejectedValueOnce(new Error('db down'));
    const result = await h.service.runAutoReleaseCheck();
    await flush();
    expect(result.failed).toBe(1);
    expect(h.notifications.notifyBalanceFailed).not.toHaveBeenCalled();
    expect(h.intents.create).not.toHaveBeenCalled();
  });
});

/**
 * The `released` counter counts captures that really were attempted. The
 * harness's `findAwaitingRelease` stand-in does NOT apply the SQL `NOT EXISTS`
 * on a BALANCE row: it hands the request back whatever the payments hold. So
 * every case below where a row already exists is the RACE the loop guards
 * against (a row born between the selection and the treatment) — the stronger
 * case. The SQL exclusion itself is a predicate on two tables; only a real
 * Postgres can prove it (see `docs/reports/cron-released-rapport.md`).
 */
describe('auto-release cron — `released` counts only captures it really attempted', () => {
  it.each([
    ['SUCCEEDED (settled, webhook not arrived yet)', PaymentStatus.SUCCEEDED],
    ['FAILED with an intent (awaiting the client)', PaymentStatus.FAILED],
    ['REQUIRES_ACTION', PaymentStatus.REQUIRES_ACTION],
    ['PENDING', PaymentStatus.PENDING],
  ])(
    'a BALANCE row already %s → released 0 on each of two passes, captureBalance never called',
    async (_label, status) => {
      const h = buildHarness({ balance: failedBalance({ status }) });
      const capture = jest.spyOn(h.paymentsService, 'captureBalance');

      const first = await h.service.runAutoReleaseCheck();
      await flush();
      const second = await h.service.runAutoReleaseCheck();
      await flush();

      expect(first).toEqual({ released: 0, failed: 0 });
      expect(second).toEqual({ released: 0, failed: 0 });
      expect(capture).not.toHaveBeenCalled();
      expect(h.intents.create).not.toHaveBeenCalled();
      expect(h.notifications.notifyBalanceFailed).not.toHaveBeenCalled();
    },
  );

  it('an eligible request with no BALANCE row is still captured → released 1', async () => {
    const h = buildHarness({});
    const capture = jest.spyOn(h.paymentsService, 'captureBalance');

    const result = await h.service.runAutoReleaseCheck();

    expect(result).toEqual({ released: 1, failed: 0 });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(h.intents.create).toHaveBeenCalledTimes(1);
  });

  it('a 3-D Secure refusal: first pass fails once and mails once; the second pass counts nothing and mails nothing', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });

    const first = await h.service.runAutoReleaseCheck();
    await flush();
    const second = await h.service.runAutoReleaseCheck();
    await flush();

    expect(first.released).toBe(0);
    expect(second).toEqual({ released: 0, failed: 0 });
    expect(h.notifications.notifyBalanceFailed).toHaveBeenCalledTimes(1);
    expect(h.intents.create).toHaveBeenCalledTimes(1);
  });

  it('a BALANCE row on a refunded deposit no longer reports a failure every hour', async () => {
    // Before the fix: selected every hour, `captureBalance` tripped on the
    // deposit guard (which runs BEFORE its own short-circuit) → failed 1, an
    // ERROR line per pass, for a capture that had nothing left to do.
    const h = buildHarness({ balance: failedBalance() });
    jest
      .spyOn(h.paymentRepo, 'findByServiceRequestAndType')
      .mockImplementation(async (_id: string, type: PaymentType) =>
        type === PaymentType.DEPOSIT
          ? payment({ status: PaymentStatus.PARTIALLY_REFUNDED })
          : failedBalance(),
      );

    const result = await h.service.runAutoReleaseCheck();

    expect(result).toEqual({ released: 0, failed: 0 });
  });
});

const call = (h: Harness, caller = CLIENT_ID) =>
  h.service.prepareBalanceConfirmation(REQUEST_ID, caller);

describe('POST :id/balance-confirmation — request-side guards (404 → 403 → 409)', () => {
  it('404 when the request does not exist — nothing read at Stripe', async () => {
    const h = buildHarness({ record: null, balance: failedBalance() });
    await expect(call(h)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prepareBalance).not.toHaveBeenCalled();
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it('403 when the caller is not the client — not even the assigned provider', async () => {
    for (const caller of [STRANGER_ID, WORKER_ID]) {
      const h = buildHarness({ balance: failedBalance() });
      await expect(call(h, caller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.prepareBalance).not.toHaveBeenCalled();
      expect(h.intents.retrieve).not.toHaveBeenCalled();
    }
  });

  it.each(Object.values(ServiceRequestStatus).filter((s) => s !== ServiceRequestStatus.COMPLETED))(
    '409 on a %s request — only COMPLETED awaits a balance; nothing read at Stripe',
    async (status) => {
      const h = buildHarness({ record: request({ status }), balance: failedBalance() });
      await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
      expect(h.prepareBalance).not.toHaveBeenCalled();
      expect(h.intents.retrieve).not.toHaveBeenCalled();
    },
  );

  it('409 on a CONTESTED request — the balance is frozen; nothing read at Stripe', async () => {
    const h = buildHarness({
      record: request({ contestedAtUtc: new Date() }),
      balance: failedBalance(),
    });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.prepareBalance).not.toHaveBeenCalled();
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });
});

describe('POST :id/balance-confirmation — the BALANCE row', () => {
  it('reads the BALANCE row, never the deposit', async () => {
    const h = buildHarness({ balance: failedBalance() });
    await call(h);
    expect(h.paymentRepo.findByServiceRequestAndType).toHaveBeenCalledWith(
      REQUEST_ID,
      PaymentType.BALANCE,
    );
    expect(h.paymentRepo.findByServiceRequestAndType).not.toHaveBeenCalledWith(
      REQUEST_ID,
      PaymentType.DEPOSIT,
    );
  });

  it('409 when there is no balance row — nothing read at Stripe', async () => {
    const h = buildHarness({ balance: null });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it.each(
    Object.values(PaymentStatus).filter(
      (s) => s !== PaymentStatus.FAILED && s !== PaymentStatus.REQUIRES_ACTION,
    ),
  )('409 on a %s balance — nothing read at Stripe', async (status) => {
    const h = buildHarness({ balance: failedBalance({ status }) });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it('409 on a FAILED balance with NO PaymentIntent — the browser has nothing to confirm', async () => {
    const h = buildHarness({ balance: failedBalance({ stripePaymentIntentId: null }) });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it('409 when the balance payer is not the caller', async () => {
    const h = buildHarness({ balance: failedBalance({ payerUserId: STRANGER_ID }) });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });
});

describe('POST :id/balance-confirmation — the PaymentIntent, read on the click', () => {
  it.each(['requires_payment_method', 'requires_confirmation', 'requires_action'])(
    '%s → client secret + CURRENT default card; writes payment_method_id ONLY',
    async (status) => {
      const h = buildHarness({ balance: failedBalance(), retrieved: { status } });

      const out = await call(h);

      expect(out).toEqual({
        serviceRequestId: REQUEST_ID,
        clientSecret: 'pi_bal_secret_abc',
        stripePaymentMethodId: 'pm_current_default',
        grossAmount: '120.00',
        currency: 'CAD',
      });
      expect(h.intents.retrieve).toHaveBeenCalledWith('pi_bal');
      expect(h.paymentRepo.setPaymentMethodWhileAwaitingClient).toHaveBeenCalledWith(
        BALANCE_ID,
        PM_ROW_ID,
      );
      expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
      expect(h.paymentRepo.create).not.toHaveBeenCalled();
      expect(h.paymentRepo.recordFailure).not.toHaveBeenCalled();
      expect(h.requestRepo.update).not.toHaveBeenCalled();
      expectNoServerSideCharge(h);
    },
  );

  it('succeeded → reconciles the ROW to SUCCEEDED, 409 « already paid », and does NOT move the request', async () => {
    const h = buildHarness({ balance: failedBalance(), retrieved: { status: 'succeeded' } });

    await expect(call(h)).rejects.toBeInstanceOf(BalanceAlreadySettledException);

    expect(h.paymentRepo.attachIntent).toHaveBeenCalledWith(
      BALANCE_ID,
      'pi_bal',
      PaymentStatus.SUCCEEDED,
      expect.any(Date),
    );
    expect(h.balanceRow()?.status).toBe(PaymentStatus.SUCCEEDED);
    // Choice (b): COMPLETED → PAID stays the webhook's alone.
    expect(h.requestRepo.update).not.toHaveBeenCalled();
    expect(h.record()?.status).toBe(ServiceRequestStatus.COMPLETED);
    expectNoServerSideCharge(h);
  });

  it('canceled → 409, nothing written', async () => {
    const h = buildHarness({ balance: failedBalance(), retrieved: { status: 'canceled' } });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
    expect(h.paymentRepo.setPaymentMethodWhileAwaitingClient).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('unreadable intent → 502, never a fresh intent, nothing written', async () => {
    const h = buildHarness({ balance: failedBalance(), retrieved: new Error('network down') });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceIntentUnreadableException);
    expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
    expect(h.paymentRepo.setPaymentMethodWhileAwaitingClient).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it.each([
    ['amount', { amount: 13000 }],
    ['currency', { currency: 'usd' }],
  ])('409 when the intent and the row disagree on the %s — nothing returned, nothing written', async (_l, drift) => {
    const h = buildHarness({ balance: failedBalance(), retrieved: drift });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceIntentMismatchException);
    expect(h.paymentRepo.setPaymentMethodWhileAwaitingClient).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('422 when the client has no default card — nothing written', async () => {
    const h = buildHarness({ balance: failedBalance(), defaultCard: false });
    await expect(call(h)).rejects.toBeInstanceOf(BalanceConfirmationCardRequiredException);
    expect(h.paymentRepo.setPaymentMethodWhileAwaitingClient).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('the exact sequence: confirm-completion 202 → the row is confirmable by THIS endpoint', async () => {
    const h = buildHarness({ createThrows: authenticationRequired });
    const outcome = await h.service.confirmCompletion(REQUEST_ID, CLIENT_ID);
    expect(outcome.balanceAwaitingClient).toBe(true);

    h.intents.create.mockClear();
    await expect(call(h)).resolves.toMatchObject({
      clientSecret: 'pi_bal_secret_abc',
      grossAmount: '120.00',
    });
    expectNoServerSideCharge(h);
  });
});

describe('deposits-awaiting-confirmation — the item carries paymentType', () => {
  it.each([PaymentType.DEPOSIT, PaymentType.BALANCE] as const)('%s is passed through', (paymentType) => {
    const record: DepositAwaitingConfirmationRecord = {
      serviceRequestId: REQUEST_ID,
      paymentType,
      title: 'Coloration',
      grossAmount: '120.00',
      currency: 'CAD',
      failedAtUtc: new Date('2026-10-08T15:00:00Z'),
    };
    expect(DepositAwaitingConfirmationItemDto.from(record)).toEqual({
      serviceRequestId: REQUEST_ID,
      paymentType,
      title: 'Coloration',
      grossAmount: '120.00',
      currency: 'CAD',
      failedAtUtc: '2026-10-08T15:00:00.000Z',
    });
  });
});
