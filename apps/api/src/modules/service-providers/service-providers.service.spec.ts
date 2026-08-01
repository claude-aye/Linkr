import { ServiceProvidersService } from './service-providers.service';
import { CreateServiceProviderDto } from './dto/create-service-provider.dto';
import { ProviderType } from './enums/provider-type.enum';
import { VerificationLevel } from '../users/enums/verification-level.enum';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from './repositories/service-provider.repository';
import { ProfessionalServiceZoneRepository } from './repositories/professional-service-zone.repository';
import { UsersRepository } from '../users/users.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationMembershipsRepository } from '../organization-memberships/organization-memberships.repository';

/**
 * Pro-mode onboarding is NOT gated on `users.verification_level`. That column is
 * declarative only — nothing ever writes it, so it sits at NONE for every user.
 * A guard on it would make POST /service-providers unreachable for everyone.
 */
describe('ServiceProvidersService.createProvider — no verification-level gate', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';

  const record: ServiceProviderRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    providerType: ProviderType.INDIVIDUAL,
    userId: USER_ID,
    organizationId: null,
    businessName: 'Plomberie Test',
    headline: null,
    bio: null,
    serviceBaseLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceRadiusKm: 25,
    isActive: true,
    activatedAtUtc: new Date(),
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };

  const dto: CreateServiceProviderDto = {
    providerType: ProviderType.INDIVIDUAL,
    businessName: 'Plomberie Test',
    serviceBaseLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    serviceRadiusKm: 25,
  };

  it('lets a user at verification level NONE create an INDIVIDUAL provider', async () => {
    const providerRepo = {
      existsActiveByUserId: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue(record),
    } as unknown as ServiceProviderRepository;

    // Even when read, a NONE level must not block onboarding.
    const usersRepository = {
      findById: jest
        .fn()
        .mockResolvedValue({
          id: USER_ID,
          verificationLevel: VerificationLevel.NONE,
        }),
    } as unknown as UsersRepository;

    const service = new ServiceProvidersService(
      providerRepo,
      {} as unknown as ProfessionalServiceZoneRepository,
      usersRepository,
      {} as unknown as OrganizationsRepository,
      {} as unknown as OrganizationMembershipsRepository,
    );

    const result = await service.createProvider(USER_ID, dto);

    expect(result.id).toBe(record.id);
    expect(providerRepo.create).toHaveBeenCalledTimes(1);
  });
});
