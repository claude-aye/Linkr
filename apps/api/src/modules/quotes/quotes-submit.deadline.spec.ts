import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QuotesService } from './quotes.service';
import { QuoteRepository } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import {
  QuotesDeadlinePassedException,
  RequestNotOpenForQuotingException,
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
 * R6 — no quote once the tender's quotes deadline is reached.
 *
 * Comparator, and why: accepted while `now < deadline`, refused from the
 * deadline ONWARDS. "Reached" means closed — the exact millisecond of the
 * deadline is already too late, which is the convention the request expiry
 * cron already uses on the other side of the same column.
 *
 * Everything is mocked and the clock is frozen: each case asserts WHICH rule
 * fired, not merely that something threw.
 */

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MS_PER_HOUR = 60 * 60 * 1000;
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CALLER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';

function at(msFromT0: number): string {
  return new Date(T0 + msFromT0).toISOString();
}

function requestRecord(
  overrides: Partial<ServiceRequestRecord> = {},
): ServiceRequestRecord {
  return {
    id: REQUEST_ID,
    clientUserId: '55555555-5555-4555-8555-555555555555',
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

function submitDto(overrides: Partial<SubmitQuoteDto> = {}): SubmitQuoteDto {
  return {
    amount: 250,
    currency: 'CAD',
    estimatedDurationMinutes: 120,
    description: 'Mon offre.',
    validUntilUtc: at(120 * MS_PER_HOUR),
    ...overrides,
  } as SubmitQuoteDto;
}

function buildService(request: ServiceRequestRecord | null): {
  service: QuotesService;
  create: jest.Mock;
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

  const service = new QuotesService(
    { create } as unknown as QuoteRepository,
    {
      getRequestRecord: jest.fn().mockResolvedValue(request),
    } as unknown as ServiceRequestsService,
    {
      findByUserId: jest.fn().mockResolvedValue({ id: PROVIDER_ID, userId: CALLER_ID }),
    } as unknown as ServiceProviderRepository,
    {
      isEligibleForCategory: jest.fn().mockResolvedValue(true),
    } as unknown as ProfessionalServiceCategoryRepository,
    {} as unknown as PaymentsService,
    {} as unknown as DataSource,
  );

  return { service, create };
}

describe('QuotesService.submit — quotes deadline (R6)', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: T0,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a quote one millisecond before the deadline', async () => {
    const { service, create } = buildService(
      requestRecord({ quotesDeadlineUtc: new Date(T0 + 1) }),
    );

    await expect(service.submit(REQUEST_ID, CALLER_ID, submitDto())).resolves.toEqual(
      expect.objectContaining({ status: QuoteStatus.SUBMITTED }),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses a quote AT the deadline, to the millisecond', async () => {
    const { service, create } = buildService(
      requestRecord({ quotesDeadlineUtc: new Date(T0) }),
    );

    await expect(
      service.submit(REQUEST_ID, CALLER_ID, submitDto()),
    ).rejects.toBeInstanceOf(QuotesDeadlinePassedException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a quote after the deadline', async () => {
    const { service, create } = buildService(
      requestRecord({ quotesDeadlineUtc: new Date(T0 - MS_PER_HOUR) }),
    );

    await expect(
      service.submit(REQUEST_ID, CALLER_ID, submitDto()),
    ).rejects.toBeInstanceOf(QuotesDeadlinePassedException);
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * THE NULL CASE. `now >= null` is `true` in JavaScript (null coerces to 0),
   * so the shorthand comparison would 409 every legacy tender whose deadline
   * predates R1 — a whole class of requests killed by a guard meant to enforce
   * a deadline that does not exist for them.
   */
  it('accepts a quote when the tender carries NO deadline at all', async () => {
    const { service, create } = buildService(requestRecord({ quotesDeadlineUtc: null }));

    await expect(service.submit(REQUEST_ID, CALLER_ID, submitDto())).resolves.toEqual(
      expect.objectContaining({ status: QuoteStatus.SUBMITTED }),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never writes: a refused submission does not expire the request', async () => {
    const srService = {
      getRequestRecord: jest
        .fn()
        .mockResolvedValue(requestRecord({ quotesDeadlineUtc: new Date(T0 - 1) })),
    } as unknown as ServiceRequestsService;

    const service = new QuotesService(
      { create: jest.fn() } as unknown as QuoteRepository,
      srService,
      {} as unknown as ServiceProviderRepository,
      {} as unknown as ProfessionalServiceCategoryRepository,
      {} as unknown as PaymentsService,
      {} as unknown as DataSource,
    );

    await expect(
      service.submit(REQUEST_ID, CALLER_ID, submitDto()),
    ).rejects.toBeInstanceOf(QuotesDeadlinePassedException);

    // The ONLY collaborator exposed is the read. A call to any write method on
    // the service-requests side would have thrown "not a function" above.
    expect(Object.keys(srService)).toEqual(['getRequestRecord']);
  });

  describe('the pre-existing guards are unchanged', () => {
    it('still refuses a non-OPEN request with its own exception', async () => {
      const { service } = buildService(
        requestRecord({ status: ServiceRequestStatus.ASSIGNED }),
      );

      await expect(
        service.submit(REQUEST_ID, CALLER_ID, submitDto()),
      ).rejects.toBeInstanceOf(RequestNotOpenForQuotingException);
    });

    it('still refuses a DIRECT_BOOKING with its own exception', async () => {
      const { service } = buildService(
        requestRecord({ requestType: ServiceRequestType.DIRECT_BOOKING }),
      );

      await expect(
        service.submit(REQUEST_ID, CALLER_ID, submitDto()),
      ).rejects.toBeInstanceOf(RequestNotOpenForQuotingException);
    });

    it('still 404s an unknown request', async () => {
      const { service } = buildService(null);

      await expect(
        service.submit(REQUEST_ID, CALLER_ID, submitDto()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
