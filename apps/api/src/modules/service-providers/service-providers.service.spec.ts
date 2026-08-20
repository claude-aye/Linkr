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
import { ReviewsRepository } from '../reviews/repositories/reviews.repository';
import { DiscoverProvidersQueryDto } from './dto/discover-providers-query.dto';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';

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
      {} as unknown as ReviewsRepository,
    );

    const result = await service.createProvider(USER_ID, dto);

    expect(result.id).toBe(record.id);
    expect(providerRepo.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * The N+1 guard, locked by a test rather than by a comment.
 *
 * The failure this prevents is invisible on a fixture: with two providers, one
 * aggregate call per card and one for the whole page look identical in every
 * way except the call count. It only becomes visible in production, on a page
 * of fifty. So the property under test is not "the rating is right" — it is
 * "the number of aggregate reads does not depend on how many providers came
 * back".
 */
describe('ServiceProvidersService.discover — ratings', () => {
  const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';

  function providerRow(id: string) {
    return {
      id,
      providerType: ProviderType.INDIVIDUAL,
      displayName: `Provider ${id}`,
      headline: null,
      serviceRadiusKm: 25,
      distanceMeters: 100,
      categoryVerificationStatus: PscVerificationStatus.NOT_REQUIRED,
    };
  }

  function build(ids: string[], reviewsRepo: ReviewsRepository) {
    const providerRepo = {
      findEligibleForDiscovery: jest
        .fn()
        .mockResolvedValue({ items: ids.map(providerRow), total: ids.length }),
    } as unknown as ServiceProviderRepository;

    const service = new ServiceProvidersService(
      providerRepo,
      {} as unknown as ProfessionalServiceZoneRepository,
      {} as unknown as UsersRepository,
      {} as unknown as OrganizationsRepository,
      {} as unknown as OrganizationMembershipsRepository,
      reviewsRepo,
    );

    const query: DiscoverProvidersQueryDto = {
      lat: 46.81,
      lng: -71.21,
      categoryId: CATEGORY_ID,
      page: 1,
      limit: 50,
    };

    return { service, query };
  }

  it('reads the aggregate ONCE for the page, not once per provider', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const findAggregatesForProviders = jest.fn().mockResolvedValue(new Map());
    const { service, query } = build(ids, {
      findAggregatesForProviders,
    } as unknown as ReviewsRepository);

    await service.discover(query);

    expect(findAggregatesForProviders).toHaveBeenCalledTimes(1);
    // ...and it was handed the whole page as ONE set.
    expect(findAggregatesForProviders).toHaveBeenCalledWith(ids);
  });

  it('reads the aggregate the same number of times for 1 provider as for 5', async () => {
    const one = jest.fn().mockResolvedValue(new Map());
    const five = jest.fn().mockResolvedValue(new Map());

    const a = build(['a'], { findAggregatesForProviders: one } as unknown as ReviewsRepository);
    await a.service.discover(a.query);

    const b = build(['a', 'b', 'c', 'd', 'e'], {
      findAggregatesForProviders: five,
    } as unknown as ReviewsRepository);
    await b.service.discover(b.query);

    expect(one.mock.calls.length).toBe(five.mock.calls.length);
  });

  it('serves the aggregate values through to the items', async () => {
    const { service, query } = build(['a', 'b'], {
      findAggregatesForProviders: jest.fn().mockResolvedValue(
        new Map([
          // Above the threshold — the average survives.
          ['a', { reviewCount: 4, averageRating: 4.25 }],
          // Below it, the repository already gated the average to null (D-4).
          ['b', { reviewCount: 2, averageRating: null }],
        ]),
      ),
    } as unknown as ReviewsRepository);

    const result = await service.discover(query);

    expect(result.items[0]).toMatchObject({ reviewCount: 4, averageRating: 4.25 });
    expect(result.items[1]).toMatchObject({ reviewCount: 2, averageRating: null });
  });

  it('treats a provider missing from the aggregate as zero reviews, no average', async () => {
    const { service, query } = build(['a'], {
      findAggregatesForProviders: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ReviewsRepository);

    const result = await service.discover(query);

    expect(result.items[0]).toMatchObject({ reviewCount: 0, averageRating: null });
  });

  it('still serves the results when the aggregate read throws', async () => {
    // The whole point: reputation is a decoration on a result, the result is the
    // product. A broken aggregate must cost the rating line, never the search.
    const { service, query } = build(['a', 'b'], {
      findAggregatesForProviders: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ReviewsRepository);

    const result = await service.discover(query);

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.reviewCount === 0)).toBe(true);
    expect(result.items.every((item) => item.averageRating === null)).toBe(true);
  });

  it('asks nothing at all when the page is empty', async () => {
    const findAggregatesForProviders = jest.fn().mockResolvedValue(new Map());
    const { service, query } = build([], {
      findAggregatesForProviders,
    } as unknown as ReviewsRepository);

    const result = await service.discover(query);

    expect(result.items).toHaveLength(0);
    // Called once with an empty set; the repository short-circuits it without a
    // round trip, so an empty page costs no rating query.
    expect(findAggregatesForProviders).toHaveBeenCalledWith([]);
  });
});
