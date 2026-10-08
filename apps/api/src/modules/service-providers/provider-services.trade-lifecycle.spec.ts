import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ProviderServicesService } from './provider-services.service';
import { ServiceProvidersService } from './service-providers.service';
import {
  ProfessionalServiceCategoryRepository,
  PscRecord,
  TRADE_RETIREMENT_BLOCKING_JOB_STATUSES,
} from './repositories/professional-service-category.repository';
import { ProfessionalServiceRepository } from './repositories/professional-service.repository';
import { ProfessionalServiceCategory } from './entities/professional-service-category.entity';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { ServiceItemRepository } from '../services-catalog/repositories/service-item.repository';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';
import { UpdateProviderCategoryDto } from './dto/update-provider-category.dto';
import {
  ProviderCategoryHasActiveJobsException,
  ProviderCategoryPauseNotAllowedException,
} from './exceptions/provider-exceptions';

/**
 * Verrous API — PR C2. Three locks on a trade claim's life cycle that lived
 * only in the web until now:
 *
 *   D3. `isActive` is REQUIRED on PATCH — `{}` is a 400, never a write of
 *       `undefined`.
 *   D4. Pausing (`isActive: false`) a PENDING or REJECTED claim is a 409;
 *       resuming is always allowed.
 *   D5. Retiring a trade that still carries ASSIGNED / IN_PROGRESS jobs for
 *       this provider is a 409, counted on the CATALOGUE category id.
 *
 * What the count's SQL selects (status, other provider, other category,
 * soft-deleted) is a property of a real Postgres: it is exercised by the smoke
 * against the Docker stack, not by these mocks. Here: the service logic, and
 * what the repository sends to the database.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PSC_ID = '33333333-3333-4333-8333-333333333333';
// Distinct from PSC_ID on purpose: the count must use the CATALOGUE id.
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';

// ── D3 — the DTO, through the real ValidationPipe with main.ts's options ────

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const BODY: ArgumentMetadata = { type: 'body', metatype: UpdateProviderCategoryDto };

async function expect400(body: unknown): Promise<string[]> {
  try {
    await pipe.transform(body, BODY);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error('expected the ValidationPipe to reject this body with a 400');
}

describe('UpdateProviderCategoryDto — isActive is required (D3)', () => {
  it('rejects PATCH {} with a 400 naming isActive', async () => {
    expect(await expect400({})).toEqual(['isActive must be a boolean value']);
  });

  it.each([
    ['a string', { isActive: 'false' }],
    ['null', { isActive: null }],
    ['a number', { isActive: 0 }],
  ])('rejects isActive as %s', async (_label, body) => {
    expect(await expect400(body)).toEqual(['isActive must be a boolean value']);
  });

  it.each([true, false])('accepts isActive: %s', async (isActive) => {
    await expect(pipe.transform({ isActive }, BODY)).resolves.toEqual(
      Object.assign(new UpdateProviderCategoryDto(), { isActive }),
    );
  });
});

// ── Service layer ────────────────────────────────────────────────────────────

function psc(overrides: Partial<PscRecord> = {}): PscRecord {
  return {
    id: PSC_ID,
    serviceProviderId: PROVIDER_ID,
    serviceCategoryId: CATEGORY_ID,
    verificationStatus: PscVerificationStatus.NOT_REQUIRED,
    requestedAtUtc: new Date('2026-10-01T00:00:00Z'),
    verifiedAtUtc: null,
    rejectionReason: null,
    isActive: true,
    createdAtUtc: new Date('2026-10-01T00:00:00Z'),
    updatedAtUtc: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function build(claim: PscRecord, activeJobs = 0) {
  const providersService = {
    loadOwnedProvider: jest.fn().mockResolvedValue({ id: PROVIDER_ID }),
  } as unknown as ServiceProvidersService;
  const pscRepo = {
    findById: jest.fn().mockResolvedValue(claim),
    update: jest
      .fn()
      .mockImplementation((_id: string, data: { isActive?: boolean }) =>
        Promise.resolve({ ...claim, ...data }),
      ),
    softDelete: jest.fn().mockResolvedValue(undefined),
    countActiveJobsForTrade: jest.fn().mockResolvedValue(activeJobs),
  } as unknown as ProfessionalServiceCategoryRepository;

  const service = new ProviderServicesService(
    providersService,
    pscRepo,
    {} as ProfessionalServiceRepository,
    {} as ServiceCategoryRepository,
    {} as ServiceItemRepository,
    { get: jest.fn().mockReturnValue('CAD') } as unknown as ConfigService,
  );
  return { service, pscRepo };
}

describe('ProviderServicesService.updateCategory — pause only an eligible trade (D4)', () => {
  it.each([
    ['PENDING', PscVerificationStatus.PENDING],
    ['REJECTED', PscVerificationStatus.REJECTED],
  ])('refuses to pause a %s trade with a 409, writing nothing', async (_label, status) => {
    const { service, pscRepo } = build(psc({ verificationStatus: status }));

    const err = await service
      .updateCategory(USER_ID, PROVIDER_ID, PSC_ID, { isActive: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderCategoryPauseNotAllowedException);
    expect((err as ProviderCategoryPauseNotAllowedException).getStatus()).toBe(409);
    expect((err as ProviderCategoryPauseNotAllowedException).message).toBe(
      'Only a trade whose verification is not required or verified can be paused',
    );
    expect(pscRepo.update).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_REQUIRED', PscVerificationStatus.NOT_REQUIRED],
    ['VERIFIED', PscVerificationStatus.VERIFIED],
  ])('pauses a %s trade', async (_label, status) => {
    const { service, pscRepo } = build(psc({ verificationStatus: status }));

    const updated = await service.updateCategory(USER_ID, PROVIDER_ID, PSC_ID, {
      isActive: false,
    });

    expect(pscRepo.update).toHaveBeenCalledWith(PSC_ID, { isActive: false });
    expect(updated.isActive).toBe(false);
  });

  it.each([
    ['REJECTED', PscVerificationStatus.REJECTED],
    ['PENDING', PscVerificationStatus.PENDING],
  ])('always lets a paused %s trade be RESUMED (the way out)', async (_label, status) => {
    const { service, pscRepo } = build(psc({ verificationStatus: status, isActive: false }));

    const updated = await service.updateCategory(USER_ID, PROVIDER_ID, PSC_ID, {
      isActive: true,
    });

    expect(pscRepo.update).toHaveBeenCalledWith(PSC_ID, { isActive: true });
    expect(updated.isActive).toBe(true);
  });
});

describe('ProviderServicesService.deleteCategory — no retirement with active jobs (D5)', () => {
  it('refuses with a 409 when one job is still active, and does NOT soft-delete', async () => {
    const { service, pscRepo } = build(psc(), 1);

    const err = await service
      .deleteCategory(USER_ID, PROVIDER_ID, PSC_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderCategoryHasActiveJobsException);
    expect((err as ProviderCategoryHasActiveJobsException).getStatus()).toBe(409);
    expect((err as ProviderCategoryHasActiveJobsException).message).toBe(
      'This trade still has assigned or in-progress jobs; finish them before retiring it',
    );
    expect(pscRepo.softDelete).not.toHaveBeenCalled();
  });

  it('counts on the CATALOGUE category id, never on the claim id', async () => {
    const { service, pscRepo } = build(psc(), 0);

    await service.deleteCategory(USER_ID, PROVIDER_ID, PSC_ID);

    expect(pscRepo.countActiveJobsForTrade).toHaveBeenCalledWith(PROVIDER_ID, CATEGORY_ID);
  });

  it('soft-deletes the claim when no job is active', async () => {
    const { service, pscRepo } = build(psc(), 0);

    await expect(service.deleteCategory(USER_ID, PROVIDER_ID, PSC_ID)).resolves.toBeUndefined();

    expect(pscRepo.softDelete).toHaveBeenCalledWith(PSC_ID);
  });

  it('counts BEFORE deleting', async () => {
    const { service, pscRepo } = build(psc(), 0);

    await service.deleteCategory(USER_ID, PROVIDER_ID, PSC_ID);

    const countOrder = (pscRepo.countActiveJobsForTrade as jest.Mock).mock.invocationCallOrder[0];
    const deleteOrder = (pscRepo.softDelete as jest.Mock).mock.invocationCallOrder[0];
    expect(countOrder).toBeLessThan(deleteOrder);
  });

  it('still retires a PENDING or paused trade without active jobs (any status)', async () => {
    const { service, pscRepo } = build(
      psc({ verificationStatus: PscVerificationStatus.REJECTED, isActive: false }),
      0,
    );

    await service.deleteCategory(USER_ID, PROVIDER_ID, PSC_ID);

    expect(pscRepo.softDelete).toHaveBeenCalledWith(PSC_ID);
  });
});

// ── What the repository sends to Postgres ───────────────────────────────────

describe('ProfessionalServiceCategoryRepository.countActiveJobsForTrade', () => {
  function repoWith(rows: Array<{ count: string }>) {
    const query = jest.fn().mockResolvedValue(rows);
    const typeormRepo = { query } as unknown as Repository<ProfessionalServiceCategory>;
    return { repo: new ProfessionalServiceCategoryRepository(typeormRepo), query };
  }

  it('blocks on ASSIGNED and IN_PROGRESS only — COMPLETED is excluded by decision', () => {
    expect([...TRADE_RETIREMENT_BLOCKING_JOB_STATUSES]).toEqual(['ASSIGNED', 'IN_PROGRESS']);
  });

  it('binds provider, catalogue category and the blocking statuses, in that order', async () => {
    const { repo, query } = repoWith([{ count: '0' }]);

    await repo.countActiveJobsForTrade(PROVIDER_ID, CATEGORY_ID);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([PROVIDER_ID, CATEGORY_ID, ['ASSIGNED', 'IN_PROGRESS']]);
    const compact = sql.replace(/\s+/g, ' ');
    expect(compact).toContain('FROM service_requests sr');
    expect(compact).toContain('sr.assigned_service_provider_id = $1');
    expect(compact).toContain('sr.service_category_id = $2');
    expect(compact).toContain('sr.status = ANY($3::service_request_status[])');
    expect(compact).toContain('sr.deleted_at_utc IS NULL');
  });

  it('parses the COUNT (a string from pg) into a number', async () => {
    const { repo } = repoWith([{ count: '3' }]);
    await expect(repo.countActiveJobsForTrade(PROVIDER_ID, CATEGORY_ID)).resolves.toBe(3);
  });
});
