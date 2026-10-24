import { Repository } from 'typeorm';
import { ReviewsRepository } from '../reviews/repositories/reviews.repository';
import { OrganizationMembershipsRepository } from '../organization-memberships/organization-memberships.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { ServiceProvider } from './entities/service-provider.entity';
import { ProviderType } from './enums/provider-type.enum';
import { PscVerificationStatus } from './enums/psc-verification-status.enum';
import { ProfessionalServiceZoneRepository } from './repositories/professional-service-zone.repository';
import {
  RawDiscoveryRow,
  ServiceProviderRepository,
  toApproximateLocation,
} from './repositories/service-provider.repository';
import {
  DISCOVERY_DISTANCE_FLOOR_M,
  DISCOVERY_GRID_LAT_DEG,
  DISCOVERY_GRID_LNG_DEG,
  EXACT_DISTANCE_FROM_SUBQUERY,
  gridCentreSql,
  roundedDistanceSql,
  BASE_LAT_FROM_SUBQUERY,
  BASE_LNG_FROM_SUBQUERY,
} from './repositories/discovery-privacy.sql';
import { ServiceProvidersService } from './service-providers.service';

/**
 * Privacy of provider locations in `discover` (CLAUDE.md §13.1, entry 22).
 *
 * The rounding and the grid are SQL — the ORDER BY needs them — so their
 * arithmetic (tiers, floor, cell centres, negative longitudes) is evaluated
 * against Postgres by `src/database/probes/discovery-privacy.probe.ts`; no mock
 * can prove a `ROUND` or a `FLOOR`. What THIS file pins is everything around
 * them that TypeScript decides: that the exact values stay inside the
 * subquery, what is sorted on, what the record carries, and that a missing base
 * renders as `null` instead of throwing.
 */

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';

function rawRow(overrides: Partial<RawDiscoveryRow> = {}): RawDiscoveryRow {
  return {
    id: ID_A,
    provider_type: ProviderType.INDIVIDUAL,
    display_name: 'Dana White',
    headline: null,
    service_radius_km: 25,
    distance_meters: 1500,
    approximate_lat: 46.7775,
    approximate_lng: -71.27355,
    category_verification_status: PscVerificationStatus.NOT_REQUIRED,
    ...overrides,
  };
}

function repoReturning(rows: RawDiscoveryRow[], total = rows.length) {
  const query = jest
    .fn()
    .mockResolvedValueOnce([{ count: String(total) }])
    .mockResolvedValueOnce(rows);
  const repo = new ServiceProviderRepository({
    query,
  } as unknown as Repository<ServiceProvider>);
  return { repo, query };
}

const PARAMS = { lat: 46.81, lng: -71.21, categoryId: CATEGORY_ID, page: 1, limit: 20 };

/** The outermost SELECT list: what can leave the query at all. */
function outerSelect(sql: string): string {
  return sql.slice(0, sql.indexOf('FROM ('));
}

describe('discover — the exact location never leaves the query', () => {
  it('computes the exact distance and base only inside the subquery', async () => {
    const { repo, query } = repoReturning([rawRow()]);
    await repo.findEligibleForDiscovery(PARAMS);
    const sql = query.mock.calls[1][0] as string;

    const outer = outerSelect(sql);
    expect(outer).toContain(roundedDistanceSql(EXACT_DISTANCE_FROM_SUBQUERY));
    // The exact columns are only ever read through the coarsening fragments.
    const stripped = outer
      .replace(roundedDistanceSql(EXACT_DISTANCE_FROM_SUBQUERY), '')
      .replace(gridCentreSql(BASE_LAT_FROM_SUBQUERY, BASE_LNG_FROM_SUBQUERY).lat, '')
      .replace(gridCentreSql(BASE_LAT_FROM_SUBQUERY, BASE_LNG_FROM_SUBQUERY).lng, '');
    expect(stripped).not.toMatch(/exact_distance_m|base_lat|base_lng|ST_Distance|ST_X|ST_Y/);
  });

  it('sorts on the ROUNDED distance, then the id — never on the exact one', async () => {
    const { repo, query } = repoReturning([rawRow()]);
    await repo.findEligibleForDiscovery(PARAMS);
    const sql = query.mock.calls[1][0] as string;

    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'), sql.indexOf('LIMIT'));
    expect(orderBy).toMatch(/ORDER BY distance_meters ASC, e\.id ASC/);
    expect(orderBy).not.toMatch(/exact_distance_m|ST_Distance/);
  });

  it('carries the coarsened values through unchanged', async () => {
    const { repo } = repoReturning([rawRow()]);
    const { items } = await repo.findEligibleForDiscovery(PARAMS);
    expect(items[0].distanceMeters).toBe(1500);
    expect(items[0].approximateLocation).toEqual({ lat: 46.7775, lng: -71.27355 });
  });

  it('keeps the SQL order when two providers share a tier (no re-sort in TS)', async () => {
    const { repo } = repoReturning([
      rawRow({ id: ID_A, distance_meters: 500 }),
      rawRow({ id: ID_B, distance_meters: 500 }),
    ]);
    const { items } = await repo.findEligibleForDiscovery(PARAMS);
    expect(items.map((i) => i.id)).toEqual([ID_A, ID_B]);
  });

  it('renders a provider without a base point as `null`, without throwing', async () => {
    const { repo } = repoReturning([rawRow({ approximate_lat: null, approximate_lng: null })]);
    const { items } = await repo.findEligibleForDiscovery(PARAMS);
    expect(items[0].approximateLocation).toBeNull();
  });
});

describe('toApproximateLocation', () => {
  it('is null when either half is missing', () => {
    expect(toApproximateLocation({ approximate_lat: null, approximate_lng: -71.2 })).toBeNull();
    expect(toApproximateLocation({ approximate_lat: 46.8, approximate_lng: null })).toBeNull();
  });

  it('keeps negative longitudes', () => {
    expect(
      toApproximateLocation({ approximate_lat: 45.5025, approximate_lng: -73.56525 }),
    ).toEqual({ lat: 45.5025, lng: -73.56525 });
  });
});

describe('discovery-privacy.sql — the rule is the one the brief locked', () => {
  it('floors at 100 m and steps 100 m / 500 m around 1 km', () => {
    const sql = roundedDistanceSql(EXACT_DISTANCE_FROM_SUBQUERY);
    expect(DISCOVERY_DISTANCE_FLOOR_M).toBe(100);
    expect(sql).toMatch(/GREATEST\(\s*100,/);
    expect(sql).toMatch(/< 1000/);
    expect(sql).toMatch(/::numeric \/ 100\) \* 100/);
    expect(sql).toMatch(/::numeric \/ 500\) \* 500/);
  });

  it('uses the 0.005° × 0.0073° grid and returns the cell CENTRE (+ 0.5)', () => {
    expect(DISCOVERY_GRID_LAT_DEG).toBe('0.005');
    expect(DISCOVERY_GRID_LNG_DEG).toBe('0.0073');
    const { lat, lng } = gridCentreSql(BASE_LAT_FROM_SUBQUERY, BASE_LNG_FROM_SUBQUERY);
    expect(lat).toMatch(/FLOOR\(\(e\.base_lat\)::numeric \/ 0\.005\) \+ 0\.5\) \* 0\.005/);
    expect(lng).toMatch(/FLOOR\(\(e\.base_lng\)::numeric \/ 0\.0073\) \+ 0\.5\) \* 0\.0073/);
  });
});

/**
 * Non-regression: the discover DTO carries nothing finer than the coarsened
 * distance and the grid cell. A field added to the record must be a decision,
 * not something that rides along.
 */
describe('discover — the response carries no exact location', () => {
  it('exposes exactly the allowed keys', async () => {
    const providerRepo = {
      findEligibleForDiscovery: jest.fn().mockResolvedValue({
        items: [
          {
            id: ID_A,
            providerType: ProviderType.INDIVIDUAL,
            displayName: 'Dana White',
            headline: null,
            serviceRadiusKm: 25,
            distanceMeters: 1500,
            approximateLocation: { lat: 46.7775, lng: -71.27355 },
            categoryVerificationStatus: PscVerificationStatus.NOT_REQUIRED,
          },
        ],
        total: 1,
      }),
    } as unknown as ServiceProviderRepository;
    const reviewsRepo = {
      findAggregatesForProviders: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ReviewsRepository;

    const service = new ServiceProvidersService(
      providerRepo,
      {} as unknown as ProfessionalServiceZoneRepository,
      {} as unknown as UsersRepository,
      {} as unknown as OrganizationsRepository,
      {} as unknown as OrganizationMembershipsRepository,
      reviewsRepo,
    );

    const result = await service.discover({ ...PARAMS });
    expect(Object.keys(result).sort()).toEqual(['items', 'limit', 'page', 'total']);
    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        'approximateLocation',
        'averageRating',
        'categoryVerificationStatus',
        'displayName',
        'distanceMeters',
        'headline',
        'id',
        'providerType',
        'reviewCount',
        'serviceRadiusKm',
      ].sort(),
    );
    expect(Object.keys(result.items[0].approximateLocation ?? {}).sort()).toEqual(['lat', 'lng']);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/serviceBaseLocation|coordinates|exact/i);
  });
});
