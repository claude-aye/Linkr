import { DataSource, EntityManager } from 'typeorm';
import { QuotesService } from './quotes.service';
import { QuoteRecord, QuoteRepository } from './repositories/quote.repository';
import { QuoteStatus } from './enums/quote-status.enum';
import { QuoteExpiredException } from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { NotRequestOwnerException } from '../service-requests/exceptions/service-request.exceptions';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ProfessionalServiceCategoryRepository } from '../service-providers/repositories/professional-service-category.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { PaymentsService } from '../payments/payments.service';
import { DepositChargeFailedException } from '../payments/exceptions/payments.exceptions';

/**
 * `QuotesService.accept` — T4 on the quote path: once the assignment is
 * committed, NOTHING thrown by the deposit capture may escape. The outcome is
 * reported through `depositSettled` (the controller turns `false` into 202).
 *
 * Fully mocked: no database, no Stripe. Patron: accept-request.atomicity.spec.ts.
 */

const QUOTE_ID = '77777777-7777-4777-8777-777777777777';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_USER_ID = '66666666-6666-4666-8666-666666666666';

function quote(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: QUOTE_ID,
    serviceRequestId: REQUEST_ID,
    serviceProviderId: PROVIDER_ID,
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

function buildHarness(opts: {
  locked?: QuoteRecord;
  captureDeposit?: jest.Mock;
} = {}) {
  let commit = false;
  let rollback = false;
  const locked = opts.locked ?? quote();

  const quotesRepo = {
    findByIdForUpdate: jest.fn().mockResolvedValue(locked),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    rejectSiblings: jest.fn().mockResolvedValue(2),
    // The post-commit re-read: the quote as the DB now holds it.
    findById: jest.fn().mockResolvedValue({ ...locked, status: QuoteStatus.ACCEPTED }),
  } as unknown as QuoteRepository;

  const assignIndividualProvider = jest.fn().mockResolvedValue(undefined);
  const announceDepositFailure = jest.fn();
  const serviceRequestsService = {
    lockRequestForUpdate: jest.fn().mockResolvedValue({
      id: REQUEST_ID,
      clientUserId: CLIENT_ID,
      requestType: ServiceRequestType.PROJECT_TENDER,
      status: ServiceRequestStatus.OPEN,
    }),
    assignIndividualProvider,
    announceDepositFailure,
  } as unknown as ServiceRequestsService;

  const providerRepo = {
    findById: jest.fn().mockResolvedValue({
      id: PROVIDER_ID,
      providerType: ProviderType.INDIVIDUAL,
      userId: PROVIDER_USER_ID,
    }),
  } as unknown as ServiceProviderRepository;

  const captureDeposit = opts.captureDeposit ?? jest.fn().mockResolvedValue(undefined);
  const paymentsService = {
    captureDeposit,
    isProviderChargeable: jest.fn().mockResolvedValue(true),
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

  const service = new QuotesService(
    quotesRepo,
    serviceRequestsService,
    providerRepo,
    {} as unknown as ProfessionalServiceCategoryRepository,
    paymentsService,
    dataSource,
  );

  return {
    service,
    captureDeposit,
    announceDepositFailure,
    assignIndividualProvider,
    committed: () => commit,
    rolledBack: () => rollback,
  };
}

describe('QuotesService.accept - deposit never speaks for the assignment (T4)', () => {
  it('reports depositSettled: true when the capture succeeds', async () => {
    const h = buildHarness();

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome.depositSettled).toBe(true);
    expect(outcome.quote.status).toBe(QuoteStatus.ACCEPTED);
    expect(h.committed()).toBe(true);
    expect(h.captureDeposit).toHaveBeenCalledTimes(1);
    expect(h.captureDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ agreedAmount: '400.00', agreedCurrency: 'CAD' }),
    );
    expect(h.announceDepositFailure).not.toHaveBeenCalled();
  });

  it('swallows a capture failure: depositSettled false, no throw, commit stands', async () => {
    const h = buildHarness({
      captureDeposit: jest
        .fn()
        .mockRejectedValue(new DepositChargeFailedException('card_declined')),
    });

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome.depositSettled).toBe(false);
    expect(outcome.quote.status).toBe(QuoteStatus.ACCEPTED);
    expect(h.committed()).toBe(true);
    expect(h.rolledBack()).toBe(false);
    expect(h.assignIndividualProvider).toHaveBeenCalledTimes(1);
    expect(h.announceDepositFailure).toHaveBeenCalledTimes(1);
    expect(h.announceDepositFailure).toHaveBeenCalledWith(REQUEST_ID);
  });

  it('swallows an unexpected (non-HTTP) capture error too', async () => {
    const h = buildHarness({ captureDeposit: jest.fn().mockRejectedValue(new Error('boom')) });

    const outcome = await h.service.accept(QUOTE_ID, CLIENT_ID);

    expect(outcome.depositSettled).toBe(false);
    expect(h.announceDepositFailure).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner BEFORE commit: rollback, capture never called', async () => {
    const h = buildHarness();

    await expect(h.service.accept(QUOTE_ID, 'someone-else')).rejects.toBeInstanceOf(
      NotRequestOwnerException,
    );
    expect(h.rolledBack()).toBe(true);
    expect(h.committed()).toBe(false);
    expect(h.captureDeposit).not.toHaveBeenCalled();
    expect(h.announceDepositFailure).not.toHaveBeenCalled();
  });

  it('rejects an expired quote BEFORE commit: rollback, capture never called', async () => {
    const h = buildHarness({ locked: quote({ validUntilUtc: new Date(Date.now() - 1000) }) });

    await expect(h.service.accept(QUOTE_ID, CLIENT_ID)).rejects.toBeInstanceOf(
      QuoteExpiredException,
    );
    expect(h.rolledBack()).toBe(true);
    expect(h.committed()).toBe(false);
    expect(h.assignIndividualProvider).not.toHaveBeenCalled();
    expect(h.captureDeposit).not.toHaveBeenCalled();
  });
});
