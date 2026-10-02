import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import {
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
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import { AgreedPriceUnavailableException } from './exceptions/service-request.exceptions';

/**
 * `retryDeposit` — the BASIS of the amount it charges.
 *
 * R1: a retry charges EXACTLY what the initial capture would have charged at
 * acceptance. The accept paths pin what they hand to `captureDeposit`
 * (`accept-request.atomicity.spec.ts`: the request's estimate;
 * `quotes-accept.deposit.spec.ts`: the ACCEPTED quote). This spec pins that the
 * retry hands `captureDeposit` the SAME basis — and, with a REAL
 * `PaymentsService` over a mocked Stripe, that the PaymentIntent the retry
 * creates carries the same amount, currency and fee as the one the initial
 * capture created, under the same idempotency key.
 *
 * Why the key matters: `retryFailedDeposit` re-issues under `dep_<id>` on
 * purpose (a charge that silently went through replays instead of charging
 * twice). That guarantee only holds if the retry sends the SAME params the key
 * first saw — a budget-based amount on a tender turned it into an
 * `idempotency_error` at best.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const WORKER_ID = '66666666-6666-4666-8666-666666666666';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const PM_ROW_ID = '88888888-8888-4888-8888-888888888888';
const ACCEPTED_AT = new Date('2026-09-20T15:00:00Z');

function tender(over: Partial<ServiceRequestReadRecord> = {}): ServiceRequestReadRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.PROJECT_TENDER,
    status: ServiceRequestStatus.ASSIGNED,
    serviceCategoryId: '44444444-4444-4444-8444-444444444444',
    serviceItemId: null,
    requestedServiceProviderId: null,
    assignedServiceProviderId: PROVIDER_ID,
    title: 'Refaire la salle de bain',
    description: 'd',
    serviceAddress: '1 rue Test',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    desiredStartAtUtc: null,
    desiredEndAtUtc: null,
    scheduledAtUtc: null,
    // The client's indicative BUDGET — deliberately ≠ the quote.
    estimatedAmount: '80.00',
    estimatedCurrency: 'CAD',
    finalAmount: null,
    finalCurrency: null,
    responseDeadlineUtc: null,
    quotesDeadlineUtc: null,
    acceptedAtUtc: ACCEPTED_AT,
    completedAtUtc: null,
    paidAtUtc: null,
    contestedAtUtc: null,
    cancelledAtUtc: null,
    cancellationReason: null,
    cancelledByUserId: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    acceptedQuote: { amount: '60.00', currency: 'CAD' },
    ...over,
  };
}

function directBooking(over: Partial<ServiceRequestReadRecord> = {}): ServiceRequestReadRecord {
  return tender({
    requestType: ServiceRequestType.DIRECT_BOOKING,
    requestedServiceProviderId: PROVIDER_ID,
    serviceItemId: '99999999-9999-4999-8999-999999999999',
    estimatedAmount: '150.00',
    estimatedCurrency: 'CAD',
    acceptedQuote: null,
    ...over,
  });
}

function failedDeposit(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    serviceRequestId: REQUEST_ID,
    paymentType: PaymentType.DEPOSIT,
    payerUserId: CLIENT_ID,
    payerOrganizationId: null,
    recipientServiceProviderId: PROVIDER_ID,
    paymentMethodId: PM_ROW_ID,
    // No PaymentIntent on file: the branch that CREATES one, i.e. the only
    // branch where the amount the retry computes is the amount Stripe charges.
    stripePaymentIntentId: null,
    status: PaymentStatus.FAILED,
    grossAmount: '12.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '1.20',
    taxAmount: '0.00',
    providerNetAmount: '10.80',
    capturedAtUtc: null,
    failedAtUtc: new Date(),
    failureReason: "No such destination: 'acct_fixture_linkr_dev'",
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...over,
  };
}

function buildHarness(record: ServiceRequestReadRecord, existing: PaymentRecord | null) {
  const intents = {
    create: jest.fn().mockResolvedValue({ id: 'pi_new', status: 'succeeded' }),
    retrieve: jest.fn(),
    confirm: jest.fn(),
  };
  const paymentRepo = {
    findByServiceRequestAndType: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue(failedDeposit({ status: PaymentStatus.PENDING })),
    prepareRetry: jest.fn().mockResolvedValue(undefined),
    attachIntent: jest.fn().mockResolvedValue(null),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const pmRepo = {
    findDefaultByUserId: jest.fn().mockResolvedValue({
      id: PM_ROW_ID,
      ownerUserId: CLIENT_ID,
      ownerOrganizationId: null,
      stripePaymentMethodId: 'pm_current_default',
      type: PaymentMethodType.CARD,
      brand: 'VISA',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
      createdAtUtc: new Date(),
      deletedAtUtc: null,
    }),
  } as unknown as PaymentMethodRepository;
  const connectRepo = {
    findByServiceProviderId: jest.fn().mockResolvedValue({
      stripeAccountId: 'acct_test',
      chargesEnabled: true,
    }),
  } as unknown as StripeConnectAccountRepository;
  const usersRepo = {
    findById: jest.fn().mockResolvedValue({ id: CLIENT_ID, stripeCustomerId: 'cus_test' }),
  } as unknown as UsersRepository;

  const paymentsService = new PaymentsService(
    { client: { paymentIntents: intents } } as unknown as StripeService,
    paymentRepo as unknown as PaymentRepository,
    pmRepo,
    connectRepo,
    usersRepo,
    {
      getOrThrow: jest.fn((key: string) =>
        key === 'PLATFORM_DEPOSIT_RATE_PERCENT' ? 20 : 10,
      ),
    } as unknown as ConfigService,
  );
  const captureDeposit = jest.spyOn(paymentsService, 'captureDeposit');

  const requestRepo = { findById: jest.fn().mockResolvedValue(record) };
  const assignmentRepo = {
    findLiveByRequestId: jest.fn().mockResolvedValue({ workerUserId: WORKER_ID }),
  };

  const service = new ServiceRequestsService(
    requestRepo as unknown as ServiceRequestRepository,
    assignmentRepo as unknown as ServiceRequestAssignmentRepository,
    {} as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    {} as unknown as NotificationsService,
    paymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    { isEligibleForCategory: jest.fn().mockResolvedValue(true) } as unknown as ProfessionalServiceCategoryRepository,
  );

  /** Every write the retry could make — none may happen on a refusal. */
  const writes = [
    paymentRepo.prepareRetry,
    paymentRepo.create,
    paymentRepo.attachIntent,
    paymentRepo.recordFailure,
  ];
  /** Every Stripe call the retry could make. */
  const stripeCalls = [intents.create, intents.retrieve, intents.confirm];

  return { service, paymentsService, paymentRepo, intents, captureDeposit, writes, stripeCalls };
}

type Harness = ReturnType<typeof buildHarness>;

/** The params of the i-th `paymentIntents.create` call: [body, options]. */
function createdIntent(h: Harness, i = 0) {
  return h.intents.create.mock.calls[i] as [
    { amount: number; currency: string; application_fee_amount: number } & Record<string, unknown>,
    { idempotencyKey: string },
  ];
}

describe('retryDeposit — the deposit basis is the AGREED price', () => {
  it('DIRECT_BOOKING: charges on the request estimate (150,00 → 30,00)', async () => {
    const h = buildHarness(directBooking(), failedDeposit());

    await h.service.retryDeposit(REQUEST_ID, WORKER_ID);

    expect(h.captureDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ agreedAmount: '150.00', agreedCurrency: 'CAD' }),
    );
    const [body] = createdIntent(h);
    expect(body).toMatchObject({ amount: 3000, currency: 'cad', application_fee_amount: 300 });
    expect(h.paymentRepo.prepareRetry).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ grossAmount: '30.00', platformFeeAmount: '3.00' }),
    );
  });

  it('PROJECT_TENDER, budget 80 ≠ quote 60: it is the QUOTE that is charged (12,00, not 16,00)', async () => {
    const h = buildHarness(tender(), failedDeposit());

    await h.service.retryDeposit(REQUEST_ID, WORKER_ID);

    expect(h.captureDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ agreedAmount: '60.00', agreedCurrency: 'CAD' }),
    );
    const [body] = createdIntent(h);
    expect(body.amount).toBe(1200);
    expect(body.amount).not.toBe(1600);
    expect(body.application_fee_amount).toBe(120);
    expect(h.paymentRepo.prepareRetry).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({
        grossAmount: '12.00',
        currency: 'CAD',
        platformFeeAmount: '1.20',
        providerNetAmount: '10.80',
      }),
    );
  });

  it('PROJECT_TENDER with an EMPTY budget: charges on the quote instead of refusing', async () => {
    const h = buildHarness(
      tender({
        estimatedAmount: null,
        estimatedCurrency: null,
        acceptedQuote: { amount: '200.00', currency: 'CAD' },
      }),
      failedDeposit({ grossAmount: '40.00', platformFeeAmount: '4.00', providerNetAmount: '36.00' }),
    );

    await h.service.retryDeposit(REQUEST_ID, WORKER_ID);

    expect(createdIntent(h)[0]).toMatchObject({ amount: 4000, currency: 'cad' });
  });

  it("PROJECT_TENDER: the currency is the QUOTE's, not the budget's", async () => {
    const h = buildHarness(
      tender({
        estimatedAmount: '80.00',
        estimatedCurrency: 'USD',
        acceptedQuote: { amount: '60.00', currency: 'CAD' },
      }),
      failedDeposit(),
    );

    await h.service.retryDeposit(REQUEST_ID, WORKER_ID);

    expect(h.captureDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ agreedCurrency: 'CAD' }),
    );
    expect(createdIntent(h)[0].currency).toBe('cad');
    expect(h.paymentRepo.prepareRetry).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ currency: 'CAD' }),
    );
  });
});

describe('retryDeposit — no agreed price: 409, before Stripe and before any write', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('accepted tender WITHOUT an ACCEPTED quote → 409, never a fallback on the budget', async () => {
    const h = buildHarness(tender({ acceptedQuote: null }), failedDeposit());

    const err = await h.service.retryDeposit(REQUEST_ID, WORKER_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgreedPriceUnavailableException);
    expect((err as AgreedPriceUnavailableException).getStatus()).toBe(409);

    expect(h.captureDeposit).not.toHaveBeenCalled();
    for (const call of h.stripeCalls) expect(call).not.toHaveBeenCalled();
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it('a request with no accepted_at_utc → 409 as well (direct booking, estimate present)', async () => {
    const h = buildHarness(directBooking({ acceptedAtUtc: null }), failedDeposit());

    await expect(h.service.retryDeposit(REQUEST_ID, WORKER_ID)).rejects.toBeInstanceOf(
      AgreedPriceUnavailableException,
    );
    expect(h.captureDeposit).not.toHaveBeenCalled();
    for (const call of h.stripeCalls) expect(call).not.toHaveBeenCalled();
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it('logs a warning carrying the request id and nothing else', async () => {
    const h = buildHarness(tender({ acceptedQuote: null }), failedDeposit());

    await expect(h.service.retryDeposit(REQUEST_ID, WORKER_ID)).rejects.toBeInstanceOf(
      AgreedPriceUnavailableException,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(REQUEST_ID);
    for (const leaked of [CLIENT_ID, PROVIDER_ID, WORKER_ID, '80', 'CAD']) {
      expect(message).not.toContain(leaked);
    }
  });
});

describe('retryDeposit — R1: the retry sends Stripe what the initial capture sent', () => {
  // The initial capture is driven with the basis each accept path passes —
  // pinned by accept-request.atomicity.spec.ts (estimate) and
  // quotes-accept.deposit.spec.ts (ACCEPTED quote) — through the SAME real
  // `captureDeposit`. Then the retry runs on the FAILED row. The two
  // PaymentIntent bodies must be identical where money is concerned, under
  // the same key: that is what lets Stripe replay instead of refusing.
  async function initialThenRetry(
    record: ServiceRequestReadRecord,
    acceptBasis: { agreedAmount: string; agreedCurrency: string },
  ) {
    const initial = buildHarness(record, null);
    await initial.paymentsService.captureDeposit({
      serviceRequestId: REQUEST_ID,
      clientUserId: CLIENT_ID,
      serviceProviderId: PROVIDER_ID,
      ...acceptBasis,
    });

    const retry = buildHarness(record, failedDeposit());
    await retry.service.retryDeposit(REQUEST_ID, WORKER_ID);

    return { first: createdIntent(initial), second: createdIntent(retry) };
  }

  const MONEY_FIELDS = [
    'amount',
    'currency',
    'application_fee_amount',
    'transfer_data',
    'customer',
    'payment_method',
  ] as const;

  it.each([
    ['DIRECT_BOOKING (estimate)', directBooking(), { agreedAmount: '150.00', agreedCurrency: 'CAD' }],
    ['PROJECT_TENDER, budget ≠ quote', tender(), { agreedAmount: '60.00', agreedCurrency: 'CAD' }],
    [
      'PROJECT_TENDER, empty budget',
      tender({
        estimatedAmount: null,
        estimatedCurrency: null,
        acceptedQuote: { amount: '333.33', currency: 'CAD' },
      }),
      { agreedAmount: '333.33', agreedCurrency: 'CAD' },
    ],
  ])('%s', async (_label, record, acceptBasis) => {
    const { first, second } = await initialThenRetry(record, acceptBasis);

    for (const field of MONEY_FIELDS) {
      expect(first[0][field]).toBeDefined();
      expect(second[0][field]).toEqual(first[0][field]);
    }
    expect(second[1].idempotencyKey).toBe(`dep_${REQUEST_ID}`);
    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
  });
});
