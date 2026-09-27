import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { QuotesService } from './quotes.service';
import { QuoteRecord, QuoteRepository, RejectedSibling } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { ActiveQuoteExistsException } from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestRecord } from '../service-requests/repositories/service-request.repository';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { NotRequestOwnerException } from '../service-requests/exceptions/service-request.exceptions';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { PaymentsService } from '../payments/payments.service';
import { DepositChargeFailedException } from '../payments/exceptions/payments.exceptions';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * PR 5 — the three quote emails, as `QuotesService` triggers them.
 *
 * What is pinned here is WHEN and TO WHOM, not what the email says (that is the
 * templates' spec) and not how a recipient is resolved (the notifications
 * spec):
 *   • submit → one `quote-received` for the client, only after the write;
 *   • accept → `quote-accepted` for the winner on a 200 AND on a 202;
 *   • accept → `quote-not-selected` for EXACTLY the siblings `rejectSiblings`
 *     transitioned — a WITHDRAWN and an EXPIRED quote sit in the montage and
 *     must receive nothing;
 *   • the emails are enqueued BEFORE the re-read, so a 404 there loses none;
 *   • an enqueue that rejects never changes the response.
 *
 * Fully mocked: no database, no Redis, no Stripe.
 */

const QUOTE_ID = '77777777-7777-4777-8777-777777777777';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WINNER_PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const WINNER_USER_ID = '66666666-6666-4666-8666-666666666666';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';

// The montage: B and C are live competitors, D withdrew, E expired.
const B_PROVIDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C_PROVIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D_PROVIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const E_PROVIDER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const TITLE = 'Rénovation de salle de bain';

function quote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: QUOTE_ID,
    serviceRequestId: REQUEST_ID,
    serviceProviderId: WINNER_PROVIDER_ID,
    amount: '400.00',
    currency: 'CAD',
    estimatedDurationMinutes: 120,
    proposedStartAtUtc: null,
    description: 'Devis de test',
    status: QuoteStatus.SUBMITTED,
    validUntilUtc: new Date(Date.now() + 86_400_000),
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...overrides,
  };
}

function request(overrides: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.PROJECT_TENDER,
    status: ServiceRequestStatus.OPEN,
    serviceCategoryId: CATEGORY_ID,
    title: TITLE,
    quotesDeadlineUtc: new Date(Date.now() + 72 * 3_600_000),
    ...overrides,
  } as ServiceRequestRecord;
}

function notificationsMock() {
  return {
    notifyQuoteReceived: jest.fn().mockResolvedValue(undefined),
    notifyQuoteAccepted: jest.fn().mockResolvedValue(undefined),
    notifyQuotesNotSelected: jest.fn().mockResolvedValue(undefined),
  };
}

/** Every quote of the request, as a mutation that "notifies all siblings" would read it. */
const ALL_QUOTES: QuoteRecord[] = [
  quote(),
  quote({ id: 'q-b', serviceProviderId: B_PROVIDER }),
  quote({ id: 'q-c', serviceProviderId: C_PROVIDER }),
  quote({ id: 'q-d', serviceProviderId: D_PROVIDER, status: QuoteStatus.WITHDRAWN }),
  quote({ id: 'q-e', serviceProviderId: E_PROVIDER, status: QuoteStatus.EXPIRED }),
];

/** What `rejectSiblings` really returns: the SUBMITTED siblings only. */
const TRANSITIONED: RejectedSibling[] = [
  { quoteId: 'q-b', serviceProviderId: B_PROVIDER },
  { quoteId: 'q-c', serviceProviderId: C_PROVIDER },
];

function acceptHarness(opts: {
  captureDeposit?: jest.Mock;
  reRead?: jest.Mock;
  rejected?: RejectedSibling[];
  notifications?: ReturnType<typeof notificationsMock>;
} = {}) {
  let committed = false;
  const notifications = opts.notifications ?? notificationsMock();

  const quotesRepo = {
    findByIdForUpdate: jest.fn().mockResolvedValue(quote()),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    rejectSiblings: jest.fn().mockResolvedValue(opts.rejected ?? TRANSITIONED),
    // Present so a mutation reading every quote of the request would find
    // D (WITHDRAWN) and E (EXPIRED) and email them — and fail below.
    findByRequestId: jest.fn().mockResolvedValue(ALL_QUOTES),
    findById:
      opts.reRead ?? jest.fn().mockResolvedValue(quote({ status: QuoteStatus.ACCEPTED })),
  };

  const serviceRequestsService = {
    lockRequestForUpdate: jest.fn().mockResolvedValue(request()),
    assignIndividualProvider: jest.fn().mockResolvedValue(undefined),
    announceDepositFailure: jest.fn(),
  };

  const providerRepo = {
    findById: jest.fn().mockResolvedValue({
      id: WINNER_PROVIDER_ID,
      providerType: ProviderType.INDIVIDUAL,
      userId: WINNER_USER_ID,
      isActive: true,
    }),
  };

  const captureDeposit = opts.captureDeposit ?? jest.fn().mockResolvedValue(undefined);

  const dataSource = {
    createQueryRunner: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn(async () => {
        committed = true;
      }),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {} as EntityManager,
    }),
  };

  const service = new QuotesService(
    quotesRepo as unknown as QuoteRepository,
    serviceRequestsService as unknown as ServiceRequestsService,
    providerRepo as unknown as ServiceProviderRepository,
    {} as unknown as ProfessionalServiceCategoryRepository,
    {
      captureDeposit,
      isProviderChargeable: jest.fn().mockResolvedValue(true),
    } as unknown as PaymentsService,
    dataSource as unknown as DataSource,
    notifications as unknown as NotificationsService,
  );

  return { service, notifications, quotesRepo, committed: () => committed };
}

const EXPECTED_REQUEST = { id: REQUEST_ID, title: TITLE, clientUserId: CLIENT_ID };

describe('QuotesService.accept — quote emails (PR 5)', () => {
  it('on a 200: the winner is told, and exactly the transitioned siblings', async () => {
    const h = acceptHarness();

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome.depositSettled).toBe(true);
    expect(h.notifications.notifyQuoteAccepted).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyQuoteAccepted).toHaveBeenCalledWith(
      EXPECTED_REQUEST,
      WINNER_PROVIDER_ID,
    );
    expect(h.notifications.notifyQuotesNotSelected).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyQuotesNotSelected).toHaveBeenCalledWith(
      EXPECTED_REQUEST,
      [B_PROVIDER, C_PROVIDER],
    );
  });

  it('on a 202 (capture failed): the winner is STILL told — the assignment holds', async () => {
    const h = acceptHarness({
      captureDeposit: jest
        .fn()
        .mockRejectedValue(new DepositChargeFailedException('card_declined')),
    });

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome.depositSettled).toBe(false);
    expect(h.notifications.notifyQuoteAccepted).toHaveBeenCalledWith(
      EXPECTED_REQUEST,
      WINNER_PROVIDER_ID,
    );
    expect(h.notifications.notifyQuotesNotSelected).toHaveBeenCalledWith(
      EXPECTED_REQUEST,
      [B_PROVIDER, C_PROVIDER],
    );
  });

  it('never emails a WITHDRAWN or an EXPIRED quote, even though they are in the request', async () => {
    const h = acceptHarness();

    await h.service.accept(QUOTE_ID, CLIENT_ID);

    const everyNotified = h.notifications.notifyQuotesNotSelected.mock.calls.flatMap(
      ([, ids]) => ids as string[],
    );
    expect(everyNotified).not.toContain(D_PROVIDER);
    expect(everyNotified).not.toContain(E_PROVIDER);
    // …and the winner is never told they lost.
    expect(everyNotified).not.toContain(WINNER_PROVIDER_ID);
  });

  it('sends no « not selected » call when nothing was transitioned', async () => {
    const h = acceptHarness({ rejected: [] });

    await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(h.notifications.notifyQuoteAccepted).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyQuotesNotSelected).not.toHaveBeenCalled();
  });

  it('a re-read that fails (404) does not cost the emails', async () => {
    const h = acceptHarness({ reRead: jest.fn().mockResolvedValue(null) });

    await expect(h.service.accept(QUOTE_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.committed()).toBe(true);
    expect(h.notifications.notifyQuoteAccepted).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyQuotesNotSelected).toHaveBeenCalledWith(
      EXPECTED_REQUEST,
      [B_PROVIDER, C_PROVIDER],
    );
  });

  it('an enqueue that rejects changes neither the response nor the other call', async () => {
    const notifications = notificationsMock();
    notifications.notifyQuoteAccepted.mockRejectedValue(new Error('redis down'));
    const h = acceptHarness({ notifications });

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome).toEqual({
      quote: expect.objectContaining({ id: QUOTE_ID, status: QuoteStatus.ACCEPTED }),
      depositSettled: true,
    });
    expect(notifications.notifyQuotesNotSelected).toHaveBeenCalledTimes(1);
  });

  it('a refusal before the commit (non-owner) emails nobody', async () => {
    const h = acceptHarness();

    await expect(h.service.accept(QUOTE_ID, 'someone-else')).rejects.toBeInstanceOf(
      NotRequestOwnerException,
    );
    expect(h.committed()).toBe(false);
    expect(h.notifications.notifyQuoteAccepted).not.toHaveBeenCalled();
    expect(h.notifications.notifyQuotesNotSelected).not.toHaveBeenCalled();
  });
});

describe('QuotesService.submit — quote-received email (PR 5)', () => {
  const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
  const CALLER_ID = '88888888-8888-4888-8888-888888888888';

  function submitDto(): SubmitQuoteDto {
    return {
      amount: 250,
      currency: 'CAD',
      estimatedDurationMinutes: 120,
      description: 'Mon offre',
      validUntilUtc: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    } as SubmitQuoteDto;
  }

  function submitHarness(create: jest.Mock, notifications = notificationsMock()) {
    const service = new QuotesService(
      { create } as unknown as QuoteRepository,
      {
        getRequestRecord: jest.fn().mockResolvedValue(request()),
      } as unknown as ServiceRequestsService,
      {
        findByUserId: jest.fn().mockResolvedValue({ id: PROVIDER_ID, userId: CALLER_ID }),
      } as unknown as ServiceProviderRepository,
      {
        isEligibleForCategory: jest.fn().mockResolvedValue(true),
      } as unknown as ProfessionalServiceCategoryRepository,
      {} as unknown as PaymentsService,
      {} as unknown as DataSource,
      notifications as unknown as NotificationsService,
    );
    return { service, notifications };
  }

  const created = () =>
    jest.fn().mockResolvedValue(quote({ id: 'new-quote', serviceProviderId: PROVIDER_ID }));

  it('enqueues ONE quote-received for the client, after the write', async () => {
    const create = created();
    const h = submitHarness(create);

    await h.service.submit(REQUEST_ID, CALLER_ID, submitDto());

    expect(h.notifications.notifyQuoteReceived).toHaveBeenCalledTimes(1);
    expect(h.notifications.notifyQuoteReceived).toHaveBeenCalledWith(
      expect.objectContaining(EXPECTED_REQUEST),
    );
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      h.notifications.notifyQuoteReceived.mock.invocationCallOrder[0],
    );
  });

  it('a quote the unique index refused (409) announces nothing', async () => {
    const create = jest.fn().mockRejectedValue({ code: '23505' });
    const h = submitHarness(create);

    await expect(h.service.submit(REQUEST_ID, CALLER_ID, submitDto())).rejects.toBeInstanceOf(
      ActiveQuoteExistsException,
    );
    expect(h.notifications.notifyQuoteReceived).not.toHaveBeenCalled();
  });

  it('an enqueue that rejects does not change the response', async () => {
    const notifications = notificationsMock();
    notifications.notifyQuoteReceived.mockRejectedValue(new Error('redis down'));
    const h = submitHarness(created(), notifications);

    const dto = await h.service.submit(REQUEST_ID, CALLER_ID, submitDto());

    expect(dto.id).toBe('new-quote');
    expect(dto.status).toBe(QuoteStatus.SUBMITTED);
  });
});
