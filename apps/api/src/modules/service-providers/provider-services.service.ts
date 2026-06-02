import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RegulationLevel } from '../services-catalog/enums/regulation-level.enum';
import { ApprovalStatus } from '../services-catalog/enums/approval-status.enum';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { ServiceItemRepository } from '../services-catalog/repositories/service-item.repository';
import { ServiceProvidersService } from './service-providers.service';
import {
  ProfessionalServiceCategoryRepository,
  PscRecord,
} from './repositories/professional-service-category.repository';
import {
  ProfessionalServiceRepository,
  PsRecord,
} from './repositories/professional-service.repository';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';
import { PricingModel } from './enums/pricing-model.enum';
import { AddProviderCategoryDto } from './dto/add-provider-category.dto';
import { UpdateProviderCategoryDto } from './dto/update-provider-category.dto';
import { ProviderCategoryResponseDto } from './dto/provider-category-response.dto';
import { CreateProfessionalServiceDto } from './dto/create-professional-service.dto';
import { UpdateProfessionalServiceDto } from './dto/update-professional-service.dto';
import { ProfessionalServiceResponseDto } from './dto/professional-service-response.dto';
import {
  ProviderCategoryConflictException,
  ProviderServiceConflictException,
  ServiceItemNotApprovedException,
  ServiceItemNotInCategoryException,
} from './exceptions/provider-exceptions';

@Injectable()
export class ProviderServicesService {
  private readonly logger = new Logger(ProviderServicesService.name);
  private readonly defaultCurrency: string;

  constructor(
    private readonly providersService: ServiceProvidersService,
    private readonly pscRepo: ProfessionalServiceCategoryRepository,
    private readonly psRepo: ProfessionalServiceRepository,
    private readonly categoryRepo: ServiceCategoryRepository,
    private readonly itemRepo: ServiceItemRepository,
    private readonly configService: ConfigService,
  ) {
    this.defaultCurrency = this.configService.get<string>(
      'PLATFORM_DEFAULT_CURRENCY',
      'CAD',
    );
  }

  // ── Professional Service Categories ──────────────────────────────────────

  async addCategory(
    currentUserId: string,
    providerId: string,
    dto: AddProviderCategoryDto,
  ): Promise<ProviderCategoryResponseDto> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);

    const category = await this.categoryRepo.findById(dto.serviceCategoryId);
    if (!category || !category.isActive) {
      throw new NotFoundException('Service category not found');
    }

    const conflict = await this.pscRepo.existsActive(providerId, dto.serviceCategoryId);
    if (conflict) throw new ProviderCategoryConflictException();

    const status =
      category.regulationLevel === RegulationLevel.INFORMAL
        ? PscVerificationStatus.NOT_REQUIRED
        : PscVerificationStatus.PENDING;

    const psc = await this.pscRepo.create({
      serviceProviderId: providerId,
      serviceCategoryId: dto.serviceCategoryId,
      verificationStatus: status,
    });

    this.logger.log(
      `Added category ${dto.serviceCategoryId} (${status}) to provider ${providerId}`,
    );
    return ProviderCategoryResponseDto.from(psc);
  }

  async listCategories(
    currentUserId: string,
    providerId: string,
  ): Promise<ProviderCategoryResponseDto[]> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    const records = await this.pscRepo.findByProviderId(providerId);
    return records.map((r) => ProviderCategoryResponseDto.from(r));
  }

  async updateCategory(
    currentUserId: string,
    providerId: string,
    pscId: string,
    dto: UpdateProviderCategoryDto,
  ): Promise<ProviderCategoryResponseDto> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderPsc(providerId, pscId);

    const updated = await this.pscRepo.update(pscId, { isActive: dto.isActive });
    if (!updated) throw new NotFoundException('Provider category not found');
    return ProviderCategoryResponseDto.from(updated);
  }

  async deleteCategory(
    currentUserId: string,
    providerId: string,
    pscId: string,
  ): Promise<void> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderPsc(providerId, pscId);
    await this.pscRepo.softDelete(pscId);
    this.logger.log(`Soft-deleted PSC ${pscId} from provider ${providerId}`);
  }

  // ── Professional Services ────────────────────────────────────────────────

  async createService(
    currentUserId: string,
    providerId: string,
    pscId: string,
    dto: CreateProfessionalServiceDto,
  ): Promise<ProfessionalServiceResponseDto> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    const psc = await this.loadProviderPsc(providerId, pscId);

    const item = await this.itemRepo.findById(dto.serviceItemId);
    if (!item) throw new NotFoundException('Service item not found');
    if (item.approvalStatus !== ApprovalStatus.APPROVED) {
      throw new ServiceItemNotApprovedException();
    }
    if (item.serviceCategoryId !== psc.serviceCategoryId) {
      throw new ServiceItemNotInCategoryException();
    }

    const conflict = await this.psRepo.existsActive(pscId, dto.serviceItemId);
    if (conflict) throw new ProviderServiceConflictException();

    this.assertPricingConsistency(dto.pricingModel, dto.priceAmount ?? null);

    const ps = await this.psRepo.create({
      professionalServiceCategoryId: pscId,
      serviceItemId: dto.serviceItemId,
      pricingModel: dto.pricingModel,
      priceAmount: dto.priceAmount ?? null,
      priceCurrency: dto.priceCurrency ?? this.defaultCurrency,
      estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
      descriptionOverride: dto.descriptionOverride ?? null,
    });

    this.logger.log(
      `Created service ${ps.id} in PSC ${pscId} for provider ${providerId}`,
    );
    return ProfessionalServiceResponseDto.from(ps);
  }

  async listPublicServices(providerId: string): Promise<ProfessionalServiceResponseDto[]> {
    const records = await this.psRepo.findPublicByProviderId(providerId);
    return records.map((r) => ProfessionalServiceResponseDto.from(r));
  }

  async listOwnerServices(
    currentUserId: string,
    providerId: string,
  ): Promise<ProfessionalServiceResponseDto[]> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    const records = await this.psRepo.findAllByProviderId(providerId);
    return records.map((r) => ProfessionalServiceResponseDto.from(r));
  }

  async updateService(
    currentUserId: string,
    providerId: string,
    serviceId: string,
    dto: UpdateProfessionalServiceDto,
  ): Promise<ProfessionalServiceResponseDto> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    const existing = await this.loadProviderService(providerId, serviceId);

    const effectiveModel = dto.pricingModel ?? existing.pricingModel;
    const effectiveAmount =
      'priceAmount' in dto ? (dto.priceAmount ?? null) : existing.priceAmount;
    this.assertPricingConsistency(effectiveModel, effectiveAmount);

    const updated = await this.psRepo.update(serviceId, {
      pricingModel: dto.pricingModel,
      priceAmount: 'priceAmount' in dto ? (dto.priceAmount ?? null) : undefined,
      priceCurrency: dto.priceCurrency,
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      descriptionOverride: dto.descriptionOverride,
      isActive: dto.isActive,
    });
    if (!updated) throw new NotFoundException('Professional service not found');
    return ProfessionalServiceResponseDto.from(updated);
  }

  async deleteService(
    currentUserId: string,
    providerId: string,
    serviceId: string,
  ): Promise<void> {
    await this.providersService.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderService(providerId, serviceId);
    await this.psRepo.softDelete(serviceId);
    this.logger.log(
      `Soft-deleted service ${serviceId} of provider ${providerId}`,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async loadProviderPsc(providerId: string, pscId: string): Promise<PscRecord> {
    const psc = await this.pscRepo.findById(pscId);
    if (!psc || psc.serviceProviderId !== providerId) {
      throw new NotFoundException('Provider category not found');
    }
    return psc;
  }

  private async loadProviderService(
    providerId: string,
    serviceId: string,
  ): Promise<PsRecord> {
    const ps = await this.psRepo.findById(serviceId);
    if (!ps) throw new NotFoundException('Professional service not found');

    const psc = await this.pscRepo.findById(ps.professionalServiceCategoryId);
    if (!psc || psc.serviceProviderId !== providerId) {
      throw new NotFoundException('Professional service not found');
    }
    return ps;
  }

  private assertPricingConsistency(
    pricingModel: PricingModel,
    priceAmount: number | null,
  ): void {
    if (pricingModel === PricingModel.QUOTE_ONLY && priceAmount !== null) {
      throw new BadRequestException(
        'priceAmount must be absent (null) for QUOTE_ONLY pricing model',
      );
    }
    if (pricingModel !== PricingModel.QUOTE_ONLY && priceAmount === null) {
      throw new BadRequestException(
        'priceAmount is required for FLAT/HOURLY pricing model',
      );
    }
  }
}
