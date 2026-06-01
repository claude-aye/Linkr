import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ServiceProvider } from '../entities/service-provider.entity';
import { ProviderType } from '../enums/provider-type.enum';

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
}
