import { BadRequestException } from '@nestjs/common';
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
import {
  DirectBookingValidationException,
  TenderValidationException,
} from './exceptions/service-request.exceptions';
import {
  MAX_ESTIMATED_AMOUNT,
  MAX_QUOTES_DEADLINE_DAYS,
  MAX_WINDOW_HOURS,
  MIN_LEAD_TIME_HOURS,
  MIN_QUOTES_DEADLINE_HOURS,
  QUOTES_DEADLINE_BUFFER_HOURS,
  RESPONSE_WINDOW_HOURS,
  TENDER_SELECTION_WINDOW_DAYS,
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

/**
 * PROJECT_TENDER creation rules (PR 1a). The clock is FROZEN — every bound is
 * tested at the exact value AND one millisecond beyond, which only means
 * something if `now` cannot drift between building the DTO and the service
 * reading its own clock. `nextTick`/`queueMicrotask`/`setImmediate` stay real:
 * the mocked repository resolves promises, and `create()` awaits them.
 *
 * Comparators, and why:
 *   • R1 floor (now + 48 h) and both ceilings (now + 30 × 24 h, start − 24 h)
 *     are INCLUSIVE — the exact value passes. Same convention as the
 *     DIRECT_BOOKING width cap (D5d): a rule stated as "at least 48 h" is met
 *     by 48 h. Hence `<` against the floor, `>` against the ceilings.
 *   • R2 end > start is STRICT — a zero-length period is no period, and it is
 *     the comparator DIRECT_BOOKING already uses for the same fact.
 *   • R4 amount > 0 is STRICT (a zero budget is no budget); the column cap is
 *     INCLUSIVE (9 999 999 999,99 is the largest value numeric(12,2) holds).
 */
const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const MS_PER_DAY = 24 * MS_PER_HOUR;

function at(msFromT0: number): string {
  return new Date(T0 + msFromT0).toISOString();
}

function tenderDto(overrides: Partial<CreateServiceRequestDto> = {}): CreateServiceRequestDto {
  return baseDto({
    requestType: ServiceRequestType.PROJECT_TENDER,
    serviceItemId: undefined,
    requestedServiceProviderId: undefined,
    desiredStartAtUtc: undefined,
    desiredEndAtUtc: undefined,
    quotesDeadlineUtc: at(72 * MS_PER_HOUR),
    // GEOCODED is part of the BASE since R5 — a tender without it is refused,
    // so a base lacking it would make every unrelated case fail for the wrong
    // reason. The R5 cases override it explicitly. Same device as the window
    // in `baseDto`.
    serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    ...overrides,
  });
}

/** Asserts the rejection's class AND which rule fired — not just "it threw". */
async function expectRejection(
  promise: Promise<unknown>,
  cls: new (...args: never[]) => Error,
  fragment: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(cls);
  await expect(promise).rejects.toThrow(fragment);
}

function freezeClock(): void {
  beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });
}

describe('ServiceRequestsService.create — PROJECT_TENDER (R1-R3)', () => {
  freezeClock();

  it('accepts a minimal tender: quotes deadline only, no period, no budget', async () => {
    const { service, created } = buildService();

    await service.create(CLIENT_ID, tenderDto());

    expect(created().status).toBe(ServiceRequestStatus.OPEN);
    expect(created().quotesDeadlineUtc?.toISOString()).toBe(at(72 * MS_PER_HOUR));
    expect(created().responseDeadlineUtc).toBeNull();
    expect(created().desiredStartAtUtc).toBeNull();
    expect(created().desiredEndAtUtc).toBeNull();
    expect(created().estimatedAmount).toBeNull();
    expect(created().estimatedCurrency).toBeNull();
  });

  it('accepts a complete tender: period, budget and a deadline before the start', async () => {
    const { service, created } = buildService();

    await service.create(
      CLIENT_ID,
      tenderDto({
        serviceItemId: ITEM_ID,
        desiredStartAtUtc: at(10 * MS_PER_DAY),
        desiredEndAtUtc: at(12 * MS_PER_DAY),
        quotesDeadlineUtc: at(5 * MS_PER_DAY),
        estimatedAmount: 2500,
        estimatedCurrency: 'CAD',
      }),
    );

    expect(created().desiredStartAtUtc?.toISOString()).toBe(at(10 * MS_PER_DAY));
    expect(created().desiredEndAtUtc?.toISOString()).toBe(at(12 * MS_PER_DAY));
    expect(created().quotesDeadlineUtc?.toISOString()).toBe(at(5 * MS_PER_DAY));
    expect(created().estimatedAmount).toBe('2500');
    expect(created().estimatedCurrency).toBe('CAD');
    // Never derived for a tender: its period is not an appointment.
    expect(created().responseDeadlineUtc).toBeNull();
  });

  it('keeps refusing a requestedServiceProviderId (pre-existing rule)', async () => {
    const { service } = buildService();

    await expectRejection(
      service.create(CLIENT_ID, tenderDto({ requestedServiceProviderId: PROVIDER_ID })),
      TenderValidationException,
      'requested_service_provider_id',
    );
  });

  describe('R1 — quotesDeadlineUtc', () => {
    it('is required', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(CLIENT_ID, tenderDto({ quotesDeadlineUtc: undefined })),
        TenderValidationException,
        'requires quotesDeadlineUtc',
      );
    });

    it(`accepts exactly now + ${MIN_QUOTES_DEADLINE_HOURS}h (floor is inclusive)`, async () => {
      const { service, created } = buildService();
      const deadline = at(MIN_QUOTES_DEADLINE_HOURS * MS_PER_HOUR);

      await service.create(CLIENT_ID, tenderDto({ quotesDeadlineUtc: deadline }));

      expect(created().quotesDeadlineUtc?.toISOString()).toBe(deadline);
    });

    it(`rejects now + ${MIN_QUOTES_DEADLINE_HOURS}h − 1 ms`, async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({ quotesDeadlineUtc: at(MIN_QUOTES_DEADLINE_HOURS * MS_PER_HOUR - 1) }),
        ),
        TenderValidationException,
        `at least ${MIN_QUOTES_DEADLINE_HOURS} hours from now`,
      );
    });

    it(`accepts exactly now + ${MAX_QUOTES_DEADLINE_DAYS} × 24h (ceiling is inclusive)`, async () => {
      const { service, created } = buildService();
      const deadline = at(MAX_QUOTES_DEADLINE_DAYS * MS_PER_DAY);

      await service.create(CLIENT_ID, tenderDto({ quotesDeadlineUtc: deadline }));

      expect(created().quotesDeadlineUtc?.toISOString()).toBe(deadline);
    });

    it(`rejects now + ${MAX_QUOTES_DEADLINE_DAYS} × 24h + 1 ms`, async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({ quotesDeadlineUtc: at(MAX_QUOTES_DEADLINE_DAYS * MS_PER_DAY + 1) }),
        ),
        TenderValidationException,
        `at most ${MAX_QUOTES_DEADLINE_DAYS} days from now`,
      );
    });

    it(`accepts exactly desiredStart − ${QUOTES_DEADLINE_BUFFER_HOURS}h (buffer is inclusive)`, async () => {
      const { service, created } = buildService();
      const start = 10 * MS_PER_DAY;
      const deadline = at(start - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR);

      await service.create(
        CLIENT_ID,
        tenderDto({
          desiredStartAtUtc: at(start),
          desiredEndAtUtc: at(start + 2 * MS_PER_HOUR),
          quotesDeadlineUtc: deadline,
        }),
      );

      expect(created().quotesDeadlineUtc?.toISOString()).toBe(deadline);
    });

    it(`rejects desiredStart − ${QUOTES_DEADLINE_BUFFER_HOURS}h + 1 ms`, async () => {
      const { service } = buildService();
      const start = 10 * MS_PER_DAY;

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({
            desiredStartAtUtc: at(start),
            desiredEndAtUtc: at(start + 2 * MS_PER_HOUR),
            quotesDeadlineUtc: at(start - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR + 1),
          }),
        ),
        TenderValidationException,
        `at least ${QUOTES_DEADLINE_BUFFER_HOURS} hours before desiredStartAtUtc`,
      );
    });
  });

  describe('R2 — optional desired period', () => {
    it('rejects a start without an end', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(CLIENT_ID, tenderDto({ desiredStartAtUtc: at(10 * MS_PER_DAY) })),
        TenderValidationException,
        'or neither',
      );
    });

    it('rejects an end without a start', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(CLIENT_ID, tenderDto({ desiredEndAtUtc: at(10 * MS_PER_DAY) })),
        TenderValidationException,
        'or neither',
      );
    });

    it('rejects an end equal to the start (strict)', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({
            desiredStartAtUtc: at(10 * MS_PER_DAY),
            desiredEndAtUtc: at(10 * MS_PER_DAY),
          }),
        ),
        TenderValidationException,
        'strictly after',
      );
    });

    it('accepts an end 1 ms after the start, and no width cap applies', async () => {
      const { service, created } = buildService();

      await service.create(
        CLIENT_ID,
        tenderDto({
          desiredStartAtUtc: at(10 * MS_PER_DAY),
          desiredEndAtUtc: at(10 * MS_PER_DAY + 1),
        }),
      );
      expect(created().desiredEndAtUtc?.toISOString()).toBe(at(10 * MS_PER_DAY + 1));

      // Far wider than the DIRECT_BOOKING cap (D5d): nothing is retained from
      // a tender's period, so there is nothing for a wide period to betray.
      const second = buildService();
      await second.service.create(
        CLIENT_ID,
        tenderDto({
          desiredStartAtUtc: at(10 * MS_PER_DAY),
          desiredEndAtUtc: at(40 * MS_PER_DAY),
        }),
      );
      expect(second.created().desiredEndAtUtc?.toISOString()).toBe(at(40 * MS_PER_DAY));
    });
  });

  describe('R3 — responseDeadlineUtc', () => {
    it('is refused on a tender, never silently kept', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({ responseDeadlineUtc: at(72 * MS_PER_HOUR) }),
        ),
        TenderValidationException,
        'must not specify responseDeadlineUtc',
      );
    });
  });

  /**
   * R5 — a tender must carry a GEOCODED location. Its reach is decided by the
   * coordinate ALONE (geographic fan-out), unlike a direct booking which names
   * its provider. The asymmetry with DIRECT_BOOKING is the point of the last
   * case here: that path still degrades on purpose, and R5 must not touch it.
   */
  describe('R5 — geocoded service location', () => {
    it('accepts a tender whose location is GEOCODED', async () => {
      const { service, created } = buildService();

      await service.create(CLIENT_ID, tenderDto());

      expect(created().serviceLocationPrecision).toBe(
        ServiceRequestLocationPrecision.GEOCODED,
      );
    });

    it('rejects a tender whose location is only a SEARCH_AREA', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({
            serviceLocationPrecision: ServiceRequestLocationPrecision.SEARCH_AREA,
          }),
        ),
        TenderValidationException,
        'requires a geocoded service location',
      );
    });

    it('rejects a tender whose location is UNKNOWN', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({
            serviceLocationPrecision: ServiceRequestLocationPrecision.UNKNOWN,
          }),
        ),
        TenderValidationException,
        'requires a geocoded service location',
      );
    });

    it('rejects a tender that omits the field entirely (stored as UNKNOWN)', async () => {
      const { service } = buildService();

      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({ serviceLocationPrecision: undefined }),
        ),
        TenderValidationException,
        'requires a geocoded service location',
      );
    });

    it('leaves DIRECT_BOOKING untouched: an UNKNOWN location is still accepted', async () => {
      const { service, created } = buildService();

      await service.create(
        CLIENT_ID,
        baseDto({
          serviceLocationPrecision: ServiceRequestLocationPrecision.UNKNOWN,
        }),
      );

      expect(created().status).toBe(ServiceRequestStatus.OPEN);
      expect(created().serviceLocationPrecision).toBe(
        ServiceRequestLocationPrecision.UNKNOWN,
      );
    });

    it('leaves DIRECT_BOOKING untouched: an omitted field is still accepted', async () => {
      const { service, created } = buildService();

      await service.create(CLIENT_ID, baseDto());

      expect(created().status).toBe(ServiceRequestStatus.OPEN);
      expect(created().serviceLocationPrecision).toBeUndefined();
    });
  });
});

describe('ServiceRequestsService.create — budget shape (R4), both request types', () => {
  freezeClock();

  it('rejects an amount without a currency', async () => {
    const { service } = buildService();

    await expectRejection(
      service.create(CLIENT_ID, tenderDto({ estimatedAmount: 500 })),
      BadRequestException,
      'must be sent together',
    );
  });

  it('rejects a currency without an amount (was a 500 on the pair CHECK)', async () => {
    const { service } = buildService();

    await expectRejection(
      service.create(CLIENT_ID, tenderDto({ estimatedCurrency: 'CAD' })),
      BadRequestException,
      'must be sent together',
    );
  });

  it('treats null as absent, as the column does', async () => {
    const { service, created } = buildService();

    await service.create(
      CLIENT_ID,
      tenderDto({
        estimatedAmount: null as unknown as number,
        estimatedCurrency: null as unknown as string,
      }),
    );

    expect(created().estimatedAmount).toBeNull();
    expect(created().estimatedCurrency).toBeNull();
  });

  it('rejects an amount of 0 (strict), accepts 0.01', async () => {
    const { service } = buildService();
    await expectRejection(
      service.create(CLIENT_ID, tenderDto({ estimatedAmount: 0, estimatedCurrency: 'CAD' })),
      BadRequestException,
      'strictly greater than 0',
    );

    const second = buildService();
    await second.service.create(
      CLIENT_ID,
      tenderDto({ estimatedAmount: 0.01, estimatedCurrency: 'CAD' }),
    );
    expect(second.created().estimatedAmount).toBe('0.01');
  });

  it(`accepts exactly ${MAX_ESTIMATED_AMOUNT} (column cap is inclusive)`, async () => {
    const { service, created } = buildService();

    await service.create(
      CLIENT_ID,
      tenderDto({ estimatedAmount: MAX_ESTIMATED_AMOUNT, estimatedCurrency: 'CAD' }),
    );

    // The string numeric(12,2) receives — must round-trip without overflow.
    expect(created().estimatedAmount).toBe('9999999999.99');
  });

  it('rejects one cent above the column cap (was a 500 "numeric field overflow")', async () => {
    const { service } = buildService();

    await expectRejection(
      service.create(
        CLIENT_ID,
        tenderDto({ estimatedAmount: 10_000_000_000, estimatedCurrency: 'CAD' }),
      ),
      BadRequestException,
      'cannot exceed',
    );
  });

  it('rejects a currency that is not three uppercase letters', async () => {
    for (const currency of ['cad', 'CA', 'CADX', 'C4D']) {
      const { service } = buildService();
      await expectRejection(
        service.create(
          CLIENT_ID,
          tenderDto({ estimatedAmount: 100, estimatedCurrency: currency }),
        ),
        BadRequestException,
        'ISO 4217',
      );
    }
  });

  /**
   * The margin this PR touches on DIRECT_BOOKING: a malformed budget that used
   * to reach SQL and fail in 500 is now a 400 there too — same guard, same
   * exception, because the guard runs before the type is looked at.
   */
  it('applies to DIRECT_BOOKING too: a currency without an amount is a 400', async () => {
    const { service } = buildService();

    await expectRejection(
      service.create(
        CLIENT_ID,
        baseDto({
          desiredStartAtUtc: at(3 * MS_PER_HOUR),
          desiredEndAtUtc: at(5 * MS_PER_HOUR),
          estimatedCurrency: 'CAD',
        }),
      ),
      BadRequestException,
      'must be sent together',
    );
  });

  /**
   * The non-regression the arbitration asked for. The WHOLE insert payload is
   * pinned, not a field or two: a VALID direct booking must reach the
   * repository exactly as it did before this PR. This test also passes on
   * `main` (checked by running it there) — it is a fixed point, not a new rule.
   */
  it('stores a VALID DIRECT_BOOKING exactly as before', async () => {
    const { service, created } = buildService();

    await service.create(
      CLIENT_ID,
      baseDto({
        desiredStartAtUtc: at(3 * MS_PER_HOUR),
        desiredEndAtUtc: at(5 * MS_PER_HOUR),
        estimatedAmount: 150,
        estimatedCurrency: 'CAD',
        serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
      }),
    );

    expect(created()).toEqual({
      clientUserId: CLIENT_ID,
      requestType: ServiceRequestType.DIRECT_BOOKING,
      status: ServiceRequestStatus.OPEN,
      serviceCategoryId: CATEGORY_ID,
      serviceItemId: ITEM_ID,
      requestedServiceProviderId: PROVIDER_ID,
      title: 'Coloration',
      description: 'Une coloration complète.',
      serviceAddress: '1 rue de Test, Québec, QC',
      serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
      serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
      desiredStartAtUtc: new Date(at(3 * MS_PER_HOUR)),
      desiredEndAtUtc: new Date(at(5 * MS_PER_HOUR)),
      estimatedAmount: '150',
      estimatedCurrency: 'CAD',
      // min(start, now + 48 h) = the start, 3 h away.
      responseDeadlineUtc: new Date(at(3 * MS_PER_HOUR)),
      quotesDeadlineUtc: null,
    });
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
    // Required on a tender since PR 1a (R1) — without it every tender case
    // below would fail for the wrong reason.
    quotesDeadlineUtc: hoursFromNow(72),
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

  it('accepts a PROJECT_TENDER with none of the conditional fields but its deadline', () => {
    expect(errorsFor(tenderBase)).toEqual([]);
  });

  it('still checks the FORMAT of a value a tender does supply', () => {
    expect(errorsFor({ ...tenderBase, desiredStartAtUtc: 'nope' })).toContain(
      'desiredStartAtUtc',
    );
    expect(errorsFor({ ...tenderBase, serviceItemId: 'nope' })).toContain('serviceItemId');
  });
});

/**
 * The HTTP door for PR 1a. Only the rules the DTO CAN express live here:
 * quotesDeadlineUtc required on a tender (R1, presence only — its bounds
 * depend on `now`) and the budget's shape (R4). Same options as `main.ts`.
 *
 * ⚠️ The DIRECT_BOOKING controls are the point, not padding: R4 is enforced
 * for BOTH types, and a valid direct booking must come through with zero
 * errors exactly as before.
 */
describe('CreateServiceRequestDto — tender deadline (R1) & budget shape (R4)', () => {
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
    quotesDeadlineUtc: hoursFromNow(72),
  };

  it('rejects a tender without quotesDeadlineUtc', () => {
    expect(errorsFor({ ...tenderBase, quotesDeadlineUtc: undefined })).toEqual([
      'quotesDeadlineUtc',
    ]);
  });

  it('checks the FORMAT of quotesDeadlineUtc on either type', () => {
    expect(errorsFor({ ...tenderBase, quotesDeadlineUtc: 'nope' })).toEqual(['quotesDeadlineUtc']);
    expect(errorsFor({ ...directBase, quotesDeadlineUtc: 'nope' })).toEqual(['quotesDeadlineUtc']);
  });

  it('treats null as missing on a tender', () => {
    expect(errorsFor({ ...tenderBase, quotesDeadlineUtc: null })).toEqual(['quotesDeadlineUtc']);
  });

  it('does not require quotesDeadlineUtc on a DIRECT_BOOKING, null included (as before)', () => {
    expect(errorsFor(directBase)).toEqual([]);
    expect(errorsFor({ ...directBase, quotesDeadlineUtc: null })).toEqual([]);
  });

  it('names the pairing rule when one half of the budget is missing', () => {
    const messages = (payload: Record<string, unknown>): string[] =>
      validateSync(plainToInstance(CreateServiceRequestDto, payload) as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }).flatMap((e) => Object.values(e.constraints ?? {}));

    expect(messages({ ...tenderBase, estimatedCurrency: 'CAD' })).toContain(
      'estimatedAmount must be sent together with estimatedCurrency',
    );
    expect(messages({ ...tenderBase, estimatedAmount: 500 })).toContain(
      'estimatedCurrency must be sent together with estimatedAmount',
    );
  });

  it('accepts a VALID DIRECT_BOOKING with a budget, exactly as before', () => {
    expect(errorsFor({ ...directBase, estimatedAmount: 150, estimatedCurrency: 'CAD' })).toEqual(
      [],
    );
  });

  it('rejects an amount without a currency', () => {
    expect(errorsFor({ ...tenderBase, estimatedAmount: 500 })).toEqual(['estimatedCurrency']);
  });

  it('rejects a currency without an amount — on both types', () => {
    expect(errorsFor({ ...tenderBase, estimatedCurrency: 'CAD' })).toEqual(['estimatedAmount']);
    expect(errorsFor({ ...directBase, estimatedCurrency: 'CAD' })).toEqual(['estimatedAmount']);
  });

  it('accepts neither, and null as neither', () => {
    expect(errorsFor(tenderBase)).toEqual([]);
    expect(
      errorsFor({ ...tenderBase, estimatedAmount: null, estimatedCurrency: null }),
    ).toEqual([]);
  });

  it('rejects 0 and a negative amount, accepts 0.01', () => {
    expect(errorsFor({ ...tenderBase, estimatedAmount: 0, estimatedCurrency: 'CAD' })).toEqual([
      'estimatedAmount',
    ]);
    expect(errorsFor({ ...tenderBase, estimatedAmount: -5, estimatedCurrency: 'CAD' })).toEqual([
      'estimatedAmount',
    ]);
    expect(errorsFor({ ...tenderBase, estimatedAmount: 0.01, estimatedCurrency: 'CAD' })).toEqual(
      [],
    );
  });

  it(`accepts exactly ${MAX_ESTIMATED_AMOUNT}, rejects above it`, () => {
    expect(
      errorsFor({ ...tenderBase, estimatedAmount: MAX_ESTIMATED_AMOUNT, estimatedCurrency: 'CAD' }),
    ).toEqual([]);
    expect(
      errorsFor({ ...tenderBase, estimatedAmount: 10_000_000_000, estimatedCurrency: 'CAD' }),
    ).toEqual(['estimatedAmount']);
  });

  it('rejects a currency that is not three uppercase letters', () => {
    for (const currency of ['cad', 'CA', 'CADX', 'C4D']) {
      expect(
        errorsFor({ ...tenderBase, estimatedAmount: 100, estimatedCurrency: currency }),
      ).toEqual(['estimatedCurrency']);
    }
  });
});

/**
 * R7 — the selection window. The RULE itself lives in SQL (a `CASE` over an
 * `EXISTS` on `quotes`), which is deliberate: it is a set operation over two
 * tables, and mirroring it in TypeScript would create a second source of truth
 * free to drift — the same reasoning that keeps the three-review threshold
 * inside its query rather than in a component.
 *
 * ⚠️ WHAT THIS BLOCK DOES AND DOES NOT PROVE. It proves the WIRING: the cron
 * hands the repository the configured window, and transitions whatever comes
 * back. It does NOT prove the predicate — no mock can, since the predicate is
 * evaluated by Postgres. The truth table (before the deadline / after it with
 * and without an acceptable quote / at +7 days + 1 / a quote merely withdrawn,
 * expired or rejected / DIRECT_BOOKING unchanged) is exercised against a real
 * database in the PR's smoke, case by case.
 */
describe('ServiceRequestsService.runExpiryCheck — selection window wiring (R7)', () => {
  function buildExpiryService(expired: ServiceRequestRecord[]): {
    service: ServiceRequestsService;
    findExpiredOpen: jest.Mock;
    update: jest.Mock;
  } {
    const findExpiredOpen = jest.fn().mockResolvedValue(expired);
    const update = jest.fn().mockResolvedValue(undefined);
    const requestRepo = { findExpiredOpen, update } as unknown as ServiceRequestRepository;

    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {},
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;

    const service = new ServiceRequestsService(
      requestRepo,
      {} as unknown as ServiceRequestAssignmentRepository,
      {} as unknown as ServiceProviderRepository,
      {} as unknown as UsersRepository,
      {} as unknown as NotificationsService,
      {} as unknown as PaymentsService,
      { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
      dataSource,
    );

    return { service, findExpiredOpen, update };
  }

  function openTender(): ServiceRequestRecord {
    return recordFrom({
      clientUserId: CLIENT_ID,
      requestType: ServiceRequestType.PROJECT_TENDER,
      status: ServiceRequestStatus.OPEN,
      serviceCategoryId: CATEGORY_ID,
      title: 'Appel d’offres',
      description: 'Description.',
      serviceAddress: '1 rue de Test, Québec, QC',
      serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
      serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    } as CreateServiceRequestData);
  }

  it('passes the configured selection window to the repository', async () => {
    const { service, findExpiredOpen } = buildExpiryService([]);

    await service.runExpiryCheck();

    expect(findExpiredOpen).toHaveBeenCalledWith(TENDER_SELECTION_WINDOW_DAYS);
  });

  it('expires exactly what the repository returns, and nothing when it returns none', async () => {
    const empty = buildExpiryService([]);
    await expect(empty.service.runExpiryCheck()).resolves.toEqual({ expired: 0 });
    expect(empty.update).not.toHaveBeenCalled();

    const one = buildExpiryService([openTender()]);
    await expect(one.service.runExpiryCheck()).resolves.toEqual({ expired: 1 });
    expect(one.update).toHaveBeenCalledWith(
      expect.any(String),
      { status: ServiceRequestStatus.EXPIRED },
      expect.anything(),
    );
  });
});
