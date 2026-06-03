import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceProvider } from '../entities/service-provider.entity';
import { ProviderType } from '../enums/provider-type.enum';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

export interface DiscoveryParams {
  lat: number;
  lng: number;
  categoryId: string;
  page: number;
  limit: number;
}

export interface DiscoveredProviderRecord {
  id: string;
  providerType: ProviderType;
  displayName: string | null;
  headline: string | null;
  serviceRadiusKm: number;
  distanceMeters: number;
  categoryVerificationStatus: PscVerificationStatus;
}

interface RawDiscoveryRow {
  id: string;
  provider_type: ProviderType;
  display_name: string | null;
  headline: string | null;
  service_radius_km: number;
  distance_meters: string;
  category_verification_status: PscVerificationStatus;
}

/** Domain record with geography read back as GeoJSON (never raw WKB/WKT). */
export interface ServiceProviderRecord {
  id: string;
  providerType: ProviderType;
  userId: string | null;
  organizationId: string | null;
  businessName: string | null;
  headline: string | null;
  bio: string | null;
  serviceBaseLocation: GeoJSONPoint;
  serviceRadiusKm: number;
  isActive: boolean;
  activatedAtUtc: Date | null;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

export interface CreateProviderData {
  providerType: ProviderType;
  userId: string | null;
  organizationId: string | null;
  businessName?: string | null;
  headline?: string | null;
  bio?: string | null;
  serviceBaseLocation: GeoJSONPoint;
  serviceRadiusKm: number;
}

export interface UpdateProviderData {
  businessName?: string | null;
  headline?: string | null;
  bio?: string | null;
  serviceBaseLocation?: GeoJSONPoint;
  serviceRadiusKm?: number;
  isActive?: boolean;
  activatedAtUtc?: Date;
}

interface RawProviderRow {
  id: string;
  provider_type: ProviderType;
  user_id: string | null;
  organization_id: string | null;
  business_name: string | null;
  headline: string | null;
  bio: string | null;
  service_base_location: GeoJSONPoint;
  service_radius_km: number;
  is_active: boolean;
  activated_at_utc: Date | null;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, provider_type, user_id, organization_id, business_name, headline, bio,
  ST_AsGeoJSON(service_base_location)::json AS service_base_location,
  service_radius_km, is_active, activated_at_utc, created_at_utc, updated_at_utc
`;

@Injectable()
export class ServiceProviderRepository {
  constructor(
    @InjectRepository(ServiceProvider)
    private readonly repo: Repository<ServiceProvider>,
  ) {}

  private static map(row: RawProviderRow): ServiceProviderRecord {
    return {
      id: row.id,
      providerType: row.provider_type,
      userId: row.user_id,
      organizationId: row.organization_id,
      businessName: row.business_name,
      headline: row.headline,
      bio: row.bio,
      serviceBaseLocation: row.service_base_location,
      serviceRadiusKm: row.service_radius_km,
      isActive: row.is_active,
      activatedAtUtc: row.activated_at_utc,
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    };
  }

  async findById(id: string): Promise<ServiceProviderRecord | null> {
    const rows: RawProviderRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM service_providers
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? ServiceProviderRepository.map(rows[0]) : null;
  }

  async existsActiveByUserId(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.repo.query(
      `SELECT 1 FROM service_providers
       WHERE user_id = $1 AND deleted_at_utc IS NULL LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  async existsActiveByOrgId(organizationId: string): Promise<boolean> {
    const rows: unknown[] = await this.repo.query(
      `SELECT 1 FROM service_providers
       WHERE organization_id = $1 AND deleted_at_utc IS NULL LIMIT 1`,
      [organizationId],
    );
    return rows.length > 0;
  }

  async create(data: CreateProviderData): Promise<ServiceProviderRecord> {
    // Created providers are active immediately, with activated_at_utc stamped.
    const rows: Array<{ id: string }> = await this.repo.query(
      `INSERT INTO service_providers
        (provider_type, user_id, organization_id, business_name, headline, bio,
         service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES
        ($1, $2, $3, $4, $5, $6,
         ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)::geography, $8, true, now())
       RETURNING id`,
      [
        data.providerType,
        data.userId,
        data.organizationId,
        data.businessName ?? null,
        data.headline ?? null,
        data.bio ?? null,
        JSON.stringify(data.serviceBaseLocation),
        data.serviceRadiusKm,
      ],
    );
    const created = await this.findById(rows[0].id);
    if (!created) throw new Error('Provider insert succeeded but read-back failed');
    return created;
  }

  async update(
    id: string,
    data: UpdateProviderData,
  ): Promise<ServiceProviderRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    const add = (col: string, val: unknown): void => {
      sets.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.businessName !== undefined) add('business_name', data.businessName);
    if (data.headline !== undefined) add('headline', data.headline);
    if (data.bio !== undefined) add('bio', data.bio);
    if (data.serviceRadiusKm !== undefined) add('service_radius_km', data.serviceRadiusKm);
    if (data.isActive !== undefined) add('is_active', data.isActive);
    if (data.activatedAtUtc !== undefined) add('activated_at_utc', data.activatedAtUtc);
    if (data.serviceBaseLocation !== undefined) {
      sets.push(`service_base_location = ST_SetSRID(ST_GeomFromGeoJSON($${i++}), 4326)::geography`);
      params.push(JSON.stringify(data.serviceBaseLocation));
    }
    sets.push(`updated_at_utc = now()`);

    params.push(id);
    await this.repo.query(
      `UPDATE service_providers SET ${sets.join(', ')}
       WHERE id = $${i} AND deleted_at_utc IS NULL`,
      params,
    );
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  /**
   * Hybrid geo discovery (CLAUDE.md §5.3). Returns active providers practising
   * `categoryId` (VERIFIED | NOT_REQUIRED) whose coverage includes the client
   * point — either within `service_radius_km` (in metres) OR inside one of their
   * named zones. Sorted by base→client distance ASC.
   *
   * Spatial columns are geography(4326): ST_DWithin / ST_Distance return metres
   * directly, and zone containment uses ST_Covers (ST_Contains is geometry-only).
   *
   * `service_radius_km = 0` ⇒ ST_DWithin(..., 0) is false, so the provider is
   * retained only via a covering zone — the OR handles this naturally.
   */
  async findEligibleForDiscovery(
    params: DiscoveryParams,
  ): Promise<{ items: DiscoveredProviderRecord[]; total: number }> {
    const offset = (params.page - 1) * params.limit;

    // $1 = lng, $2 = lat, $3 = categoryId, then per-query limit/offset.
    const clientPoint = `ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography`;

    // Shared FROM + JOINs + WHERE; parameters $1..$3 reused across both queries.
    // The LEFT JOIN to organizations resolves the display_name fallback and never
    // multiplies rows (FK to a single org), so it is safe in the count query too.
    const fromWhere = `
      FROM service_providers sp
      INNER JOIN professional_service_categories psc
        ON psc.service_provider_id = sp.id
        AND psc.service_category_id = $3
        AND psc.verification_status IN ('VERIFIED', 'NOT_REQUIRED')
        AND psc.is_active = true
        AND psc.deleted_at_utc IS NULL
      LEFT JOIN organizations o ON o.id = sp.organization_id
      WHERE sp.is_active = true
        AND sp.deleted_at_utc IS NULL
        AND (
          ST_DWithin(sp.service_base_location, ${clientPoint}, sp.service_radius_km * 1000)
          OR EXISTS (
            SELECT 1 FROM professional_service_zones z
            WHERE z.service_provider_id = sp.id
              AND z.deleted_at_utc IS NULL
              AND ST_Covers(z.zone_polygon, ${clientPoint})
          )
        )
    `;

    const countRows: Array<{ count: string }> = await this.repo.query(
      `SELECT COUNT(DISTINCT sp.id) AS count ${fromWhere}`,
      [params.lng, params.lat, params.categoryId],
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const rows: RawDiscoveryRow[] = await this.repo.query(
      `SELECT
         sp.id,
         sp.provider_type,
         COALESCE(sp.business_name, o.display_name) AS display_name,
         sp.headline,
         sp.service_radius_km,
         ST_Distance(sp.service_base_location, ${clientPoint}) AS distance_meters,
         psc.verification_status AS category_verification_status
       ${fromWhere}
       ORDER BY distance_meters ASC
       LIMIT $4 OFFSET $5`,
      [params.lng, params.lat, params.categoryId, params.limit, offset],
    );

    const items = rows.map((row) => ({
      id: row.id,
      providerType: row.provider_type,
      displayName: row.display_name,
      headline: row.headline,
      serviceRadiusKm: row.service_radius_km,
      distanceMeters: Math.round(parseFloat(row.distance_meters)),
      categoryVerificationStatus: row.category_verification_status,
    }));

    return { items, total };
  }
}
