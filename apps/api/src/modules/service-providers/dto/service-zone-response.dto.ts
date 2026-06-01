import { ApiProperty } from '@nestjs/swagger';
import { GeoJSONPolygon } from '../../../common/geojson/geojson.types';
import { ServiceZoneRecord } from '../repositories/professional-service-zone.repository';

export class ServiceZoneResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  serviceProviderId!: string;

  @ApiProperty({
    description: 'GeoJSON Polygon — coordinates are [longitude, latitude].',
  })
  zonePolygon!: GeoJSONPolygon;

  @ApiProperty()
  zoneLabel!: string;

  @ApiProperty()
  createdAtUtc!: Date;

  @ApiProperty()
  updatedAtUtc!: Date;

  static from(record: ServiceZoneRecord): ServiceZoneResponseDto {
    const dto = new ServiceZoneResponseDto();
    dto.id = record.id;
    dto.serviceProviderId = record.serviceProviderId;
    dto.zonePolygon = record.zonePolygon;
    dto.zoneLabel = record.zoneLabel;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
