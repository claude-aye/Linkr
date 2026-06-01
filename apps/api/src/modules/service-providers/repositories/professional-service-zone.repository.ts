import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeoJSONPolygon } from '../../../common/geojson/geojson.types';
import { ProfessionalServiceZone } from '../entities/professional-service-zone.entity';

export interface ServiceZoneRecord {
  id: string;
  serviceProviderId: string;
  zonePolygon: GeoJSONPolygon;
  zoneLabel: string;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

interface RawZoneRow {
  id: string;
  service_provider_id: string;
  zone_polygon: GeoJSONPolygon;
  zone_label: string;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, service_provider_id,
  ST_AsGeoJSON(zone_polygon)::json AS zone_polygon,
  zone_label, created_at_utc, updated_at_utc
`;

@Injectable()
export class ProfessionalServiceZoneRepository {
  constructor(
    @InjectRepository(ProfessionalServiceZone)
    private readonly repo: Repository<ProfessionalServiceZone>,
  ) {}

  private static map(row: RawZoneRow): ServiceZoneRecord {
    return {
      id: row.id,
      serviceProviderId: row.service_provider_id,
      zonePolygon: row.zone_polygon,
      zoneLabel: row.zone_label,
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    };
  }

  /** DB-side geometric validity (catches self-intersections etc.). */
  async isPolygonValid(polygon: GeoJSONPolygon): Promise<boolean> {
    const rows: Array<{ valid: boolean }> = await this.repo.query(
      `SELECT ST_IsValid(ST_GeomFromGeoJSON($1)) AS valid`,
      [JSON.stringify(polygon)],
    );
    return rows.length > 0 && rows[0].valid === true;
  }

  async findById(id: string): Promise<ServiceZoneRecord | null> {
    const rows: RawZoneRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM professional_service_zones
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? ProfessionalServiceZoneRepository.map(rows[0]) : null;
  }

  async findByProviderId(serviceProviderId: string): Promise<ServiceZoneRecord[]> {
    const rows: RawZoneRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM professional_service_zones
       WHERE service_provider_id = $1 AND deleted_at_utc IS NULL
       ORDER BY created_at_utc ASC`,
      [serviceProviderId],
    );
    return rows.map((r) => ProfessionalServiceZoneRepository.map(r));
  }

  async create(
    serviceProviderId: string,
    zonePolygon: GeoJSONPolygon,
    zoneLabel: string,
  ): Promise<ServiceZoneRecord> {
    const rows: Array<{ id: string }> = await this.repo.query(
      `INSERT INTO professional_service_zones
        (service_provider_id, zone_polygon, zone_label)
       VALUES
        ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography, $3)
       RETURNING id`,
      [serviceProviderId, JSON.stringify(zonePolygon), zoneLabel],
    );
    const created = await this.findById(rows[0].id);
    if (!created) throw new Error('Zone insert succeeded but read-back failed');
    return created;
  }

  async update(
    id: string,
    data: { zonePolygon?: GeoJSONPolygon; zoneLabel?: string },
  ): Promise<ServiceZoneRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (data.zoneLabel !== undefined) {
      sets.push(`zone_label = $${i++}`);
      params.push(data.zoneLabel);
    }
    if (data.zonePolygon !== undefined) {
      sets.push(`zone_polygon = ST_SetSRID(ST_GeomFromGeoJSON($${i++}), 4326)::geography`);
      params.push(JSON.stringify(data.zonePolygon));
    }
    sets.push(`updated_at_utc = now()`);

    params.push(id);
    await this.repo.query(
      `UPDATE professional_service_zones SET ${sets.join(', ')}
       WHERE id = $${i} AND deleted_at_utc IS NULL`,
      params,
    );
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
