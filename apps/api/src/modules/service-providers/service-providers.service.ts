import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UsersRepository } from '../users/users.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationMembershipsRepository } from '../organization-memberships/organization-memberships.repository';
import { OrganizationRole } from '../organization-memberships/enums/organization-role.enum';
import { VerificationLevel } from '../users/enums/verification-level.enum';
import { CreateServiceProviderDto } from './dto/create-service-provider.dto';
import { UpdateServiceProviderDto } from './dto/update-service-provider.dto';
import { ServiceProviderResponseDto } from './dto/service-provider-response.dto';
import { ProviderType } from './enums/provider-type.enum';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from './repositories/service-provider.repository';
import {
  NotProviderOwnerException,
  PhoneVerificationRequiredException,
  ProviderOwnerConflictException,
} from './exceptions/provider-exceptions';

const PRO_ALLOWED_LEVELS: ReadonlySet<VerificationLevel> = new Set([
  VerificationLevel.PHONE,
  VerificationLevel.IDENTITY,
]);

@Injectable()
export class ServiceProvidersService {
  private readonly logger = new Logger(ServiceProvidersService.name);

  constructor(
    private readonly providerRepo: ServiceProviderRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly membershipsRepository: OrganizationMembershipsRepository,
  ) {}

  async createProvider(
    currentUserId: string,
    dto: CreateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    // Onboarding gate — applies to whoever is acting, both provider types.
    const user = await this.usersRepository.findById(currentUserId);
    if (!user) throw new NotFoundException('User not found');
    if (!PRO_ALLOWED_LEVELS.has(user.verificationLevel)) {
      throw new PhoneVerificationRequiredException();
    }

    if (dto.providerType === ProviderType.INDIVIDUAL) {
      if (dto.organizationId) {
        throw new BadRequestException(
          'organizationId must not be provided for an INDIVIDUAL provider',
        );
      }
      const exists = await this.providerRepo.existsActiveByUserId(currentUserId);
      if (exists) throw new ProviderOwnerConflictException();

      const record = await this.providerRepo.create({
        providerType: ProviderType.INDIVIDUAL,
        userId: currentUserId,
        organizationId: null,
        businessName: dto.businessName,
        headline: dto.headline,
        bio: dto.bio,
        serviceBaseLocation: dto.serviceBaseLocation,
        serviceRadiusKm: dto.serviceRadiusKm,
      });
      this.logger.log(`Created INDIVIDUAL provider ${record.id} for user ${currentUserId}`);
      return this.toResponse(record);
    }

    // ORGANIZATION
    if (!dto.organizationId) {
      throw new BadRequestException(
        'organizationId is required for an ORGANIZATION provider',
      );
    }
    await this.assertActiveOwner(dto.organizationId, currentUserId);

    const exists = await this.providerRepo.existsActiveByOrgId(dto.organizationId);
    if (exists) throw new ProviderOwnerConflictException();

    const record = await this.providerRepo.create({
      providerType: ProviderType.ORGANIZATION,
      userId: null,
      organizationId: dto.organizationId,
      businessName: dto.businessName,
      headline: dto.headline,
      bio: dto.bio,
      serviceBaseLocation: dto.serviceBaseLocation,
      serviceRadiusKm: dto.serviceRadiusKm,
    });
    this.logger.log(
      `Created ORGANIZATION provider ${record.id} for org ${dto.organizationId}`,
    );
    return this.toResponse(record);
  }

  async getPublicById(id: string): Promise<ServiceProviderResponseDto> {
    const record = await this.providerRepo.findById(id);
    if (!record) throw new NotFoundException('Service provider not found');
    return this.toResponse(record);
  }

  async updateProvider(
    currentUserId: string,
    id: string,
    dto: UpdateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    const record = await this.loadOwnedProvider(currentUserId, id);

    const updated = await this.providerRepo.update(id, {
      businessName: dto.businessName,
      headline: dto.headline,
      bio: dto.bio,
      serviceBaseLocation: dto.serviceBaseLocation,
      serviceRadiusKm: dto.serviceRadiusKm,
      isActive: dto.isActive,
      // Stamp activation only on first activation (never overwrite once set).
      activatedAtUtc: record.activatedAtUtc === null ? new Date() : undefined,
    });
    if (!updated) throw new NotFoundException('Service provider not found');
    return this.toResponse(updated);
  }

  async deleteProvider(currentUserId: string, id: string): Promise<void> {
    await this.loadOwnedProvider(currentUserId, id);
    await this.providerRepo.softDelete(id);
    this.logger.log(`Soft-deleted provider ${id} by user ${currentUserId}`);
  }

  /**
   * Loads a provider and asserts the current user may manage it. Shared by
   * provider mutations and (in 3.7b+) by zone CRUD. Throws 404 if missing,
   * NotProviderOwnerException (403) if the user is not the owner.
   */
  async loadOwnedProvider(
    currentUserId: string,
    providerId: string,
  ): Promise<ServiceProviderRecord> {
    const record = await this.providerRepo.findById(providerId);
    if (!record) throw new NotFoundException('Service provider not found');
    await this.assertCanManageProvider(currentUserId, record);
    return record;
  }

  private async assertCanManageProvider(
    currentUserId: string,
    record: ServiceProviderRecord,
  ): Promise<void> {
    if (record.providerType === ProviderType.INDIVIDUAL) {
      if (record.userId !== currentUserId) throw new NotProviderOwnerException();
      return;
    }
    // ORGANIZATION — must be an active OWNER.
    if (!record.organizationId) throw new NotProviderOwnerException();
    await this.assertActiveOwner(record.organizationId, currentUserId);
  }

  private async assertActiveOwner(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.membershipsRepository.findActiveByOrgAndUser(
      organizationId,
      userId,
    );
    if (!membership || membership.role !== OrganizationRole.OWNER) {
      throw new NotProviderOwnerException();
    }
  }

  // Resolve business_name fallback to organization.display_name at read time.
  private async toResponse(
    record: ServiceProviderRecord,
  ): Promise<ServiceProviderResponseDto> {
    let businessName = record.businessName;
    if (
      !businessName &&
      record.providerType === ProviderType.ORGANIZATION &&
      record.organizationId
    ) {
      const org = await this.organizationsRepository.findById(record.organizationId);
      businessName = org?.displayName ?? null;
    }
    return ServiceProviderResponseDto.from(record, businessName);
  }
}
