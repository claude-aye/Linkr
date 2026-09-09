import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceRequestsService } from './service-requests.service';
import {
  ServiceRequestRecord,
  ServiceRequestRepository,
} from './repositories/service-request.repository';
import { ServiceRequestAssignmentRepository } from './repositories/service-request-assignment.repository';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { UsersRepository } from '../users/users.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestType } from './enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from './enums/service-request-location-precision.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { InvalidStateTransitionException } from './exceptions/service-request.exceptions';
import {
  DepositAmountUnavailableException,
  DepositChargeFailedException,
  ProviderNotChargeableException,
} from '../payments/exceptions/payments.exceptions';

/**
 * `acceptRequest` reads the status UNDER THE LOCK, never from the pre-flight read.
 *
 * The property under test is NOT "a stale status is rejected" — the old code
 * rejected a stale CANCELLED too, it simply validated it against the wrong row.
 * It is: **the status the state machine validates comes from
 * `findByIdForUpdate`, inside the transaction**. Every case below therefore
 * hands the two reads DIFFERENT statuses, so a service that trusts the
 * pre-flight copy and one that trusts the locked row cannot both pass.
 *
 * Fully mocked: no database. The row lock itself is a Postgres behaviour and is
 * proved separately, by two concurrent HTTP accepts against the real stack.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_USER_ID = '66666666-6666-4666-8666-666666666666';

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
    desiredStartAtUtc: new Date('2026-10-01T14:00:00Z'),
    desiredEndAtUtc: new Date('2026-10-01T16:00:00Z'),
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

interface Harness {
  service: ServiceRequestsService;
  captureDeposit: jest.Mock;
  assertDepositBasis: jest.Mock;
  assignmentCreate: jest.Mock;
  committed: () => boolean;
  rolledBack: () => boolean;
}

/**
 * @param preflight what the UNLOCKED `findById` returns (the stale copy)
 * @param locked    what `findByIdForUpdate` returns (the truth)
 */
function buildHarness(
  preflight: ServiceRequestRecord,
  locked: ServiceRequestRecord | null,
  opts?: { captureDeposit?: jest.Mock },
): Harness {
  let commit = false;
  let rollback = false;

  const requestRepo = {
    findById: jest.fn().mockResolvedValue(preflight),
    findByIdForUpdate: jest.fn().mockResolvedValue(locked),
    update: jest.fn().mockResolvedValue(undefined),
  } as unknown as ServiceRequestRepository;

  const assignmentCreate = jest.fn().mockResolvedValue({ id: 'assignment-1' });
  const assignmentRepo = {
    create: assignmentCreate,
  } as unknown as ServiceRequestAssignmentRepository;

  const providerRepo = {
    findById: jest.fn().mockResolvedValue({
      id: PROVIDER_ID,
      providerType: ProviderType.INDIVIDUAL,
      userId: PROVIDER_USER_ID,
      isActive: true,
    }),
  } as unknown as ServiceProviderRepository;

  const captureDeposit = opts?.captureDeposit ?? jest.fn().mockResolvedValue(undefined);
  const assertDepositBasis = jest.fn();
  const paymentsService = {
    assertPayable: jest.fn().mockResolvedValue(undefined),
    assertDepositBasis,
    captureDeposit,
  } as unknown as PaymentsService;

  const dataSource = {
    createQueryRunner: () => ({
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn(async () => {
        commit = true;
      }),
      rollbackTransaction: jest.fn(async () => {
        rollback = true;
      }),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {} as EntityManager,
    }),
  } as unknown as DataSource;

  const service = new ServiceRequestsService(
    requestRepo,
    assignmentRepo,
    providerRepo,
    {} as unknown as UsersRepository,
    {} as unknown as NotificationsService,
    paymentsService,
    { getOrThrow: jest.fn().mockReturnValue(72) } as unknown as ConfigService,
    dataSource,
  );

  return {
    service,
    captureDeposit,
    assertDepositBasis,
    assignmentCreate,
    committed: () => commit,
    rolledBack: () => rollback,
  };
}

describe('ServiceRequestsService.acceptRequest - locked status read', () => {
  it('409s when the request was CANCELLED after the pre-flight read', async () => {
    // The exact race: the dashboard rendered OPEN, the client cancelled, the
    // provider clicked. Pre-flight still says OPEN; the locked row says CANCELLED.
    const h = buildHarness(
      record({ status: ServiceRequestStatus.OPEN }),
      record({ status: ServiceRequestStatus.CANCELLED }),
    );

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).rejects.toBeInstanceOf(InvalidStateTransitionException);

    expect(h.assignmentCreate).not.toHaveBeenCalled();
    expect(h.captureDeposit).not.toHaveBeenCalled();
    expect(h.rolledBack()).toBe(true);
    expect(h.committed()).toBe(false);
  });

  it('409s when the expiry cron EXPIRED the request after the pre-flight read', async () => {
    const h = buildHarness(
      record({ status: ServiceRequestStatus.OPEN }),
      record({ status: ServiceRequestStatus.EXPIRED }),
    );

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).rejects.toBeInstanceOf(InvalidStateTransitionException);
    expect(h.assignmentCreate).not.toHaveBeenCalled();
  });

  it('409s on the losing side of a double accept (locked row already ASSIGNED)', async () => {
    // Two concurrent accepts: the loser FOR-UPDATEs and reads the committed
    // ASSIGNED row. It never reaches the assignment INSERT, so it never relies
    // on `uq_sra_one_live_per_request` to stop it — the index is the belt, this
    // is the braces.
    const h = buildHarness(
      record({ status: ServiceRequestStatus.OPEN }),
      record({
        status: ServiceRequestStatus.ASSIGNED,
        assignedServiceProviderId: PROVIDER_ID,
      }),
    );

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).rejects.toBeInstanceOf(InvalidStateTransitionException);
    expect(h.assignmentCreate).not.toHaveBeenCalled();
    expect(h.captureDeposit).not.toHaveBeenCalled();
  });

  it('accepts when the pre-flight was stale in the HARMLESS direction (DRAFT then OPEN)', async () => {
    // The mirror image, and the reason the two reads must be told apart: here it
    // is the STALE copy that would have refused. A service still keyed on the
    // pre-flight read would 409 a perfectly acceptable request.
    const h = buildHarness(
      record({ status: ServiceRequestStatus.DRAFT }),
      record({ status: ServiceRequestStatus.OPEN }),
    );

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).resolves.toBeDefined();

    expect(h.assignmentCreate).toHaveBeenCalledTimes(1);
    expect(h.committed()).toBe(true);
  });

  it('captures the deposit from the LOCKED row, not the pre-flight copy', async () => {
    // Belt for the money path: the capture basis must not come from a row read
    // outside the lock.
    const h = buildHarness(
      record({ estimatedAmount: '999.00', estimatedCurrency: 'USD' }),
      record({ estimatedAmount: '150.00', estimatedCurrency: 'CAD' }),
    );

    await h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID);

    expect(h.captureDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ agreedAmount: '150.00', agreedCurrency: 'CAD' }),
    );
  });

  it('403s if the targeted provider changed under the lock', async () => {
    const h = buildHarness(
      record({ requestedServiceProviderId: PROVIDER_ID }),
      record({ requestedServiceProviderId: '99999999-9999-4999-8999-999999999999' }),
    );

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.assignmentCreate).not.toHaveBeenCalled();
  });
});

describe('ServiceRequestsService.acceptRequest - the deposit never speaks for the assignment', () => {
  it('keeps the assignment and reports depositSettled: false when the capture throws', async () => {
    // The bug this replaces: the capture threw AFTER the commit, so the provider
    // was told the accept had failed while holding a job they did not know about
    // — and the FR copy behind that 502 invited a retry that then 409s.
    const boom = jest.fn().mockRejectedValue(new DepositChargeFailedException('card declined'));
    const h = buildHarness(record(), record(), { captureDeposit: boom });

    const outcome = await h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID);

    expect(outcome.depositSettled).toBe(false);
    expect(outcome.request).toBeDefined();
    expect(h.committed()).toBe(true);
    expect(h.assignmentCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 502 from Stripe', new DepositChargeFailedException('network')],
    ['a 409 racing the payability guard', new ProviderNotChargeableException()],
    ['an unexpected error', new Error('boom')],
  ])('swallows %s rather than lie about the assignment', async (_label, err) => {
    // ANY throw from the capture, not just Stripe's: none of them can
    // un-commit the assignment, so none of them may be reported as its failure.
    const h = buildHarness(record(), record(), {
      captureDeposit: jest.fn().mockRejectedValue(err),
    });

    const outcome = await h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID);

    expect(outcome.depositSettled).toBe(false);
    expect(h.committed()).toBe(true);
  });

  it('reports depositSettled: true on the nominal path', async () => {
    const h = buildHarness(record(), record());

    const outcome = await h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID);

    expect(outcome.depositSettled).toBe(true);
    expect(h.captureDeposit).toHaveBeenCalledTimes(1);
  });

  it('refuses BEFORE the commit when there is no amount to base a deposit on', async () => {
    // The mirror image, and the reason this precondition moved inside the
    // transaction: "no amount" is a fact about the REQUEST, so it must cost
    // nothing. Left to the capture it produced a 422 on an already-assigned job
    // — the same stuck state, by a second route.
    const h = buildHarness(record(), record({ estimatedAmount: null, estimatedCurrency: null }), {
      captureDeposit: jest.fn(),
    });
    h.assertDepositBasis.mockImplementation(() => {
      throw new DepositAmountUnavailableException();
    });

    await expect(
      h.service.acceptRequest(REQUEST_ID, PROVIDER_USER_ID),
    ).rejects.toBeInstanceOf(DepositAmountUnavailableException);

    expect(h.committed()).toBe(false);
    expect(h.rolledBack()).toBe(true);
    expect(h.assignmentCreate).not.toHaveBeenCalled();
  });
});
