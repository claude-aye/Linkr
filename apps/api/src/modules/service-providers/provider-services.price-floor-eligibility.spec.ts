import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderServicesService } from './provider-services.service';
import { ServiceProvidersService } from './service-providers.service';
import {
  ProfessionalServiceCategoryRepository,
  PscRecord,
} from './repositories/professional-service-category.repository';
import {
  ProfessionalServiceRepository,
  PsRecord,
} from './repositories/professional-service.repository';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { ServiceItemRepository } from '../services-catalog/repositories/service-item.repository';
import { ApprovalStatus } from '../services-catalog/enums/approval-status.enum';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';
import { PricingModel } from './enums/pricing-model.enum';
import {
  CreateProfessionalServiceDto,
  MIN_SERVICE_PRICE_AMOUNT,
} from './dto/create-professional-service.dto';
import { UpdateProfessionalServiceDto } from './dto/update-professional-service.dto';
import { ProviderCategoryNotEligibleException } from './exceptions/provider-exceptions';

/**
 * Verrous API — PR C1. Two locks that lived only in the web until now:
 *
 *   1. A 5 $ floor on `priceAmount` (DTO, `@Min(MIN_SERVICE_PRICE_AMOUNT)`),
 *      inherited by the edit DTO through `PartialType` — proved here, not
 *      assumed.
 *   2. `createService` refuses a trade the public listing would not show:
 *      paused, PENDING or REJECTED → 409, before any catalogue lookup.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PSC_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const SERVICE_ID = '66666666-6666-4666-8666-666666666666';

// ── DTO layer: the real ValidationPipe, with main.ts's exact options ─────────

/**
 * `main.ts` installs `ValidationPipe({ whitelist, forbidNonWhitelisted,
 * transform })`. Running the body through that same pipe is what an HTTP 400
 * is made of; a raw `validateSync` would skip the transform step.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function runPipe(metatype: ArgumentMetadata['metatype'], body: object): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype });
}

async function expect400(metatype: ArgumentMetadata['metatype'], body: object): Promise<string[]> {
  try {
    await runPipe(metatype, body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const response = (err as BadRequestException).getResponse() as { message: string[] };
    return response.message;
  }
  throw new Error('expected the ValidationPipe to reject this body with a 400');
}

describe('price floor — CreateProfessionalServiceDto / UpdateProfessionalServiceDto', () => {
  it('pins the floor constant at 5', () => {
    expect(MIN_SERVICE_PRICE_AMOUNT).toBe(5);
  });

  it('rejects a FLAT creation at 4.99 with a 400 naming priceAmount', async () => {
    const messages = await expect400(CreateProfessionalServiceDto, {
      serviceItemId: ITEM_ID,
      pricingModel: PricingModel.FLAT,
      priceAmount: 4.99,
    });
    expect(messages).toEqual(['priceAmount must not be less than 5']);
  });

  it('accepts a FLAT creation at exactly 5 (inclusive floor)', async () => {
    await expect(
      runPipe(CreateProfessionalServiceDto, {
        serviceItemId: ITEM_ID,
        pricingModel: PricingModel.FLAT,
        priceAmount: 5,
      }),
    ).resolves.toBeInstanceOf(CreateProfessionalServiceDto);
  });

  it('applies the floor to HOURLY too', async () => {
    const messages = await expect400(CreateProfessionalServiceDto, {
      serviceItemId: ITEM_ID,
      pricingModel: PricingModel.HOURLY,
      priceAmount: 4,
    });
    expect(messages).toEqual(['priceAmount must not be less than 5']);
  });

  it('keeps QUOTE_ONLY exempt (no price, no floor)', async () => {
    await expect(
      runPipe(CreateProfessionalServiceDto, {
        serviceItemId: ITEM_ID,
        pricingModel: PricingModel.QUOTE_ONLY,
      }),
    ).resolves.toBeInstanceOf(CreateProfessionalServiceDto);
  });

  it('INHERITS the floor on edit: PATCH priceAmount 4 is a 400', async () => {
    const messages = await expect400(UpdateProfessionalServiceDto, { priceAmount: 4 });
    expect(messages).toEqual(['priceAmount must not be less than 5']);
  });

  it('accepts an edit price at exactly 5', async () => {
    await expect(
      runPipe(UpdateProfessionalServiceDto, { priceAmount: 5 }),
    ).resolves.toBeInstanceOf(UpdateProfessionalServiceDto);
  });

  it('only validates what is SENT: an edit without priceAmount passes the pipe', async () => {
    await expect(
      runPipe(UpdateProfessionalServiceDto, {
        estimatedDurationMinutes: 45,
        descriptionOverride: 'Précision',
        isActive: false,
      }),
    ).resolves.toBeInstanceOf(UpdateProfessionalServiceDto);
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

function ps(overrides: Partial<PsRecord> = {}): PsRecord {
  return {
    id: SERVICE_ID,
    professionalServiceCategoryId: PSC_ID,
    serviceItemId: ITEM_ID,
    pricingModel: PricingModel.FLAT,
    priceAmount: 40,
    priceCurrency: 'CAD',
    estimatedDurationMinutes: null,
    descriptionOverride: null,
    isActive: true,
    createdAtUtc: new Date('2026-10-01T00:00:00Z'),
    updatedAtUtc: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function build(claim: PscRecord, existing: PsRecord = ps()) {
  const providersService = {
    loadOwnedProvider: jest.fn().mockResolvedValue({ id: PROVIDER_ID }),
  } as unknown as ServiceProvidersService;
  const pscRepo = {
    findById: jest.fn().mockResolvedValue(claim),
  } as unknown as ProfessionalServiceCategoryRepository;
  const psRepo = {
    existsActive: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockImplementation((data: Partial<PsRecord>) =>
      Promise.resolve(ps({ ...data, id: 'created' })),
    ),
    findById: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockImplementation((_id: string, data: Partial<PsRecord>) =>
      Promise.resolve({ ...existing, ...stripUndefined(data) }),
    ),
  } as unknown as ProfessionalServiceRepository;
  const itemRepo = {
    findById: jest.fn().mockResolvedValue({
      id: ITEM_ID,
      serviceCategoryId: CATEGORY_ID,
      approvalStatus: ApprovalStatus.APPROVED,
    }),
  } as unknown as ServiceItemRepository;
  const configService = {
    get: jest.fn().mockReturnValue('CAD'),
  } as unknown as ConfigService;

  const service = new ProviderServicesService(
    providersService,
    pscRepo,
    psRepo,
    {} as ServiceCategoryRepository,
    itemRepo,
    configService,
  );
  return { service, psRepo, itemRepo };
}

function stripUndefined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const CREATE_DTO: CreateProfessionalServiceDto = {
  serviceItemId: ITEM_ID,
  pricingModel: PricingModel.FLAT,
  priceAmount: 40,
};

describe('ProviderServicesService.createService — trade eligibility', () => {
  it.each([
    ['PENDING', PscVerificationStatus.PENDING],
    ['REJECTED', PscVerificationStatus.REJECTED],
  ])('refuses a %s trade with a 409, before any catalogue lookup or write', async (_label, status) => {
    const { service, psRepo, itemRepo } = build(psc({ verificationStatus: status }));

    await expect(
      service.createService(USER_ID, PROVIDER_ID, PSC_ID, CREATE_DTO),
    ).rejects.toBeInstanceOf(ProviderCategoryNotEligibleException);

    expect(itemRepo.findById).not.toHaveBeenCalled();
    expect(psRepo.existsActive).not.toHaveBeenCalled();
    expect(psRepo.create).not.toHaveBeenCalled();
  });

  it('answers with HTTP 409 and an English message naming the rule', async () => {
    const { service } = build(psc({ verificationStatus: PscVerificationStatus.PENDING }));
    const err = await service
      .createService(USER_ID, PROVIDER_ID, PSC_ID, CREATE_DTO)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderCategoryNotEligibleException);
    expect((err as ProviderCategoryNotEligibleException).getStatus()).toBe(409);
    expect((err as ProviderCategoryNotEligibleException).message).toBe(
      'Services can only be added to an active, eligible trade (not paused; verification not required or verified)',
    );
  });

  it.each([
    ['NOT_REQUIRED', PscVerificationStatus.NOT_REQUIRED],
    ['VERIFIED', PscVerificationStatus.VERIFIED],
  ])('refuses a PAUSED %s trade with a 409 (the web blocks it too)', async (_label, status) => {
    const { service, psRepo, itemRepo } = build(
      psc({ verificationStatus: status, isActive: false }),
    );

    await expect(
      service.createService(USER_ID, PROVIDER_ID, PSC_ID, CREATE_DTO),
    ).rejects.toBeInstanceOf(ProviderCategoryNotEligibleException);
    expect(itemRepo.findById).not.toHaveBeenCalled();
    expect(psRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_REQUIRED', PscVerificationStatus.NOT_REQUIRED],
    ['VERIFIED', PscVerificationStatus.VERIFIED],
  ])('creates the service on an active %s trade', async (_label, status) => {
    const { service, psRepo } = build(psc({ verificationStatus: status }));

    const created = await service.createService(USER_ID, PROVIDER_ID, PSC_ID, CREATE_DTO);

    expect(created.id).toBe('created');
    expect(psRepo.create).toHaveBeenCalledTimes(1);
    expect(psRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalServiceCategoryId: PSC_ID,
        serviceItemId: ITEM_ID,
        pricingModel: PricingModel.FLAT,
        priceAmount: 40,
        priceCurrency: 'CAD',
      }),
    );
  });
});

describe('ProviderServicesService.updateService — out of the eligibility lock', () => {
  it('edits a historical service priced UNDER the floor without restating its price', async () => {
    const legacy = ps({ priceAmount: 2 });
    const { service, psRepo } = build(psc(), legacy);

    const updated = await service.updateService(USER_ID, PROVIDER_ID, SERVICE_ID, {
      descriptionOverride: 'Précision ajoutée',
    });

    expect(psRepo.update).toHaveBeenCalledWith(
      SERVICE_ID,
      expect.objectContaining({ descriptionOverride: 'Précision ajoutée', priceAmount: undefined }),
    );
    expect(updated.priceAmount).toBe(2);
    expect(updated.descriptionOverride).toBe('Précision ajoutée');
  });

  it('still lets a service be edited under a PAUSED, PENDING trade (creation-only lock)', async () => {
    const { service, psRepo } = build(
      psc({ verificationStatus: PscVerificationStatus.PENDING, isActive: false }),
    );

    await service.updateService(USER_ID, PROVIDER_ID, SERVICE_ID, { isActive: false });

    expect(psRepo.update).toHaveBeenCalledTimes(1);
  });
});
