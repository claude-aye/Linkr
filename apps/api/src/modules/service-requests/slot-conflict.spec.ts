import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import {
  CreateServiceRequestData,
  ServiceRequestRecord,
  ServiceRequestRepository,
} from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import {
  InvalidStateTransitionException,
  SLOT_CONFLICT,
  SLOT_TAKEN,
  SlotConflictException,
  SlotTakenException,
} from './exceptions/service-request.exceptions';
import {
  APPOINTMENT_DEFAULT_MINUTES,
  AVAILABILITY_BLOCKING_STATUSES,
  BUSY_JOB_STATUSES,
  findSlotConflict,
  intervalsOverlap,
  SlotCandidate,
  timedIntervalOf,
} from './appointment-slots';
// Test-only import across modules: the parity check below is the drift guard
// between the slot rule and the calendar's own timing rule.
import { resolveEventTiming } from '../calendar/event-timing';
import { DEFAULT_EVENT_MINUTES } from '../calendar/constants';
import { AVAILABILITY_BLOCKING_STATUSES as CALENDAR_BLOCKING } from '../calendar/repositories/calendar-events.repository';

/**
 * CAL-3 — a conflict with another appointment is a refusal; everything else
 * stays information (§13.1 nº 32 c, amended 18 November 2026).
 *
 * The overlap rule is pure and pinned here by tables. The SQL around it (whose
 * rows, the lock, two concurrent creations) is exercised against a real
 * Postgres by `src/database/probes/slot-conflict.probe.ts`.
 */

const H = 60 * 60 * 1000;
const T10 = Date.parse('2026-12-02T15:00:00Z'); // mercredi 10 h, heure de l'Est

function candidate(overrides: Partial<SlotCandidate> = {}): SlotCandidate {
  return {
    id: 'other',
    status: ServiceRequestStatus.ASSIGNED,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    anchorAtUtc: new Date(T10),
    desiredEndAtUtc: new Date(T10 + 2 * H),
    serviceDurationMinutes: 60, // occupies 10 h – 11 h
    ...overrides,
  };
}

function win(startH: number, endH: number) {
  return { startMs: T10 + startH * H, endMs: T10 + endH * H };
}

describe('appointment slots — one list of blocking statuses', () => {
  it('the calendar reads THE SAME list (re-exported, never re-declared)', () => {
    expect(CALENDAR_BLOCKING).toBe(AVAILABILITY_BLOCKING_STATUSES);
    expect([...AVAILABILITY_BLOCKING_STATUSES]).toEqual([
      ServiceRequestStatus.OPEN,
      ServiceRequestStatus.ASSIGNED,
      ServiceRequestStatus.IN_PROGRESS,
    ]);
    expect([...BUSY_JOB_STATUSES]).toEqual([
      ServiceRequestStatus.ASSIGNED,
      ServiceRequestStatus.IN_PROGRESS,
    ]);
    expect(DEFAULT_EVENT_MINUTES).toBe(APPOINTMENT_DEFAULT_MINUTES);
  });
});

describe('findSlotConflict — creation (blocking statuses), existing 10 h – 11 h', () => {
  it.each([
    ['partial overlap at the start', win(-0.5, 0.5), true],
    ['partial overlap at the end', win(0.5, 1.5), true],
    ['window inside the appointment', win(0.25, 0.75), true],
    ['window enclosing the appointment', win(-1, 2), true],
    ['same window', win(0, 1), true],
    ['touching before (ends at 10 h)', win(-1, 0), false],
    ['touching after (starts at 11 h)', win(1, 2), false],
    ['far away', win(5, 6), false],
  ])('%s → conflict %s', (_label, window, expected) => {
    expect(findSlotConflict(window, [candidate()], AVAILABILITY_BLOCKING_STATUSES) !== null).toBe(
      expected,
    );
  });

  it.each([
    [ServiceRequestStatus.OPEN, true],
    [ServiceRequestStatus.ASSIGNED, true],
    [ServiceRequestStatus.IN_PROGRESS, true],
    [ServiceRequestStatus.CANCELLED, false],
    [ServiceRequestStatus.EXPIRED, false],
    [ServiceRequestStatus.COMPLETED, false],
    [ServiceRequestStatus.PAID, false],
    [ServiceRequestStatus.REFUNDED, false],
    [ServiceRequestStatus.DRAFT, false],
  ])('existing status %s → conflict %s', (status, expected) => {
    const found = findSlotConflict(win(0, 1), [candidate({ status })], AVAILABILITY_BLOCKING_STATUSES);
    expect(found !== null).toBe(expected);
  });

  it('an accepted TENDER names a day, not an hour: it never blocks', () => {
    const tender = candidate({ requestType: ServiceRequestType.PROJECT_TENDER });
    expect(findSlotConflict(win(0, 1), [tender], AVAILABILITY_BLOCKING_STATUSES)).toBeNull();
  });

  it('an undated appointment occupies no hour', () => {
    const undated = candidate({ anchorAtUtc: null });
    expect(findSlotConflict(win(0, 1), [undated], AVAILABILITY_BLOCKING_STATUSES)).toBeNull();
  });

  it('no candidate at all (blocked period only, outside opening hours) → no conflict', () => {
    expect(findSlotConflict(win(0, 1), [], AVAILABILITY_BLOCKING_STATUSES)).toBeNull();
  });

  it('a 45-min service booked « between 10 h and 17 h » blocks 10 h – 10 h 45 only', () => {
    const short = candidate({ serviceDurationMinutes: 45, desiredEndAtUtc: new Date(T10 + 7 * H) });
    expect(findSlotConflict(win(0.75, 2), [short], AVAILABILITY_BLOCKING_STATUSES)).toBeNull();
    expect(findSlotConflict(win(0.5, 2), [short], AVAILABILITY_BLOCKING_STATUSES)).not.toBeNull();
  });
});

describe('creation checks the OCCUPIED time, not the whole offered window', () => {
  // 10 h – 17 h offered for a 45-min service: what the booking occupies is
  // timedIntervalOf(...) = 10 h – 10 h 45, exactly what the repository checks.
  const offered = candidate({
    id: 'new',
    status: ServiceRequestStatus.OPEN,
    desiredEndAtUtc: new Date(T10 + 7 * H),
    serviceDurationMinutes: 45,
  });

  it('a confirmed appointment at 14 h does not refuse it', () => {
    const occupied = timedIntervalOf(offered);
    expect(occupied).toEqual({ startMs: T10, endMs: T10 + 45 * 60_000 });
    const at14 = candidate({ anchorAtUtc: new Date(T10 + 4 * H) });
    expect(findSlotConflict(occupied!, [at14], AVAILABILITY_BLOCKING_STATUSES)).toBeNull();
  });

  it('a confirmed appointment at 10 h 30 refuses it', () => {
    const occupied = timedIntervalOf(offered);
    const at1030 = candidate({ anchorAtUtc: new Date(T10 + 0.5 * H) });
    expect(findSlotConflict(occupied!, [at1030], AVAILABILITY_BLOCKING_STATUSES)).not.toBeNull();
  });
});

describe('findSlotConflict — acceptance (confirmed statuses only)', () => {
  it.each([
    [ServiceRequestStatus.ASSIGNED, true],
    [ServiceRequestStatus.IN_PROGRESS, true],
    [ServiceRequestStatus.OPEN, false],
    [ServiceRequestStatus.COMPLETED, false],
  ])('existing status %s → conflict %s', (status, expected) => {
    const found = findSlotConflict(win(0, 1), [candidate({ status })], BUSY_JOB_STATUSES, 'self');
    expect(found !== null).toBe(expected);
  });

  it('the request being accepted is never its own conflict', () => {
    const self = candidate({ id: 'self' });
    expect(findSlotConflict(win(0, 1), [self], BUSY_JOB_STATUSES, 'self')).toBeNull();
  });
});

describe('intervalsOverlap — half-open bounds', () => {
  it('touching intervals do not overlap, in either order', () => {
    expect(intervalsOverlap(win(0, 1), win(1, 2))).toBe(false);
    expect(intervalsOverlap(win(1, 2), win(0, 1))).toBe(false);
    expect(intervalsOverlap(win(0, 1.01), win(1, 2))).toBe(true);
  });
});

describe('timedIntervalOf — parity with the calendar (resolveEventTiming)', () => {
  // Diverging would let the API refuse a slot the picker offers, or accept one
  // it hides. Every branch of the end rule, both sides.
  it.each([
    ['listed duration', { serviceDurationMinutes: 45, desiredEndAtUtc: new Date(T10 + 3 * H) }],
    ['window end (no duration)', { serviceDurationMinutes: null, desiredEndAtUtc: new Date(T10 + 3 * H) }],
    ['zero duration falls back to window', { serviceDurationMinutes: 0, desiredEndAtUtc: new Date(T10 + 2 * H) }],
    ['default (no duration, no window)', { serviceDurationMinutes: null, desiredEndAtUtc: null }],
    ['default (window ends before start)', { serviceDurationMinutes: null, desiredEndAtUtc: new Date(T10 - H) }],
  ])('%s', (_label, overrides) => {
    const c = candidate(overrides);
    const timing = resolveEventTiming(c);
    expect(timing.kind).toBe('TIMED');
    const interval = timedIntervalOf(c);
    if (timing.kind !== 'TIMED') throw new Error('unreachable');
    expect(interval).toEqual({ startMs: timing.startMs, endMs: timing.endMs });
  });

  it('a tender is ALL_DAY on the calendar and has no interval here', () => {
    const c = candidate({ requestType: ServiceRequestType.PROJECT_TENDER });
    expect(resolveEventTiming(c).kind).toBe('ALL_DAY');
    expect(timedIntervalOf(c)).toBeNull();
  });

  it('an undated entry is UNSCHEDULED on the calendar and has no interval here', () => {
    const c = candidate({ anchorAtUtc: null });
    expect(resolveEventTiming(c).kind).toBe('UNSCHEDULED');
    expect(timedIntervalOf(c)).toBeNull();
  });
});

// ── Service wiring ──────────────────────────────────────────────────────────

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_USER_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * H).toISOString();
}

function record(overrides: Partial<ServiceRequestRecord> = {}): ServiceRequestRecord {
  return {
    id: REQUEST_ID,
    clientUserId: CLIENT_ID,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    status: ServiceRequestStatus.OPEN,
    serviceCategoryId: '33333333-3333-4333-8333-333333333333',
    serviceItemId: '44444444-4444-4444-8444-444444444444',
    requestedServiceProviderId: PROVIDER_ID,
    assignedServiceProviderId: null,
    title: 'Coloration',
    description: 'Une coloration complete.',
    serviceAddress: '1 rue de Test, Quebec, QC',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
    desiredStartAtUtc: new Date('2026-12-02T15:00:00Z'),
    desiredEndAtUtc: new Date('2026-12-02T17:00:00Z'),
    scheduledAtUtc: null,
    estimatedAmount: '150.00',
    estimatedCurrency: 'CAD',
    finalAmount: null,
    finalCurrency: null,
    responseDeadlineUtc: null,
    quotesDeadlineUtc: null,
    acceptedAtUtc: null,
    completedAtUtc: null,
    paidAtUtc: null,
    contestedAtUtc: null,
    cancelledAtUtc: null,
    cancellationReason: null,
    cancelledByUserId: null,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...overrides,
  } as ServiceRequestRecord;
}

function buildCreateHarness(guard: 'free' | 'taken' | 'gone') {
  const insertDirectBookingIfSlotFree = jest.fn(async (data: CreateServiceRequestData) =>
    guard === 'free'
      ? { inserted: true, record: { ...record(), ...data, acceptedQuote: null } }
      : { inserted: false, reason: guard === 'taken' ? 'SLOT_TAKEN' : 'PROVIDER_GONE' },
  );
  const create = jest.fn(async (data: CreateServiceRequestData) => ({
    ...record(),
    ...data,
    acceptedQuote: null,
  }));
  const notifyDirectBooking = jest.fn().mockResolvedValue(undefined);
  const service = new ServiceRequestsService(
    { insertDirectBookingIfSlotFree, create } as unknown as ServiceRequestRepository,
    {} as unknown as ServiceRequestAssignmentRepository,
    {
      findById: jest.fn().mockResolvedValue({
        id: PROVIDER_ID,
        providerType: ProviderType.INDIVIDUAL,
        userId: PROVIDER_USER_ID,
        isActive: true,
      }),
    } as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    {
      notifyDirectBooking,
      broadcastTenderMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    {} as unknown as PaymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {} as unknown as DataSource,
    {} as unknown as ProfessionalServiceCategoryRepository,
  );
  return { service, insertDirectBookingIfSlotFree, create, notifyDirectBooking };
}

function bookingDto(overrides: Partial<CreateServiceRequestDto> = {}): CreateServiceRequestDto {
  return {
    requestType: ServiceRequestType.DIRECT_BOOKING,
    serviceCategoryId: '33333333-3333-4333-8333-333333333333',
    serviceItemId: '44444444-4444-4444-8444-444444444444',
    requestedServiceProviderId: PROVIDER_ID,
    title: 'Coloration',
    description: 'Une coloration complète.',
    serviceAddress: '1 rue de Test, Québec, QC',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    desiredStartAtUtc: hoursFromNow(30),
    desiredEndAtUtc: hoursFromNow(32),
    ...overrides,
  } as CreateServiceRequestDto;
}

describe('ServiceRequestsService.create — SLOT_TAKEN', () => {
  it('passes the exact [start, end) window and the provider to the guard', async () => {
    const h = buildCreateHarness('free');
    const dto = bookingDto();
    await h.service.create(CLIENT_ID, dto);
    expect(h.insertDirectBookingIfSlotFree).toHaveBeenCalledTimes(1);
    const [, providerId, window] = h.insertDirectBookingIfSlotFree.mock.calls[0] as unknown as [
      unknown,
      string,
      { startMs: number; endMs: number },
    ];
    expect(providerId).toBe(PROVIDER_ID);
    expect(window).toEqual({
      startMs: Date.parse(dto.desiredStartAtUtc as string),
      endMs: Date.parse(dto.desiredEndAtUtc as string),
    });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('409 with code SLOT_TAKEN when the slot is taken — and nobody is notified', async () => {
    const h = buildCreateHarness('taken');
    const err = await h.service.create(CLIENT_ID, bookingDto()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlotTakenException);
    expect((err as SlotTakenException).getStatus()).toBe(409);
    expect((err as SlotTakenException).getResponse()).toMatchObject({ code: SLOT_TAKEN });
    expect(h.notifyDirectBooking).not.toHaveBeenCalled();
  });

  it('404 when the provider vanished under the lock', async () => {
    const h = buildCreateHarness('gone');
    await expect(h.service.create(CLIENT_ID, bookingDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('a PROJECT_TENDER never goes through the slot guard', async () => {
    const h = buildCreateHarness('taken');
    await h.service.create(
      CLIENT_ID,
      bookingDto({
        requestType: ServiceRequestType.PROJECT_TENDER,
        requestedServiceProviderId: undefined,
        serviceItemId: undefined,
        serviceLocationPrecision: ServiceRequestLocationPrecision.GEOCODED,
        quotesDeadlineUtc: hoursFromNow(72),
        desiredStartAtUtc: hoursFromNow(120),
        desiredEndAtUtc: hoursFromNow(122),
      }),
    );
    expect(h.insertDirectBookingIfSlotFree).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

function buildAcceptHarness(opts: { conflict: boolean; locked?: ServiceRequestRecord }) {
  let committed = false;
  let rolledBack = false;
  const txManager = {} as EntityManager;
  const locked = opts.locked ?? record();
  const hasConfirmedSlotConflict = jest.fn().mockResolvedValue(opts.conflict);
  const assertDepositBasis = jest.fn();
  const assertPayable = jest.fn().mockResolvedValue(undefined);
  const captureDeposit = jest.fn().mockResolvedValue(undefined);
  const assignmentCreate = jest.fn().mockResolvedValue({ id: 'a-1' });
  const update = jest.fn().mockResolvedValue(undefined);

  const service = new ServiceRequestsService(
    {
      findById: jest.fn().mockResolvedValue(record()),
      findByIdForUpdate: jest.fn().mockResolvedValue(locked),
      update,
      hasConfirmedSlotConflict,
    } as unknown as ServiceRequestRepository,
    { create: assignmentCreate } as unknown as ServiceRequestAssignmentRepository,
    {
      findById: jest.fn().mockResolvedValue({
        id: PROVIDER_ID,
        providerType: ProviderType.INDIVIDUAL,
        userId: PROVIDER_USER_ID,
        isActive: true,
      }),
    } as unknown as ServiceProviderRepository,
    {} as unknown as UsersRepository,
    {
      notifyRequestAccepted: jest.fn().mockResolvedValue(undefined),
      notifyDepositFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    { assertDepositBasis, assertPayable, captureDeposit } as unknown as PaymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn(async () => {
          committed = true;
        }),
        rollbackTransaction: jest.fn(async () => {
          rolledBack = true;
        }),
        release: jest.fn().mockResolvedValue(undefined),
        manager: txManager,
      }),
    } as unknown as DataSource,
    {
      isEligibleForCategory: jest.fn().mockResolvedValue(true),
    } as unknown as ProfessionalServiceCategoryRepository,
  );
  return {
    service,
    txManager,
    hasConfirmedSlotConflict,
    assertDepositBasis,
    assertPayable,
    captureDeposit,
    assignmentCreate,
    update,
    committed: () => committed,
    rolledBack: () => rolledBack,
  };
}

describe('ServiceRequestsService.acceptRequest — SLOT_CONFLICT', () => {
  it('409 with code SLOT_CONFLICT, nothing written, no Stripe call, rolled back', async () => {
    const h = buildAcceptHarness({ conflict: true });
    const err = await h.service
      .acceptRequest(REQUEST_ID, PROVIDER_USER_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlotConflictException);
    expect((err as SlotConflictException).getResponse()).toMatchObject({ code: SLOT_CONFLICT });
    expect(h.assertDepositBasis).not.toHaveBeenCalled();
    expect(h.assertPayable).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.assignmentCreate).not.toHaveBeenCalled();
    expect(h.captureDeposit).not.toHaveBeenCalled();
    expect(h.rolledBack()).toBe(true);
    expect(h.committed()).toBe(false);
  });

  it('checks inside the transaction, on the LOCKED provider, for this request', async () => {
    const h = buildAcceptHarness({ conflict: false });
    const outcome = await h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID);
    expect(h.hasConfirmedSlotConflict).toHaveBeenCalledWith(h.txManager, REQUEST_ID, PROVIDER_ID);
    expect(outcome.depositSettled).toBe(true);
    expect(h.captureDeposit).toHaveBeenCalledTimes(1);
    expect(h.committed()).toBe(true);
  });

  it('a cancelled request still says so: the state 409 comes before the slot check', async () => {
    const h = buildAcceptHarness({
      conflict: true,
      locked: record({ status: ServiceRequestStatus.CANCELLED }),
    });
    await expect(h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID)).rejects.toBeInstanceOf(
      InvalidStateTransitionException,
    );
    expect(h.hasConfirmedSlotConflict).not.toHaveBeenCalled();
  });
});
