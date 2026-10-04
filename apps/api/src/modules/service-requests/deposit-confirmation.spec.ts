import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
import {
  DepositAlreadySettledException,
  DepositConfirmationCardRequiredException,
  DepositIntentMismatchException,
  DepositIntentUnreadableException,
  DepositNotAwaitingConfirmationException,
} from '../payments/exceptions/payments.exceptions';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import { InvalidStateTransitionException } from './exceptions/service-request.exceptions';
import { DEPOSIT_LIVE_REQUEST_STATUSES } from './constants';

/**
 * The CLIENT's browser-side confirmation of a deposit whose off-session charge
 * failed (3-D Secure demanded on every payment, or a declined card since
 * replaced): `POST /service-requests/:id/deposit-confirmation`.
 *
 * Real `ServiceRequestsService` + real `PaymentsService`; Stripe and the
 * repositories are stand-ins. The invariant asserted throughout: **the server
 * never creates nor confirms a PaymentIntent here** — the browser confirms THE
 * SAME intent, which can yield at most one charge — and the only write on the
 * happy path is `payment_method_id`.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const WORKER_ID = '66666666-6666-4666-8666-666666666666';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const OLD_PM_ROW_ID = '88888888-8888-4888-8888-888888888888';
const NEW_PM_ROW_ID = '99999999-9999-4999-8999-999999999999';

function request(over: Partial<ServiceRequestReadRecord> = {}): ServiceRequestReadRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    status: ServiceRequestStatus.ASSIGNED,
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
    completedAtUtc: null,
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

/** A deposit whose off-session charge was refused WITH an intent on file. */
function failedDeposit(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    serviceRequestId: REQUEST_ID,
    paymentType: PaymentType.DEPOSIT,
    payerUserId: CLIENT_ID,
    payerOrganizationId: null,
    recipientServiceProviderId: PROVIDER_ID,
    paymentMethodId: OLD_PM_ROW_ID,
    stripePaymentIntentId: 'pi_3ds',
    status: PaymentStatus.FAILED,
    grossAmount: '30.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '3.00',
    taxAmount: '0.00',
    providerNetAmount: '27.00',
    capturedAtUtc: null,
    failedAtUtc: new Date(),
    failureReason: 'Your card was declined. This transaction requires authentication.',
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...over,
  };
}

type Intent = { id: string; status: string; amount: number; currency: string; client_secret: string | null };

function buildHarness(opts: {
  record?: ServiceRequestReadRecord | null;
  existing?: PaymentRecord | null;
  /** Result of `paymentIntents.retrieve` (merged on a matching intent), or an Error. */
  retrieved?: Partial<Intent> | Error;
  defaultCard?: boolean;
  /** Result of `setPaymentMethodWhileFailed` (false = a retry re-armed the row meanwhile). */
  pmWriteTouched?: boolean;
}) {
  const intents = {
    create: jest.fn().mockResolvedValue({ id: 'pi_new', status: 'succeeded' }),
    confirm: jest.fn().mockResolvedValue({ id: 'pi_3ds', status: 'succeeded' }),
    retrieve: jest.fn(async (): Promise<Intent> => {
      if (opts.retrieved instanceof Error) throw opts.retrieved;
      return {
        id: 'pi_3ds',
        status: 'requires_payment_method',
        amount: 3000,
        currency: 'cad',
        client_secret: 'pi_3ds_secret_abc',
        ...opts.retrieved,
      };
    }),
  };
  const paymentRepo = {
    findByServiceRequestAndType: jest
      .fn()
      .mockResolvedValue(opts.existing === undefined ? failedDeposit() : opts.existing),
    create: jest.fn(),
    prepareRetry: jest.fn(),
    prepareConfirmRetry: jest.fn(),
    attachIntent: jest.fn().mockResolvedValue(null),
    recordFailure: jest.fn(),
    setPaymentMethodWhileFailed: jest.fn().mockResolvedValue(opts.pmWriteTouched ?? true),
  };
  const pmRepo = {
    findDefaultByUserId: jest.fn().mockResolvedValue(
      opts.defaultCard === false
        ? null
        : {
            id: NEW_PM_ROW_ID,
            ownerUserId: CLIENT_ID,
            ownerOrganizationId: null,
            stripePaymentMethodId: 'pm_new_default',
            type: PaymentMethodType.CARD,
            brand: 'VISA',
            last4: '4242',
            expMonth: 12,
            expYear: 2030,
            isDefault: true,
            createdAtUtc: new Date(),
            deletedAtUtc: null,
          },
    ),
  };

  const paymentsService = new PaymentsService(
    { client: { paymentIntents: intents } } as unknown as StripeService,
    paymentRepo as unknown as PaymentRepository,
    pmRepo as unknown as PaymentMethodRepository,
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
  const prepare = jest.spyOn(paymentsService, 'prepareClientDepositConfirmation');

  const requestRepo = {
    findById: jest.fn().mockResolvedValue(opts.record === undefined ? request() : opts.record),
  };
  const service = new ServiceRequestsService(
    requestRepo as unknown as ServiceRequestRepository,
    {
      findLiveByRequestId: jest.fn().mockResolvedValue({ workerUserId: WORKER_ID }),
    } as unknown as ServiceRequestAssignmentRepository,
    {} as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    {} as unknown as NotificationsService,
    paymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    { isEligibleForCategory: jest.fn().mockResolvedValue(true) } as unknown as ProfessionalServiceCategoryRepository,
  );

  /** Every write this endpoint could make besides the card pointer. */
  const otherWrites = [
    paymentRepo.create,
    paymentRepo.prepareRetry,
    paymentRepo.prepareConfirmRetry,
    paymentRepo.recordFailure,
  ];
  return { service, intents, paymentRepo, pmRepo, prepare, otherWrites };
}

type Harness = ReturnType<typeof buildHarness>;

/** No intent is ever created or confirmed server-side, whatever the branch. */
function expectNoServerSideCharge(h: Harness): void {
  expect(h.intents.create).not.toHaveBeenCalled();
  expect(h.intents.confirm).not.toHaveBeenCalled();
}

const call = (h: Harness, caller = CLIENT_ID) =>
  h.service.prepareDepositConfirmation(REQUEST_ID, caller);

describe('prepareDepositConfirmation — request-side guards (404 → 403 → 409)', () => {
  it('404 when the request does not exist — nothing read at Stripe', async () => {
    const h = buildHarness({ record: null });
    await expect(call(h)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it('403 when the caller is not the client — not even the assigned provider', async () => {
    for (const caller of [STRANGER_ID, WORKER_ID]) {
      const h = buildHarness({});
      await expect(call(h, caller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.intents.retrieve).not.toHaveBeenCalled();
    }
  });

  const deadStatuses = Object.values(ServiceRequestStatus).filter(
    (s) => !(DEPOSIT_LIVE_REQUEST_STATUSES as readonly ServiceRequestStatus[]).includes(s),
  );
  it.each(deadStatuses)('409 on a %s request — nothing read at Stripe', async (status) => {
    const h = buildHarness({ record: request({ status }) });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it.each([...DEPOSIT_LIVE_REQUEST_STATUSES])(
    'delegates on a live (%s) request',
    async (status) => {
      const h = buildHarness({ record: request({ status }) });
      await expect(call(h)).resolves.toMatchObject({ serviceRequestId: REQUEST_ID });
    },
  );

  it.each(Object.values(ServiceRequestStatus))(
    'agrees with retryDeposit on %s: both refuse the same request statuses',
    async (status) => {
      // The list, this endpoint and the provider's retry must say the same
      // thing, or the page offers a button the endpoint refuses (or the other
      // way round). retryDeposit's guard is written inline; this pins it.
      const refusesConfirm = await (async () => {
        const h = buildHarness({ record: request({ status }) });
        try {
          await call(h);
          return false;
        } catch (err) {
          return err instanceof DepositNotAwaitingConfirmationException && !h.prepare.mock.calls.length;
        }
      })();
      const refusesRetry = await (async () => {
        const h = buildHarness({ record: request({ status }) });
        try {
          await h.service.retryDeposit(REQUEST_ID, WORKER_ID);
          return false;
        } catch (err) {
          return err instanceof InvalidStateTransitionException;
        }
      })();
      expect(refusesConfirm).toBe(refusesRetry);
    },
  );
});

describe('prepareClientDepositConfirmation — the deposit row', () => {
  it('409 when there is no deposit row — nothing read at Stripe', async () => {
    const h = buildHarness({ existing: null });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it.each(Object.values(PaymentStatus).filter((s) => s !== PaymentStatus.FAILED))(
    '409 on a %s deposit — nothing read at Stripe',
    async (status) => {
      const h = buildHarness({ existing: failedDeposit({ status }) });
      await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
      expect(h.intents.retrieve).not.toHaveBeenCalled();
    },
  );

  it('409 on a FAILED deposit with NO PaymentIntent — the browser has nothing to confirm', async () => {
    const h = buildHarness({ existing: failedDeposit({ stripePaymentIntentId: null }) });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });

  it('409 when the deposit payer is not the caller', async () => {
    const h = buildHarness({ existing: failedDeposit({ payerUserId: STRANGER_ID }) });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expect(h.intents.retrieve).not.toHaveBeenCalled();
  });
});

describe('prepareClientDepositConfirmation — the PaymentIntent, read at Stripe on the click', () => {
  it.each(['requires_payment_method', 'requires_confirmation', 'requires_action'])(
    '%s → returns the client secret + the CURRENT default card; writes payment_method_id ONLY',
    async (status) => {
      const h = buildHarness({ retrieved: { status } });

      const out = await call(h);

      expect(out).toEqual({
        serviceRequestId: REQUEST_ID,
        clientSecret: 'pi_3ds_secret_abc',
        stripePaymentMethodId: 'pm_new_default',
        grossAmount: '30.00',
        currency: 'CAD',
      });
      expect(h.intents.retrieve).toHaveBeenCalledWith('pi_3ds');
      expect(h.paymentRepo.setPaymentMethodWhileFailed).toHaveBeenCalledWith(
        PAYMENT_ID,
        NEW_PM_ROW_ID,
      );
      expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
      for (const write of h.otherWrites) expect(write).not.toHaveBeenCalled();
      expectNoServerSideCharge(h);
    },
  );

  it.each([
    ['succeeded', PaymentStatus.SUCCEEDED],
    ['processing', PaymentStatus.PROCESSING],
    ['requires_capture', PaymentStatus.PENDING],
  ])(
    '%s → reconciles the row forward, then 409 « already paid » (the web’s post-success sync)',
    async (status, mapped) => {
      const h = buildHarness({ retrieved: { status } });

      await expect(call(h)).rejects.toBeInstanceOf(DepositAlreadySettledException);

      expect(h.paymentRepo.attachIntent).toHaveBeenCalledWith(
        PAYMENT_ID,
        'pi_3ds',
        mapped,
        mapped === PaymentStatus.SUCCEEDED ? expect.any(Date) : null,
      );
      expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
      for (const write of h.otherWrites) expect(write).not.toHaveBeenCalled();
      expectNoServerSideCharge(h);
    },
  );

  it('canceled → 409, nothing written (only the provider retry can issue a fresh intent)', async () => {
    const h = buildHarness({ retrieved: { status: 'canceled' } });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
    expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('unreadable intent → 502, never a fresh intent, nothing written', async () => {
    const h = buildHarness({ retrieved: new Error('network down') });
    await expect(call(h)).rejects.toBeInstanceOf(DepositIntentUnreadableException);
    expect(h.paymentRepo.attachIntent).not.toHaveBeenCalled();
    expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
    for (const write of h.otherWrites) expect(write).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it.each([
    ['amount', { amount: 4000 }],
    ['currency', { currency: 'usd' }],
  ])('409 when the intent and the row disagree on the %s — nothing returned, nothing written', async (_l, drift) => {
    const h = buildHarness({ retrieved: drift });
    await expect(call(h)).rejects.toBeInstanceOf(DepositIntentMismatchException);
    expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
    expect(h.pmRepo.findDefaultByUserId).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('422 when the client has no default card — nothing written', async () => {
    const h = buildHarness({ defaultCard: false });
    await expect(call(h)).rejects.toBeInstanceOf(DepositConfirmationCardRequiredException);
    expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
    expectNoServerSideCharge(h);
  });

  it('409 when a provider retry re-armed the row between the read and the write', async () => {
    const h = buildHarness({ pmWriteTouched: false });
    await expect(call(h)).rejects.toBeInstanceOf(DepositNotAwaitingConfirmationException);
    expectNoServerSideCharge(h);
  });

  it('502 when the intent carries no client secret — and the card pointer is not moved', async () => {
    const h = buildHarness({ retrieved: { client_secret: null } });
    await expect(call(h)).rejects.toBeInstanceOf(DepositIntentUnreadableException);
    expect(h.paymentRepo.setPaymentMethodWhileFailed).not.toHaveBeenCalled();
  });
});
