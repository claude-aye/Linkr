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
  BASE_LAT_FROM_PROVIDER,
  BASE_LNG_FROM_PROVIDER,
  CELL_DISTANCE_FROM_SUBQUERY,
  gridCentreSql,
  PROVIDER_CELL_CENTRE_SQL,
  roundedDistanceSql,
} from './repositories/discovery-privacy.sql';
import { ServiceProvidersService } from './service-providers.service';

/**
 * Privacy of provider locations in `discover` (CLAUDE.md §13.1, entry 22).
 *
 * The rounding and the grid are SQL — the ORDER BY needs them — so their
 * arithmetic (tiers, floor, cell centres, negative longitudes) is evaluated
 * against Postgres by `src/database/probes/discovery-privacy.probe.ts`; no mock
 * can prove a `ROUND` or a `FLOOR`. What THIS file pins is everything around
 * them that TypeScript decides: that the exact base is read only through the
 * cell-centre expression, what is sorted on, what the record carries, and that
 * a missing base renders as `null` instead of throwing.
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

/**
 * Every query discovery runs — the count, the rows, and the id-only reading the
 * tender fan-out and the demand-signal check share.
 */
async function discoveryQueries(): Promise<string[]> {
  const { repo, query } = repoReturning([rawRow()]);
  await repo.findEligibleForDiscovery(PARAMS);
  query.mockResolvedValueOnce([]);
  await repo.findEligibleProviderIds(PARAMS.lng, PARAMS.lat, PARAMS.categoryId);
  return query.mock.calls.map((call) => call[0] as string);
}

describe('discover — nothing is ever computed from the exact base', () => {
  /**
   * ⚠️ THE NON-REGRESSION GUARD. `service_base_location` may appear in a
   * discovery query ONLY inside the one cell-centre expression. A radius, a
   * distance, a sort or a pin read from the base itself would locate it (three
   * distances, the edge of a distance step, the edge of the radius). Remove
   * every occurrence of the cell expression and nothing of the base may remain.
   */
  it('reads service_base_location only through PROVIDER_CELL_CENTRE_SQL', async () => {
    expect(PROVIDER_CELL_CENTRE_SQL).toContain('sp.service_base_location');
    const queries = await discoveryQueries();
    expect(queries).toHaveLength(3);
    for (const sql of queries) {
      expect(sql).toContain(PROVIDER_CELL_CENTRE_SQL);
      expect(sql.split(PROVIDER_CELL_CENTRE_SQL).join('')).not.toMatch(/service_base_location/);
    }
  });

  it('draws the service radius around the cell centre', async () => {
    for (const sql of await discoveryQueries()) {
      expect(sql).toContain(`ST_DWithin(${PROVIDER_CELL_CENTRE_SQL}, `);
    }
  });

  it('keeps zones on their exact polygon (open debt, §6)', async () => {
    for (const sql of await discoveryQueries()) {
      expect(sql).toMatch(/ST_Covers\(z\.zone_polygon, /);
    }
  });

  it('measures the distance from the cell centre, and rounds it in the outer SELECT', async () => {
    const { repo, query } = repoReturning([rawRow()]);
    await repo.findEligibleForDiscovery(PARAMS);
    const sql = query.mock.calls[1][0] as string;
    expect(sql).toContain(`ST_Distance(${PROVIDER_CELL_CENTRE_SQL}, `);
    const outer = outerSelect(sql);
    expect(outer).toContain(roundedDistanceSql(CELL_DISTANCE_FROM_SUBQUERY));
    expect(outer).toContain('ST_Y(e.cell_centre::geometry) AS approximate_lat');
    expect(outer).toContain('ST_X(e.cell_centre::geometry) AS approximate_lng');
  });

  it('sorts on the ROUNDED distance, then the id', async () => {
    const { repo, query } = repoReturning([rawRow()]);
    await repo.findEligibleForDiscovery(PARAMS);
    const sql = query.mock.calls[1][0] as string;

    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'), sql.indexOf('LIMIT'));
    expect(orderBy).toMatch(/ORDER BY distance_meters ASC, e\.id ASC/);
    expect(orderBy).not.toMatch(/cell_distance_m|ST_Distance/);
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
    const sql = roundedDistanceSql(CELL_DISTANCE_FROM_SUBQUERY);
    expect(DISCOVERY_DISTANCE_FLOOR_M).toBe(100);
    expect(sql).toMatch(/GREATEST\(\s*100,/);
    expect(sql).toMatch(/< 1000/);
    expect(sql).toMatch(/::numeric \/ 100\) \* 100/);
    expect(sql).toMatch(/::numeric \/ 500\) \* 500/);
  });

  it('uses the 0.005° × 0.0073° grid and returns the cell CENTRE (+ 0.5)', () => {
    expect(DISCOVERY_GRID_LAT_DEG).toBe('0.005');
    expect(DISCOVERY_GRID_LNG_DEG).toBe('0.0073');
    const { lat, lng } = gridCentreSql(BASE_LAT_FROM_PROVIDER, BASE_LNG_FROM_PROVIDER);
    expect(lat).toMatch(/FLOOR\(\(ST_Y\(sp\.service_base_location::geometry\)\)::numeric \/ 0\.005\) \+ 0\.5\) \* 0\.005/);
    expect(lng).toMatch(/FLOOR\(\(ST_X\(sp\.service_base_location::geometry\)\)::numeric \/ 0\.0073\) \+ 0\.5\) \* 0\.0073/);
    expect(PROVIDER_CELL_CENTRE_SQL).toBe(`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`);
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
