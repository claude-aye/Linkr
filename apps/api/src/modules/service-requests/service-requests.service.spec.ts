import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import {
  CreateServiceRequestData,
  ServiceRequestRecord,
  ServiceRequestRepository,
} from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { DirectBookingValidationException } from './exceptions/service-request.exceptions';
import {
  MAX_WINDOW_HOURS,
  MIN_LEAD_TIME_HOURS,
  RESPONSE_WINDOW_HOURS,
} from './constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Desired window (PR 1, tightened by PR 3). Three properties are under test,
 * and none of them is visible from the DTO — every case here calls `create()`
 * directly, PAST the ValidationPipe, which is exactly why the service mirrors
 * the DTO instead of trusting it:
 *   • the two bounds are REQUIRED for a DIRECT_BOOKING (D3) and still absent-
 *     able for a PROJECT_TENDER;
 *   • the window is at most MAX_WINDOW_HOURS wide, STRICTLY (D5d) — 24 h pile
 *     passes, 24 h + 1 ms does not;
 *   • the response deadline is DERIVED — min(desired start, now + window) — and
 *     OVERWRITES anything the caller sent (D5/D7).
 * Everything is mocked: no database, no clock control beyond a tolerance.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

/** Tolerance for "same instant" assertions: the service reads its own clock. */
const CLOCK_SLACK_MS = 5_000;

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * MS_PER_HOUR).toISOString();
}

function baseDto(overrides: Partial<CreateServiceRequestDto> = {}): CreateServiceRequestDto {
  return {
    requestType: ServiceRequestType.DIRECT_BOOKING,
    serviceCategoryId: CATEGORY_ID,
    serviceItemId: ITEM_ID,
    requestedServiceProviderId: PROVIDER_ID,
    title: 'Coloration',
    description: 'Une coloration complète.',
    serviceAddress: '1 rue de Test, Québec, QC',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    // A valid window is part of the BASE since PR 3: the bounds are required
    // for a DIRECT_BOOKING, so a base without them would make every unrelated
    // case fail for the wrong reason. Cases that test their ABSENCE strip them
    // explicitly with `undefined`.
    desiredStartAtUtc: hoursFromNow(3),
    desiredEndAtUtc: hoursFromNow(5),
    ...overrides,
  } as CreateServiceRequestDto;
}

function recordFrom(data: CreateServiceRequestData): ServiceRequestRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    clientUserId: data.clientUserId,
    requestType: data.requestType,
    status: data.status,
    serviceCategoryId: data.serviceCategoryId,
    serviceItemId: data.serviceItemId ?? null,
    requestedServiceProviderId: data.requestedServiceProviderId ?? null,
    assignedServiceProviderId: null,
    title: data.title,
    description: data.description,
    serviceAddress: data.serviceAddress,
    serviceLocation: data.serviceLocation,
    serviceLocationPrecision:
      data.serviceLocationPrecision ?? ServiceRequestLocationPrecision.UNKNOWN,
    desiredStartAtUtc: data.desiredStartAtUtc ?? null,
    desiredEndAtUtc: data.desiredEndAtUtc ?? null,
    scheduledAtUtc: null,
    estimatedAmount: data.estimatedAmount ?? null,
    estimatedCurrency: data.estimatedCurrency ?? null,
    finalAmount: null,
    finalCurrency: null,
    responseDeadlineUtc: data.responseDeadlineUtc ?? null,
    quotesDeadlineUtc: data.quotesDeadlineUtc ?? null,
    acceptedAtUtc: null,
    completedAtUtc: null,
    paidAtUtc: null,
    contestedAtUtc: null,
    cancelledAtUtc: null,
    cancellationReason: null,
    cancelledByUserId: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

/** Builds the service with just enough mocked collaborators for `create()`. */
function buildService(): {
  service: ServiceRequestsService;
  created: () => CreateServiceRequestData;
} {
  let captured: CreateServiceRequestData | undefined;

  const requestRepo = {
    create: jest.fn(async (data: CreateServiceRequestData) => {
      captured = data;
      return recordFrom(data);
    }),
  } as unknown as ServiceRequestRepository;

  const providerRepo = {
    findById: jest.fn().mockResolvedValue({
      id: PROVIDER_ID,
      providerType: ProviderType.INDIVIDUAL,
      userId: '66666666-6666-4666-8666-666666666666',
      isActive: true,
    }),
  } as unknown as ServiceProviderRepository;

  // Best-effort, fire-and-forget on both branches: must resolve, never reject.
  const notificationsService = {
    notifyDirectBooking: jest.fn().mockResolvedValue(undefined),
    broadcastTenderMatch: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  const service = new ServiceRequestsService(
    requestRepo,
    {} as unknown as ServiceRequestAssignmentRepository,
    providerRepo,
    {} as unknown as UsersRepository,
    notificationsService,
    {} as unknown as PaymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
  );

  return {
    service,
    created: () => {
      if (!captured) throw new Error('requestRepo.create was never called');
      return captured;
    },
  };
}

describe('ServiceRequestsService.create — desired window coherence', () => {
  it('rejects a window whose end is not strictly after its start', async () => {
    const { service } = buildService();
    const start = hoursFromNow(5);

    await expect(
      service.create(CLIENT_ID, baseDto({ desiredStartAtUtc: start, desiredEndAtUtc: start })),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  it('rejects an end that precedes the start', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({ desiredStartAtUtc: hoursFromNow(5), desiredEndAtUtc: hoursFromNow(4) }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  it(`rejects a start less than ${MIN_LEAD_TIME_HOURS}h away`, async () => {
    const { service } = buildService();

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({ desiredStartAtUtc: hoursFromNow(0.5), desiredEndAtUtc: hoursFromNow(3) }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  it('rejects a start without an end', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({ desiredStartAtUtc: hoursFromNow(5), desiredEndAtUtc: undefined }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  it('rejects an end without a start', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({ desiredStartAtUtc: undefined, desiredEndAtUtc: hoursFromNow(5) }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  /**
   * The INVERSION of PR 1's non-regression case. Until the web form filled the
   * bounds, a windowless DIRECT_BOOKING had to be accepted; now that it does,
   * the same input is a 400. This is the case that would silently pass again if
   * someone re-added an `if (desiredStartAtUtc)` guard to the service.
   */
  it('rejects a DIRECT_BOOKING with no bounds at all (D3)', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({ desiredStartAtUtc: undefined, desiredEndAtUtc: undefined }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });

  /**
   * THE boundary pair. `>=` instead of `>` passes every other case in this file
   * and fails only the second of these two — which is why they are written
   * together and must stay together.
   */
  it(`accepts a window of exactly ${MAX_WINDOW_HOURS}h`, async () => {
    const { service, created } = buildService();
    const start = hoursFromNow(3);

    await service.create(
      CLIENT_ID,
      baseDto({
        desiredStartAtUtc: start,
        desiredEndAtUtc: new Date(
          new Date(start).getTime() + MAX_WINDOW_HOURS * MS_PER_HOUR,
        ).toISOString(),
      }),
    );

    expect(created().desiredStartAtUtc?.toISOString()).toBe(new Date(start).toISOString());
  });

  it(`rejects a window wider than ${MAX_WINDOW_HOURS}h`, async () => {
    const { service } = buildService();
    const start = hoursFromNow(3);

    await expect(
      service.create(
        CLIENT_ID,
        baseDto({
          desiredStartAtUtc: start,
          desiredEndAtUtc: new Date(
            new Date(start).getTime() + (MAX_WINDOW_HOURS + 1) * MS_PER_HOUR,
          ).toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(DirectBookingValidationException);
  });
});

describe('ServiceRequestsService.create — response deadline derivation', () => {
  it('uses the desired start when it falls inside the response window', async () => {
    const { service, created } = buildService();
    const start = hoursFromNow(3);

    await service.create(
      CLIENT_ID,
      baseDto({ desiredStartAtUtc: start, desiredEndAtUtc: hoursFromNow(5) }),
    );

    expect(created().responseDeadlineUtc?.toISOString()).toBe(new Date(start).toISOString());
  });

  /**
   * THE test of the pair. An implementation that simply copies the desired
   * start passes every other case in this file and fails only here.
   */
  it(`caps the deadline at now + ${RESPONSE_WINDOW_HOURS}h for a far-off start`, async () => {
    const { service, created } = buildService();
    const start = hoursFromNow(24 * 10);
    const expected = Date.now() + RESPONSE_WINDOW_HOURS * MS_PER_HOUR;

    await service.create(
      CLIENT_ID,
      baseDto({ desiredStartAtUtc: start, desiredEndAtUtc: hoursFromNow(24 * 10 + 2) }),
    );

    const deadline = created().responseDeadlineUtc;
    expect(deadline).not.toBeNull();
    expect(Math.abs((deadline as Date).getTime() - expected)).toBeLessThan(CLOCK_SLACK_MS);
    // And emphatically NOT the desired start.
    expect((deadline as Date).getTime()).toBeLessThan(new Date(start).getTime());
  });

  it('OVERWRITES a caller-supplied deadline instead of honouring it (D7)', async () => {
    const { service, created } = buildService();
    const start = hoursFromNow(3);
    const forged = hoursFromNow(24 * 30);

    await service.create(
      CLIENT_ID,
      baseDto({
        desiredStartAtUtc: start,
        desiredEndAtUtc: hoursFromNow(5),
        responseDeadlineUtc: forged,
      }),
    );

    const deadline = created().responseDeadlineUtc;
    expect(deadline?.toISOString()).toBe(new Date(start).toISOString());
    expect(deadline?.toISOString()).not.toBe(new Date(forged).toISOString());
  });
});

describe('ServiceRequestsService.create — non-regression: PROJECT_TENDER is untouched', () => {
  /**
   * The bounds became mandatory for DIRECT_BOOKING only. A tender has no
   * appointment to schedule, so it must still be creatable without them — the
   * case that would break if the requirement were hoisted out of the branch.
   */
  it('leaves PROJECT_TENDER untouched: no bounds, no derived deadline', async () => {
    const { service, created } = buildService();

    await service.create(
      CLIENT_ID,
      baseDto({
        requestType: ServiceRequestType.PROJECT_TENDER,
        serviceItemId: undefined,
        requestedServiceProviderId: undefined,
        desiredStartAtUtc: undefined,
        desiredEndAtUtc: undefined,
      }),
    );

    expect(created().status).toBe(ServiceRequestStatus.OPEN);
    expect(created().responseDeadlineUtc).toBeNull();
  });

  /**
   * A tender is not subject to the DIRECT_BOOKING coherence rules, and its own
   * quotes deadline is never overwritten.
   */
  it('does not derive a deadline for a tender that happens to carry a start', async () => {
    const { service, created } = buildService();
    const quotesDeadline = hoursFromNow(24 * 5);

    await service.create(
      CLIENT_ID,
      baseDto({
        requestType: ServiceRequestType.PROJECT_TENDER,
        serviceItemId: undefined,
        requestedServiceProviderId: undefined,
        desiredStartAtUtc: hoursFromNow(24 * 10),
        desiredEndAtUtc: undefined,
        quotesDeadlineUtc: quotesDeadline,
      }),
    );

    expect(created().responseDeadlineUtc).toBeNull();
    expect(created().quotesDeadlineUtc?.toISOString()).toBe(new Date(quotesDeadline).toISOString());
  });
});

/**
 * DTO level, not service level — on purpose. What is under test here is the D9
 * repair: the `@ValidateIf` pattern itself, which lives entirely in the DTO and
 * which every other case in this file bypasses by calling `create()` directly.
 *
 * The options mirror `main.ts` exactly (`whitelist` + `forbidNonWhitelisted`);
 * a probe that validated under different options would prove something the
 * running app never does.
 *
 * ⚠️ The two PROJECT_TENDER cases are not padding. A single
 * `@ValidateIf(DIRECT_BOOKING)` — the obvious repair — passes every
 * DIRECT_BOOKING case below and silently drops format checking on a tender,
 * re-opening the very 500 this repair closes, by the other door. Delete them
 * and the disjunction can be "simplified" back with a green suite.
 */
describe('CreateServiceRequestDto — conditional validation (D9)', () => {
  function errorsFor(payload: Record<string, unknown>): string[] {
    const dto = plainToInstance(CreateServiceRequestDto, payload);
    return validateSync(dto as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
      .map((e) => e.property)
      .sort();
  }

  const directBase = {
    requestType: ServiceRequestType.DIRECT_BOOKING,
    serviceCategoryId: CATEGORY_ID,
    serviceItemId: ITEM_ID,
    requestedServiceProviderId: PROVIDER_ID,
    title: 'Coloration',
    description: 'Une coloration complète.',
    serviceAddress: '1 rue de Test, Québec, QC',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    desiredStartAtUtc: hoursFromNow(3),
    desiredEndAtUtc: hoursFromNow(5),
  };

  const tenderBase = {
    ...directBase,
    requestType: ServiceRequestType.PROJECT_TENDER,
    serviceItemId: undefined,
    requestedServiceProviderId: undefined,
    desiredStartAtUtc: undefined,
    desiredEndAtUtc: undefined,
  };

  it('accepts a well-formed DIRECT_BOOKING (the control)', () => {
    expect(errorsFor(directBase)).toEqual([]);
  });

  it('rejects a malformed serviceItemId on DIRECT_BOOKING — 400, not a SQL 500', () => {
    expect(errorsFor({ ...directBase, serviceItemId: 'nope' })).toContain('serviceItemId');
  });

  it('rejects an absent serviceItemId on DIRECT_BOOKING', () => {
    expect(errorsFor({ ...directBase, serviceItemId: undefined })).toContain('serviceItemId');
  });

  it('rejects a malformed requestedServiceProviderId on DIRECT_BOOKING', () => {
    expect(errorsFor({ ...directBase, requestedServiceProviderId: 'nope' })).toContain(
      'requestedServiceProviderId',
    );
  });

  it('rejects absent bounds on DIRECT_BOOKING (D3, at the HTTP door)', () => {
    expect(
      errorsFor({ ...directBase, desiredStartAtUtc: undefined, desiredEndAtUtc: undefined }),
    ).toEqual(['desiredEndAtUtc', 'desiredStartAtUtc']);
  });

  it('accepts a PROJECT_TENDER with none of the conditional fields', () => {
    expect(errorsFor(tenderBase)).toEqual([]);
  });

  it('still checks the FORMAT of a value a tender does supply', () => {
    expect(errorsFor({ ...tenderBase, desiredStartAtUtc: 'nope' })).toContain(
      'desiredStartAtUtc',
    );
    expect(errorsFor({ ...tenderBase, serviceItemId: 'nope' })).toContain('serviceItemId');
  });
});
