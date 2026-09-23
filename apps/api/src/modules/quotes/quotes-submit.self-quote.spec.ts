import { DataSource } from 'typeorm';
import { QuotesService } from './quotes.service';
import { QuoteRepository } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import {
  QuotesDeadlinePassedException,
  SelfQuoteForbiddenException,
} from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestRecord } from '../service-requests/repositories/service-request.repository';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from '../service-requests/enums/service-request-location-precision.enum';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { PaymentsService } from '../payments/payments.service';

/**
 * No quoting on your own tender.
 *
 * Without the guard, a client who also holds a provider profile could quote on
 * their own call for tenders and then accept it — assigning the job to
 * themselves and capturing a deposit from their own card to their own Connect
 * account.
 *
 * Each case asserts WHICH rule fired, and whether the profile lookup ran: the
 * guard is meant to fire from the request alone, before any read.
 */

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MS_PER_HOUR = 60 * 60 * 1000;
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';

function requestRecord(
  overrides: Partial<ServiceRequestRecord> = {},
): ServiceRequestRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.PROJECT_TENDER,
    status: ServiceRequestStatus.OPEN,
    serviceCategoryId: CATEGORY_ID,
    serviceItemId: null,
    requestedServiceProviderId: null,
    assignedServiceProviderId: null,
    title: 'Appel doffres',
    description: 'Description.',
    serviceAddress: '1 rue de Test, Quebec, QC',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    desiredStartAtUtc: null,
    desiredEndAtUtc: null,
    scheduledAtUtc: null,
    estimatedAmount: null,
    estimatedCurrency: null,
    finalAmount: null,
    finalCurrency: null,
    responseDeadlineUtc: null,
    quotesDeadlineUtc: new Date(T0 + 72 * MS_PER_HOUR),
    acceptedAtUtc: null,
    completedAtUtc: null,
    paidAtUtc: null,
    contestedAtUtc: null,
    cancelledAtUtc: null,
    cancellationReason: null,
    cancelledByUserId: null,
    createdAtUtc: new Date(T0),
    updatedAtUtc: new Date(T0),
    ...overrides,
  } as ServiceRequestRecord;
}

function submitDto(): SubmitQuoteDto {
  return {
    amount: 250,
    currency: 'CAD',
    estimatedDurationMinutes: 120,
    description: 'Mon offre.',
    validUntilUtc: new Date(T0 + 120 * MS_PER_HOUR).toISOString(),
  } as SubmitQuoteDto;
}

function buildService(
  request: ServiceRequestRecord,
  callerUserId: string,
): {
  service: QuotesService;
  create: jest.Mock;
  findByUserId: jest.Mock;
} {
  const create = jest.fn(async (data: Record<string, unknown>) => ({
    id: '66666666-6666-4666-8666-666666666666',
    serviceRequestId: data.serviceRequestId as string,
    serviceProviderId: data.serviceProviderId as string,
    amount: data.amount as string,
    currency: data.currency as string,
    estimatedDurationMinutes: data.estimatedDurationMinutes as number,
    proposedStartAtUtc: null,
    description: data.description as string,
    status: QuoteStatus.SUBMITTED,
    validUntilUtc: data.validUntilUtc as Date,
    createdAtUtc: new Date(T0),
    updatedAtUtc: new Date(T0),
  }));

  // The caller owns an eligible INDIVIDUAL profile in every case: the only
  // variable is whether they are also the client of the tender.
  const findByUserId = jest
    .fn()
    .mockResolvedValue({ id: PROVIDER_ID, userId: callerUserId });

  const service = new QuotesService(
    { create } as unknown as QuoteRepository,
    {
      getRequestRecord: jest.fn().mockResolvedValue(request),
    } as unknown as ServiceRequestsService,
    { findByUserId } as unknown as ServiceProviderRepository,
    {
      isEligibleForCategory: jest.fn().mockResolvedValue(true),
    } as unknown as ProfessionalServiceCategoryRepository,
    {} as unknown as PaymentsService,
    {} as unknown as DataSource,
  );

  return { service, create, findByUserId };
}

describe('QuotesService.submit — no quoting on your own tender', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: T0,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refuses the client of the tender, even with an eligible provider profile', async () => {
    const { service, create } = buildService(requestRecord(), CLIENT_ID);

    await expect(
      service.submit(REQUEST_ID, CLIENT_ID, submitDto()),
    ).rejects.toBeInstanceOf(SelfQuoteForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('fires from the request alone: the provider profile is never read', async () => {
    const { service, findByUserId } = buildService(requestRecord(), CLIENT_ID);

    await expect(
      service.submit(REQUEST_ID, CLIENT_ID, submitDto()),
    ).rejects.toBeInstanceOf(SelfQuoteForbiddenException);
    expect(findByUserId).not.toHaveBeenCalled();
  });

  it('accepts any other eligible provider on the same tender', async () => {
    const { service, create } = buildService(requestRecord(), OTHER_USER_ID);

    await expect(
      service.submit(REQUEST_ID, OTHER_USER_ID, submitDto()),
    ).resolves.toEqual(expect.objectContaining({ status: QuoteStatus.SUBMITTED }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  /**
   * Order is part of the contract: on a closed tender the deadline answers
   * first (409), whoever the caller is. The self-quote guard does not mask R6.
   */
  it('lets the deadline guard answer first on a closed tender', async () => {
    const { service } = buildService(
      requestRecord({ quotesDeadlineUtc: new Date(T0 - MS_PER_HOUR) }),
      CLIENT_ID,
    );

    await expect(
      service.submit(REQUEST_ID, CLIENT_ID, submitDto()),
    ).rejects.toBeInstanceOf(QuotesDeadlinePassedException);
  });
});
