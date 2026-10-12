import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
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
import { RefundsService } from '../payments/refunds.service';
import { PaymentRepository, PaymentRecord } from '../payments/repositories/payment.repository';
import { PaymentMethodRepository } from '../payments/repositories/payment-method.repository';
import { StripeConnectAccountRepository } from '../stripe-connect/repositories/stripe-connect-account.repository';
import { StripeService } from '../stripe-connect/stripe.service';
import { StripeConnectService } from '../stripe-connect/stripe-connect.service';
import { StripeWebhookProcessor } from '../stripe-webhooks/stripe-webhook.processor';
import { StripeWebhookJob } from '../../queue/queue.constants';
import { PaymentType } from '../payments/enums/payment-type.enum';
import { PaymentStatus } from '../payments/enums/payment-status.enum';
import { PaymentMethodType } from '../payments/enums/payment-method-type.enum';
import {
  BalanceAlreadySettledException,
  BalanceNotAwaitingConfirmationException,
} from '../payments/exceptions/payments.exceptions';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';

/**
 * POINT 4 of the balance lot — who moves the request COMPLETED → PAID once the
 * client has confirmed a 3-D Secure balance in their browser?
 *
 * Choice (b) (`docs/reports/3ds-solde-recon.md` §3): the WEBHOOK, and only the
 * webhook. The confirmation endpoint reconciles the payment ROW (it may mark it
 * SUCCEEDED before the webhook lands) and never touches the request.
 *
 * The risk the mandate names: « on n'avance jamais sur un statut terminal » —
 * would a row the endpoint already marked SUCCEEDED stop the webhook from
 * driving PAID? It does not, because `PaymentsService.markSucceeded` re-reads
 * the row when its conditional UPDATE is a no-op. This file proves it on BOTH
 * arrival orders, with the REAL webhook processor, the REAL PaymentsService
 * and the REAL ServiceRequestsService; only Stripe and the repositories are
 * stand-ins — and the payment repository's forward-only UPDATE mirrors the
 * real SQL guard (`status NOT IN (terminal)`), which is the whole point.
 *
 * Asserted each time: the request ends PAID, by EXACTLY ONE write, and no
 * notification at all leaves (none is tied to PAID — so « no double email »
 * is « zero email »).
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const BALANCE_ID = '78787878-7878-4878-8878-787878787878';
const PM_ROW_ID = '99999999-9999-4999-8999-999999999999';

/** Mirrors `TERMINAL_STATUSES` in payment.repository.ts — the guard under test. */
const TERMINAL = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.CANCELLED,
  PaymentStatus.PARTIALLY_REFUNDED,
];

function completedRequest(): ServiceRequestReadRecord {
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
  };
}

/** The balance as the off-session 3-D Secure refusal left it. */
function failedBalance(): PaymentRecord {
  return {
    id: BALANCE_ID,
    serviceRequestId: REQUEST_ID,
    paymentType: PaymentType.BALANCE,
    payerUserId: CLIENT_ID,
    payerOrganizationId: null,
    recipientServiceProviderId: PROVIDER_ID,
    paymentMethodId: PM_ROW_ID,
    stripePaymentIntentId: 'pi_bal',
    status: PaymentStatus.FAILED,
    grossAmount: '120.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '12.00',
    taxAmount: '0.00',
    providerNetAmount: '108.00',
    capturedAtUtc: null,
    failedAtUtc: new Date(),
    failureReason: 'Your card was declined. This transaction requires authentication.',
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

function buildWorld() {
  let request: ServiceRequestReadRecord = completedRequest();
  let balance: PaymentRecord = failedBalance();

  // The client has just passed the 3-D Secure challenge in their browser:
  // Stripe now reports the SAME intent as succeeded.
  const intents = {
    create: jest.fn(),
    confirm: jest.fn(),
    retrieve: jest.fn(async () => ({
      id: 'pi_bal',
      status: 'succeeded',
      amount: 12000,
      currency: 'cad',
      client_secret: 'pi_bal_secret_abc',
    })),
  };

  const paymentRepo = {
    findByServiceRequestAndType: jest.fn(async (_id: string, type: PaymentType) =>
      type === PaymentType.BALANCE ? balance : null,
    ),
    findByStripeIntentId: jest.fn(async (pi: string) =>
      balance.stripePaymentIntentId === pi ? balance : null,
    ),
    // The endpoint's reconciliation (unconditional, by id — like the real SQL).
    attachIntent: jest.fn(async (_id: string, pi: string, status: PaymentStatus) => {
      balance = { ...balance, stripePaymentIntentId: pi, status };
      return balance;
    }),
    // The webhook's forward-only UPDATE: refuses to touch a terminal row and
    // then returns NOTHING — exactly like `WHERE status NOT IN (terminal)`.
    markSucceededByIntentId: jest.fn(async (pi: string) => {
      if (balance.stripePaymentIntentId !== pi || TERMINAL.includes(balance.status)) return null;
      balance = { ...balance, status: PaymentStatus.SUCCEEDED, capturedAtUtc: new Date() };
      return balance;
    }),
    setPaymentMethodWhileAwaitingClient: jest.fn(async () => true),
  };

  const paymentsService = new PaymentsService(
    { client: { paymentIntents: intents } } as unknown as StripeService,
    paymentRepo as unknown as PaymentRepository,
    {
      findDefaultByUserId: jest.fn().mockResolvedValue({
        id: PM_ROW_ID,
        stripePaymentMethodId: 'pm_current_default',
        type: PaymentMethodType.CARD,
      }),
    } as unknown as PaymentMethodRepository,
    {} as unknown as StripeConnectAccountRepository,
    {} as unknown as UsersRepository,
    {
      getOrThrow: jest.fn((key: string) => (key === 'PLATFORM_DEPOSIT_RATE_PERCENT' ? 20 : 10)),
    } as unknown as ConfigService,
  );

  // Every write to the request goes through here; each one is counted.
  const requestRepo = {
    findById: jest.fn(async () => request),
    update: jest.fn(async (_id: string, data: Partial<ServiceRequestReadRecord>) => {
      request = { ...request, ...data };
    }),
  };

  // Any notification method, called or not, is recorded.
  const notificationCalls: string[] = [];
  const notifications = new Proxy(
    {},
    {
      get: (_t, prop) => async () => {
        notificationCalls.push(String(prop));
      },
    },
  ) as unknown as NotificationsService;

  const service = new ServiceRequestsService(
    requestRepo as unknown as ServiceRequestRepository,
    {} as unknown as ServiceRequestAssignmentRepository,
    {} as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    notifications,
    paymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    {} as unknown as ProfessionalServiceCategoryRepository,
  );

  const processor = new StripeWebhookProcessor(
    {} as unknown as StripeConnectService,
    paymentsService,
    {} as unknown as RefundsService,
    service,
  );
  const webhookSucceeded = () =>
    processor.process({
      data: { eventId: 'evt_bal', type: 'payment_intent.succeeded', data: { id: 'pi_bal' } },
    } as unknown as Job<StripeWebhookJob>);

  /** The browser's post-success sync: the same POST, which reconciles. */
  const endpoint = () => service.prepareBalanceConfirmation(REQUEST_ID, CLIENT_ID);

  /** The writes that moved the request to PAID. */
  const paidWrites = () =>
    requestRepo.update.mock.calls.filter(([, data]) => data.status === ServiceRequestStatus.PAID);

  return {
    endpoint,
    webhookSucceeded,
    paymentRepo,
    intents,
    requestRepo,
    paidWrites,
    notificationCalls,
    request: () => request,
    balance: () => balance,
  };
}

describe('Point 4 — COMPLETED → PAID once, whichever of the endpoint and the webhook arrives first', () => {
  it('ENDPOINT then WEBHOOK: the endpoint marks the row SUCCEEDED, the webhook still drives PAID — once', async () => {
    const w = buildWorld();

    // 1. The browser's sync: the intent is settled → row reconciled, 409.
    await expect(w.endpoint()).rejects.toBeInstanceOf(BalanceAlreadySettledException);
    expect(w.balance().status).toBe(PaymentStatus.SUCCEEDED);
    // Choice (b): the endpoint did NOT move the request.
    expect(w.request().status).toBe(ServiceRequestStatus.COMPLETED);
    expect(w.requestRepo.update).not.toHaveBeenCalled();

    // 2. The webhook: its forward-only UPDATE is a no-op on a SUCCEEDED row…
    await w.webhookSucceeded();
    const [markResult] = await Promise.all(
      w.paymentRepo.markSucceededByIntentId.mock.results.map((r) => r.value),
    );
    expect(markResult).toBeNull();
    // …yet `markSucceeded` re-read the row, and the request is PAID.
    expect(w.paymentRepo.findByStripeIntentId).toHaveBeenCalledWith('pi_bal');
    expect(w.request().status).toBe(ServiceRequestStatus.PAID);
    expect(w.request().paidAtUtc).toBeInstanceOf(Date);
    expect(w.paidWrites()).toHaveLength(1);

    // 3. A Stripe redelivery changes nothing.
    await w.webhookSucceeded();
    expect(w.paidWrites()).toHaveLength(1);
    expect(w.requestRepo.update).toHaveBeenCalledTimes(1);

    // Nobody was mailed, and nothing was charged server-side.
    expect(w.notificationCalls).toEqual([]);
    expect(w.intents.create).not.toHaveBeenCalled();
    expect(w.intents.confirm).not.toHaveBeenCalled();
  });

  it('WEBHOOK then ENDPOINT: the webhook settles the row and drives PAID; the endpoint then refuses before reading Stripe', async () => {
    const w = buildWorld();

    // 1. The webhook lands first: FAILED → SUCCEEDED (not terminal), → PAID.
    await w.webhookSucceeded();
    expect(w.balance().status).toBe(PaymentStatus.SUCCEEDED);
    expect(w.request().status).toBe(ServiceRequestStatus.PAID);
    expect(w.paidWrites()).toHaveLength(1);

    // 2. The browser's sync arrives late: the request is PAID → 409 at the
    //    request guard, before any Stripe read or row write.
    await expect(w.endpoint()).rejects.toBeInstanceOf(BalanceNotAwaitingConfirmationException);
    expect(w.intents.retrieve).not.toHaveBeenCalled();
    expect(w.paymentRepo.attachIntent).not.toHaveBeenCalled();

    // 3. Still exactly one transition, and still no email.
    expect(w.paidWrites()).toHaveLength(1);
    expect(w.requestRepo.update).toHaveBeenCalledTimes(1);
    expect(w.notificationCalls).toEqual([]);
    expect(w.intents.create).not.toHaveBeenCalled();
    expect(w.intents.confirm).not.toHaveBeenCalled();
  });
});
