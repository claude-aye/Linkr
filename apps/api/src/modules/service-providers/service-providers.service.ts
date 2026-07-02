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
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';
import { ServiceZoneResponseDto } from './dto/service-zone-response.dto';
import { DiscoverProvidersQueryDto } from './dto/discover-providers-query.dto';
import { DiscoveredProviderDto } from './dto/discovered-provider.dto';
import { ProviderType } from './enums/provider-type.enum';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from './repositories/service-provider.repository';
import {
  ServiceZoneRecord,
  ProfessionalServiceZoneRepository,
} from './repositories/professional-service-zone.repository';
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
    private readonly zoneRepo: ProfessionalServiceZoneRepository,
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

  /**
   * Resolve the caller's own provider identity from their JWT `sub` — the
   * `GET /service-providers/me` backing. Same contract as getPublicById (same
   * DTO/mapper, same 404 path), but keyed on user_id instead of an :id, so it
   * is owner-safe by construction (no cross-user leak possible).
   *
   * Includes paused providers: findByUserId does NOT filter on is_active, so a
   * Pro on vacation (is_active = false) still resolves — opposite semantics to
   * discovery. 404 if the user never activated Pro mode.
   */
  async getMine(currentUserId: string): Promise<ServiceProviderResponseDto> {
    const record = await this.providerRepo.findByUserId(currentUserId);
    if (!record) throw new NotFoundException('Service provider not found');
    return this.toResponse(record);
  }

  /**
   * Hybrid geo discovery: active providers covering the client point for a
   * given category (radius OR named zone), sorted by distance. Same pagination
   * envelope as GET /service-requests.
   */
  async discover(query: DiscoverProvidersQueryDto): Promise<{
    items: DiscoveredProviderDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { items, total } = await this.providerRepo.findEligibleForDiscovery({
      lat: query.lat,
      lng: query.lng,
      categoryId: query.categoryId,
      page,
      limit,
    });

    this.logger.log(
      `Discovery for category ${query.categoryId} at (${query.lat}, ${query.lng}): ${total} match(es)`,
    );

    return { items, total, page, limit };
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

  /**
   * Resolves the regulatory jurisdiction (country + subdivision) of a provider:
   * from the owning user for INDIVIDUAL, from the organization for ORGANIZATION.
   * Used by the verifications domain to scope required documents.
   */
  async getProviderJurisdiction(
    providerId: string,
  ): Promise<{ countryCode: string; subdivisionCode: string }> {
    const provider = await this.providerRepo.findById(providerId);
    if (!provider) throw new NotFoundException('Service provider not found');

    if (provider.providerType === ProviderType.INDIVIDUAL && provider.userId) {
      const user = await this.usersRepository.findById(provider.userId);
      if (!user) throw new NotFoundException('Provider owner not found');
      return {
        countryCode: user.countryCode,
        subdivisionCode: user.subdivisionCode,
      };
    }

    if (provider.organizationId) {
      const org = await this.organizationsRepository.findById(
        provider.organizationId,
      );
      if (!org) throw new NotFoundException('Provider organization not found');
      return {
        countryCode: org.countryCode,
        subdivisionCode: org.subdivisionCode,
      };
    }

    throw new NotFoundException('Provider jurisdiction could not be resolved');
  }

  // ── Service zones (nested under a provider) ───────────────────────────────

  async listZones(providerId: string): Promise<ServiceZoneResponseDto[]> {
    const provider = await this.providerRepo.findById(providerId);
    if (!provider) throw new NotFoundException('Service provider not found');
    const zones = await this.zoneRepo.findByProviderId(providerId);
    return zones.map((z) => ServiceZoneResponseDto.from(z));
  }

  async createZone(
    currentUserId: string,
    providerId: string,
    dto: CreateServiceZoneDto,
  ): Promise<ServiceZoneResponseDto> {
    await this.loadOwnedProvider(currentUserId, providerId);
    await this.assertValidPolygon(dto.zonePolygon);

    const zone = await this.zoneRepo.create(
      providerId,
      dto.zonePolygon,
      dto.zoneLabel,
    );
    this.logger.log(`Created zone ${zone.id} for provider ${providerId}`);
    return ServiceZoneResponseDto.from(zone);
  }

  async updateZone(
    currentUserId: string,
    providerId: string,
    zoneId: string,
    dto: UpdateServiceZoneDto,
  ): Promise<ServiceZoneResponseDto> {
    await this.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderZone(providerId, zoneId);

    if (dto.zonePolygon !== undefined) {
      await this.assertValidPolygon(dto.zonePolygon);
    }

    const updated = await this.zoneRepo.update(zoneId, {
      zonePolygon: dto.zonePolygon,
      zoneLabel: dto.zoneLabel,
    });
    if (!updated) throw new NotFoundException('Service zone not found');
    return ServiceZoneResponseDto.from(updated);
  }

  async deleteZone(
    currentUserId: string,
    providerId: string,
    zoneId: string,
  ): Promise<void> {
    await this.loadOwnedProvider(currentUserId, providerId);
    await this.loadProviderZone(providerId, zoneId);
    await this.zoneRepo.softDelete(zoneId);
    this.logger.log(`Soft-deleted zone ${zoneId} of provider ${providerId}`);
  }

  // Ensures the zone exists and belongs to the given provider.
  private async loadProviderZone(
    providerId: string,
    zoneId: string,
  ): Promise<ServiceZoneRecord> {
    const zone = await this.zoneRepo.findById(zoneId);
    if (!zone || zone.serviceProviderId !== providerId) {
      throw new NotFoundException('Service zone not found');
    }
    return zone;
  }

  private async assertValidPolygon(polygon: CreateServiceZoneDto['zonePolygon']): Promise<void> {
    const valid = await this.zoneRepo.isPolygonValid(polygon);
    if (!valid) {
      throw new BadRequestException(
        'zonePolygon is not a geometrically valid polygon (e.g. self-intersecting)',
      );
    }
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
