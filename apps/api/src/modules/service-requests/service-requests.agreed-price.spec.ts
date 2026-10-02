import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import {
  ProviderServiceRequestRecord,
  ServiceRequestReadRecord,
  ServiceRequestRepository,
} from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';

/**
 * The agreed price, as the two SERVICES map it (the pure rule has its own spec;
 * the SQL has its own probe). What is pinned here is the wiring and the one
 * warning: every DTO the client sees carries the field, an accepted tender
 * without an ACCEPTED quote is SERVED (null) and LOGGED, and the log carries
 * the request id and nothing else.
 */

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const ACCEPTED_AT = new Date('2026-09-20T15:00:00Z');

function read(over: Partial<ServiceRequestReadRecord> = {}): ServiceRequestReadRecord {
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
    estimatedAmount: '1500.00', // the client's indicative budget
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
    acceptedQuote: { amount: '250.00', currency: 'CAD' },
    ...over,
  };
}

function providerRow(
  over: Partial<ProviderServiceRequestRecord> = {},
): ProviderServiceRequestRecord {
  const base = read();
  return {
    id: base.id,
    status: base.status,
    requestType: base.requestType,
    title: base.title,
    description: base.description,
    serviceAddress: base.serviceAddress,
    serviceLocationPrecision: base.serviceLocationPrecision,
    estimatedAmount: base.estimatedAmount,
    estimatedCurrency: base.estimatedCurrency,
    finalAmount: null,
    finalCurrency: null,
    scheduledAtUtc: null,
    desiredStartAtUtc: null,
    desiredEndAtUtc: null,
    acceptedAtUtc: base.acceptedAtUtc,
    completedAtUtc: null,
    paidAtUtc: null,
    responseDeadlineUtc: null,
    createdAtUtc: base.createdAtUtc,
    updatedAtUtc: base.updatedAtUtc,
    assignedServiceProviderId: PROVIDER_ID,
    requestedServiceProviderId: null,
    serviceCategoryId: base.serviceCategoryId,
    serviceItemId: null,
    serviceCategoryNameTranslations: { 'fr-CA': 'Plomberie' },
    serviceItemNameTranslations: null,
    clientDisplayName: 'Marie',
    clientFirstName: 'Marie',
    clientLastName: 'T',
    depositStatus: null,
    acceptedQuote: base.acceptedQuote,
    ...over,
  };
}

function build(repo: Partial<ServiceRequestRepository>): ServiceRequestsService {
  return new ServiceRequestsService(
    repo as ServiceRequestRepository,
    {} as unknown as ServiceRequestAssignmentRepository,
    {} as unknown as ServiceProviderRepository,
    { findById: jest.fn().mockResolvedValue({ systemRole: 'USER' }) } as unknown as UsersRepository,
    {} as unknown as NotificationsService,
    {} as unknown as PaymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    { isEligibleForCategory: jest.fn().mockResolvedValue(true) } as unknown as ProfessionalServiceCategoryRepository,
  );
}

describe('ServiceRequestsService - agreed price on the client DTO', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('findById: an accepted tender reports the QUOTE, not the budget', async () => {
    const service = build({ findById: jest.fn().mockResolvedValue(read()) });
    const dto = await service.findById(REQUEST_ID, CLIENT_ID);

    expect(dto.agreedAmount).toBe('250.00');
    expect(dto.agreedCurrency).toBe('CAD');
    expect(dto.estimatedAmount).toBe('1500.00'); // untouched
    expect(warn).not.toHaveBeenCalled();
  });

  it('list: every item carries the field, resolved per row, from ONE read', async () => {
    const open = read({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      status: ServiceRequestStatus.OPEN,
      acceptedAtUtc: null,
      acceptedQuote: null,
    });
    const direct = read({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      requestType: ServiceRequestType.DIRECT_BOOKING,
      estimatedAmount: '90.00',
      acceptedQuote: null,
    });
    const tender = read({ id: 'aaaaaaaa-0000-4000-8000-000000000003' });
    const findAll = jest.fn().mockResolvedValue({ items: [open, direct, tender], total: 3 });
    const service = build({ findAll });

    const res = await service.list(CLIENT_ID, {} as never);

    expect(res.items.map((i) => [i.agreedAmount, i.agreedCurrency])).toEqual([
      [null, null],
      ['90.00', 'CAD'],
      ['250.00', 'CAD'],
    ]);
    expect(findAll).toHaveBeenCalledTimes(1);
  });

  it('an accepted tender with no ACCEPTED quote is SERVED with null, and warned', async () => {
    const service = build({
      findById: jest.fn().mockResolvedValue(read({ acceptedQuote: null })),
    });

    const dto = await service.findById(REQUEST_ID, CLIENT_ID);

    expect(dto.agreedAmount).toBeNull();
    expect(dto.agreedCurrency).toBeNull();
    expect(dto.id).toBe(REQUEST_ID); // the response is real, not an error
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(REQUEST_ID);
    // The request id and nothing else: no title, no client, no amounts.
    expect(message).not.toContain('Refaire');
    expect(message).not.toContain(CLIENT_ID);
    expect(message).not.toContain('1500');
  });

  it('does NOT warn for the legitimate nulls', async () => {
    const notAccepted = read({ acceptedAtUtc: null, acceptedQuote: null });
    const directNoEstimate = read({
      requestType: ServiceRequestType.DIRECT_BOOKING,
      estimatedAmount: null,
      estimatedCurrency: null,
      acceptedQuote: null,
    });
    const findById = jest
      .fn()
      .mockResolvedValueOnce(notAccepted)
      .mockResolvedValueOnce(directNoEstimate);
    const service = build({ findById });

    const a = await service.findById(REQUEST_ID, CLIENT_ID);
    const b = await service.findById(REQUEST_ID, CLIENT_ID);

    expect(a.agreedAmount).toBeNull();
    expect(b.agreedAmount).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('ServiceRequestsService - agreed price on the provider JobCard DTO', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('quote price for the retained tender, estimate for a direct job, null when OPEN', async () => {
    const rows = [
      providerRow({ id: 'bbbbbbbb-0000-4000-8000-000000000001' }),
      providerRow({
        id: 'bbbbbbbb-0000-4000-8000-000000000002',
        requestType: ServiceRequestType.DIRECT_BOOKING,
        estimatedAmount: '90.00',
        acceptedQuote: null,
      }),
      providerRow({
        id: 'bbbbbbbb-0000-4000-8000-000000000003',
        status: ServiceRequestStatus.OPEN,
        acceptedAtUtc: null,
        acceptedQuote: null,
      }),
    ];
    const find = jest.fn().mockResolvedValue({ items: rows, total: 3 });
    const service = build({ findAssignedOrTargetedToProvider: find });

    const res = await service.listForProvider(PROVIDER_ID, {} as never);

    expect(res.items.map((i) => [i.agreedAmount, i.agreedCurrency])).toEqual([
      ['250.00', 'CAD'],
      ['90.00', 'CAD'],
      [null, null],
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an accepted tender without an ACCEPTED quote is served null and warned (id only)', async () => {
    const find = jest.fn().mockResolvedValue({
      items: [providerRow({ acceptedQuote: null })],
      total: 1,
    });
    const service = build({ findAssignedOrTargetedToProvider: find });

    const res = await service.listForProvider(PROVIDER_ID, {} as never);

    expect(res.items).toHaveLength(1);
    expect(res.items[0].agreedAmount).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(REQUEST_ID);
  });
});
