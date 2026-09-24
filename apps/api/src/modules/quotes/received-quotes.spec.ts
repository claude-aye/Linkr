import { HttpException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { QuotesService } from './quotes.service';
import { ReceivedQuotesService } from './received-quotes.service';
import {
  QuoteRecord,
  QuoteRepository,
  ReceivedQuoteRecord,
} from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import {
  OrganizationQuoteDispatchNotImplementedException,
  ProviderUnavailableException,
  QuoteExpiredException,
  RequestNotATenderException,
  RequestNotOpenForQuotingException,
} from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import {
  InvalidStateTransitionException,
  NotRequestOwnerException,
} from '../service-requests/exceptions/service-request.exceptions';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { PscVerificationStatus } from '../service-providers/enums/psc-verification-status.enum';
import { PaymentsService } from '../payments/payments.service';
import { ReviewsRepository } from '../reviews/repositories/reviews.repository';

/**
 * The counterfactual that makes `acceptable` worth anything: for every reason,
 * `accept()` refuses with its exception AND the list says `acceptable: false`;
 * when there is no reason, `accept()` succeeds AND the list says `true`. Both
 * read the same scenario, so a divergence between the two readers fails here.
 *
 * Fully mocked; the SQL (WITHDRAWN excluded, order, joins) is proven against a
 * real Postgres by `database/probes/received-quotes.probe.ts`.
 */

const QUOTE_ID = '77777777-7777-4777-8777-777777777777';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_USER_ID = '66666666-6666-4666-8666-666666666666';

interface Scenario {
  requestType: ServiceRequestType;
  requestStatus: ServiceRequestStatus;
  quoteStatus: QuoteStatus;
  validUntilUtc: Date;
  providerType: ProviderType;
  providerUserId: string | null;
  providerIsActive: boolean;
  providerDeleted: boolean;
}

const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 1_000);

function scenario(o: Partial<Scenario> = {}): Scenario {
  return {
    requestType: ServiceRequestType.PROJECT_TENDER,
    requestStatus: ServiceRequestStatus.OPEN,
    quoteStatus: QuoteStatus.SUBMITTED,
    validUntilUtc: future(),
    providerType: ProviderType.INDIVIDUAL,
    providerUserId: PROVIDER_USER_ID,
    providerIsActive: true,
    providerDeleted: false,
    ...o,
  };
}

function requestRecord(s: Scenario) {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: s.requestType,
    status: s.requestStatus,
  };
}

function quoteRecord(s: Scenario): QuoteRecord {
  return {
    id: QUOTE_ID,
    serviceRequestId: REQUEST_ID,
    serviceProviderId: PROVIDER_ID,
    amount: '400.00',
    currency: 'CAD',
    estimatedDurationMinutes: 120,
    proposedStartAtUtc: null,
    description: 'Devis',
    status: s.quoteStatus,
    validUntilUtc: s.validUntilUtc,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

function receivedRecord(s: Scenario, o: Partial<ReceivedQuoteRecord> = {}): ReceivedQuoteRecord {
  const q = quoteRecord(s);
  return {
    id: q.id,
    amount: q.amount,
    currency: q.currency,
    estimatedDurationMinutes: q.estimatedDurationMinutes,
    proposedStartAtUtc: q.proposedStartAtUtc,
    description: q.description,
    status: q.status,
    validUntilUtc: q.validUntilUtc,
    createdAtUtc: q.createdAtUtc,
    serviceProviderId: PROVIDER_ID,
    providerType: s.providerType,
    providerUserId: s.providerUserId,
    providerIsActive: s.providerIsActive,
    providerDeletedAtUtc: s.providerDeleted ? new Date() : null,
    providerDisplayName: 'Coiffure Bob',
    providerHeadline: 'Coupes à domicile',
    verificationStatus: PscVerificationStatus.NOT_REQUIRED,
    distanceMeters: 12_400,
    ...o,
  };
}

/** `accept()` wired on a scenario. The provider read filters soft-deleted rows. */
function acceptHarness(s: Scenario) {
  let committed = false;
  let rolledBack = false;
  const quotesRepo = {
    findByIdForUpdate: jest.fn().mockResolvedValue(quoteRecord(s)),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    rejectSiblings: jest.fn().mockResolvedValue(1),
    findById: jest.fn().mockResolvedValue({ ...quoteRecord(s), status: QuoteStatus.ACCEPTED }),
  };
  const serviceRequestsService = {
    lockRequestForUpdate: jest.fn().mockResolvedValue(requestRecord(s)),
    assignIndividualProvider: jest.fn().mockResolvedValue(undefined),
    announceDepositFailure: jest.fn(),
  };
  const providerRepo = {
    findById: jest.fn().mockResolvedValue(
      s.providerDeleted
        ? null
        : {
            id: PROVIDER_ID,
            providerType: s.providerType,
            userId: s.providerUserId,
            isActive: s.providerIsActive,
          },
    ),
  };
  const captureDeposit = jest.fn().mockResolvedValue(undefined);
  const dataSource = {
    createQueryRunner: () => ({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(async () => {
        committed = true;
      }),
      rollbackTransaction: jest.fn(async () => {
        rolledBack = true;
      }),
      release: jest.fn(),
      manager: {} as EntityManager,
    }),
  };
  const service = new QuotesService(
    quotesRepo as unknown as QuoteRepository,
    serviceRequestsService as unknown as ServiceRequestsService,
    providerRepo as unknown as ServiceProviderRepository,
    {} as unknown as ProfessionalServiceCategoryRepository,
    { captureDeposit } as unknown as PaymentsService,
    dataSource as unknown as DataSource,
  );
  return {
    service,
    quotesRepo,
    serviceRequestsService,
    captureDeposit,
    committed: () => committed,
    rolledBack: () => rolledBack,
  };
}

function listHarness(opts: {
  request?: ReturnType<typeof requestRecord> | null;
  records?: ReceivedQuoteRecord[];
  ratings?: Map<string, { reviewCount: number; averageRating: number | null }>;
}) {
  const quotesRepo = {
    findReceivedForRequest: jest.fn().mockResolvedValue(opts.records ?? []),
  };
  const serviceRequestsService = {
    getRequestRecord: jest
      .fn()
      .mockResolvedValue(opts.request === undefined ? requestRecord(scenario()) : opts.request),
  };
  const reviewsRepo = {
    findAggregatesForProviders: jest.fn().mockResolvedValue(opts.ratings ?? new Map()),
  };
  const service = new ReceivedQuotesService(
    quotesRepo as unknown as QuoteRepository,
    serviceRequestsService as unknown as ServiceRequestsService,
    reviewsRepo as unknown as ReviewsRepository,
  );
  return { service, quotesRepo, reviewsRepo };
}

async function listAcceptable(s: Scenario): Promise<boolean> {
  const h = listHarness({ request: requestRecord(s), records: [receivedRecord(s)] });
  const items = await h.service.listForClient(REQUEST_ID, CLIENT_ID);
  expect(items).toHaveLength(1);
  return items[0].acceptable;
}

describe('accept() and the received-quotes list agree, reason by reason', () => {
  const cases: Array<[string, Partial<Scenario>, new (...args: never[]) => HttpException]> = [
    [
      'REQUEST_NOT_OPEN_TENDER',
      { requestStatus: ServiceRequestStatus.ASSIGNED },
      RequestNotOpenForQuotingException,
    ],
    ['QUOTE_NOT_SUBMITTED', { quoteStatus: QuoteStatus.REJECTED }, InvalidStateTransitionException],
    ['QUOTE_EXPIRED', { validUntilUtc: past() }, QuoteExpiredException],
    ['PROVIDER_GONE', { providerDeleted: true }, NotFoundException],
    [
      'PROVIDER_ORGANIZATION',
      { providerType: ProviderType.ORGANIZATION, providerUserId: null },
      OrganizationQuoteDispatchNotImplementedException,
    ],
    ['PROVIDER_PAUSED', { providerIsActive: false }, ProviderUnavailableException],
  ];

  it.each(cases)('%s → accept throws, list says acceptable: false', async (_name, o, Ex) => {
    const s = scenario(o);
    const h = acceptHarness(s);

    await expect(h.service.accept(QUOTE_ID, CLIENT_ID)).rejects.toBeInstanceOf(Ex);
    expect(h.rolledBack()).toBe(true);
    expect(h.committed()).toBe(false);

    expect(await listAcceptable(s)).toBe(false);
  });

  it('no reason → accept succeeds, list says acceptable: true', async () => {
    const s = scenario();
    const h = acceptHarness(s);

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);
    expect(outcome.depositSettled).toBe(true);
    expect(h.committed()).toBe(true);

    expect(await listAcceptable(s)).toBe(true);
  });

  it('the historical codes are unchanged (400/404/409/501 families)', async () => {
    for (const [, o, Ex] of cases) {
      const h = acceptHarness(scenario(o));
      const err = await h.service.accept(QUOTE_ID, CLIENT_ID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Ex);
    }
    const paused = await acceptHarness(scenario({ providerIsActive: false }))
      .service.accept(QUOTE_ID, CLIENT_ID)
      .catch((e: HttpException) => e);
    expect((paused as HttpException).getStatus()).toBe(409);
  });

  it('a PAUSED ORGANIZATION keeps its historical 501, not the new 409', async () => {
    const h = acceptHarness(
      scenario({
        providerType: ProviderType.ORGANIZATION,
        providerUserId: null,
        providerIsActive: false,
      }),
    );
    await expect(h.service.accept(QUOTE_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      OrganizationQuoteDispatchNotImplementedException,
    );
  });
});

describe('accept() — the new pause guard writes nothing', () => {
  it('409, and neither the quote, nor the siblings, nor the request is touched', async () => {
    const h = acceptHarness(scenario({ providerIsActive: false }));

    const err = await h.service.accept(QUOTE_ID, CLIENT_ID).catch((e: HttpException) => e);

    expect(err).toBeInstanceOf(ProviderUnavailableException);
    expect((err as HttpException).getStatus()).toBe(409);
    expect(h.quotesRepo.updateStatus).not.toHaveBeenCalled();
    expect(h.quotesRepo.rejectSiblings).not.toHaveBeenCalled();
    expect(h.serviceRequestsService.assignIndividualProvider).not.toHaveBeenCalled();
    expect(h.captureDeposit).not.toHaveBeenCalled();
    expect(h.rolledBack()).toBe(true);
  });
});

describe('ReceivedQuotesService.listForClient — guards 404 → 403 → 400', () => {
  it('404 on an unknown (or soft-deleted) request, nothing else read', async () => {
    const h = listHarness({ request: null });
    await expect(h.service.listForClient(REQUEST_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(h.quotesRepo.findReceivedForRequest).not.toHaveBeenCalled();
  });

  it('403 to a stranger EVEN on a DIRECT_BOOKING — the type is not probeable', async () => {
    const h = listHarness({
      request: requestRecord(scenario({ requestType: ServiceRequestType.DIRECT_BOOKING })),
    });
    await expect(h.service.listForClient(REQUEST_ID, 'someone-else')).rejects.toBeInstanceOf(
      NotRequestOwnerException,
    );
    expect(h.quotesRepo.findReceivedForRequest).not.toHaveBeenCalled();
  });

  it('400 to the owner of a DIRECT_BOOKING', async () => {
    const h = listHarness({
      request: requestRecord(scenario({ requestType: ServiceRequestType.DIRECT_BOOKING })),
    });
    await expect(h.service.listForClient(REQUEST_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      RequestNotATenderException,
    );
    expect(h.quotesRepo.findReceivedForRequest).not.toHaveBeenCalled();
  });

  it('the owner of a CLOSED tender still reads its quotes (all not acceptable)', async () => {
    const s = scenario({ requestStatus: ServiceRequestStatus.ASSIGNED });
    const h = listHarness({ request: requestRecord(s), records: [receivedRecord(s)] });
    const items = await h.service.listForClient(REQUEST_ID, CLIENT_ID);
    expect(items.map((i) => i.acceptable)).toEqual([false]);
  });
});

describe('ReceivedQuotesService.listForClient — projection', () => {
  const OTHER_PROVIDER = '33333333-3333-4333-8333-333333333333';

  it('reads the rating aggregate ONCE for the whole list, de-duplicated', async () => {
    const s = scenario();
    const h = listHarness({
      records: [
        receivedRecord(s, { id: 'q1' }),
        receivedRecord(s, { id: 'q2', serviceProviderId: OTHER_PROVIDER }),
        receivedRecord(s, { id: 'q3' }),
      ],
      ratings: new Map([[PROVIDER_ID, { reviewCount: 4, averageRating: 4.25 }]]),
    });

    const items = await h.service.listForClient(REQUEST_ID, CLIENT_ID);

    expect(h.reviewsRepo.findAggregatesForProviders).toHaveBeenCalledTimes(1);
    expect(h.reviewsRepo.findAggregatesForProviders).toHaveBeenCalledWith([
      PROVIDER_ID,
      OTHER_PROVIDER,
    ]);
    expect(items.map((i) => [i.reviewCount, i.averageRating])).toEqual([
      [4, 4.25],
      [0, null],
      [4, 4.25],
    ]);
  });

  it('a failed rating aggregate serves the list, reputation null (not 0), and logs', async () => {
    const s = scenario();
    const h = listHarness({ records: [receivedRecord(s, { id: 'q1' }), receivedRecord(s, { id: 'q2' })] });
    h.reviewsRepo.findAggregatesForProviders.mockRejectedValue(new Error('db down'));
    const logSpy = jest
      .spyOn((h.service as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    const items = await h.service.listForClient(REQUEST_ID, CLIENT_ID);

    expect(items.map((i) => i.id)).toEqual(['q1', 'q2']);
    expect(items.map((i) => [i.reviewCount, i.averageRating])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(items.map((i) => i.acceptable)).toEqual([true, true]);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the list order the repository returned (the API does not re-rank)', async () => {
    const s = scenario();
    const h = listHarness({
      records: [receivedRecord(s, { id: 'b', amount: '900.00' }), receivedRecord(s, { id: 'a', amount: '100.00' })],
    });
    const items = await h.service.listForClient(REQUEST_ID, CLIENT_ID);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('a deleted provider: row present, identity and distance masked, not acceptable', async () => {
    const s = scenario({ providerDeleted: true });
    const h = listHarness({ request: requestRecord(s), records: [receivedRecord(s)] });

    const [item] = await h.service.listForClient(REQUEST_ID, CLIENT_ID);

    expect(item.id).toBe(QUOTE_ID);
    expect(item.displayName).toBeNull();
    expect(item.headline).toBeNull();
    expect(item.distanceKm).toBeNull();
    expect(item.acceptable).toBe(false);
  });

  it('a paused provider keeps its identity but is not acceptable', async () => {
    const s = scenario({ providerIsActive: false });
    const h = listHarness({ request: requestRecord(s), records: [receivedRecord(s)] });

    const [item] = await h.service.listForClient(REQUEST_ID, CLIENT_ID);

    expect(item.displayName).toBe('Coiffure Bob');
    expect(item.distanceKm).toBe(12);
    expect(item.acceptable).toBe(false);
  });

  it('carries no contact detail and no request/user id', async () => {
    const s = scenario();
    const h = listHarness({ records: [receivedRecord(s)] });
    const [item] = await h.service.listForClient(REQUEST_ID, CLIENT_ID);
    const keys = Object.keys(item);
    for (const forbidden of ['email', 'phone', 'serviceAddress', 'serviceBaseLocation', 'userId', 'providerUserId', 'serviceRequestId']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
