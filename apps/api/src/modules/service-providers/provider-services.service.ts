import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RegulationLevel } from '../services-catalog/enums/regulation-level.enum';
import { ServiceCategoryRepository } from '../services-catalog/repositories/service-category.repository';
import { ServiceProvidersService } from './service-providers.service';
import {
  ProfessionalServiceCategoryRepository,
  PscRecord,
} from './repositories/professional-service-category.repository';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';
import { AddProviderCategoryDto } from './dto/add-provider-category.dto';
import { UpdateProviderCategoryDto } from './dto/update-provider-category.dto';
import { ProviderCategoryResponseDto } from './dto/provider-category-response.dto';
import { ProviderCategoryConflictException } from './exceptions/provider-exceptions';

@Injectable()
export class ProviderServicesService {
  private readonly logger = new Logger(ProviderServicesService.name);

  constructor(
    private readonly providersService: ServiceProvidersService,
    private readonly pscRepo: ProfessionalServiceCategoryRepository,
    private readonly categoryRepo: ServiceCategoryRepository,
  ) {}

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

  // ── Helpers ──────────────────────────────────────────────────────────────

  async loadProviderPsc(providerId: string, pscId: string): Promise<PscRecord> {
    const psc = await this.pscRepo.findById(pscId);
    if (!psc || psc.serviceProviderId !== providerId) {
      throw new NotFoundException('Provider category not found');
    }
    return psc;
  }
}
