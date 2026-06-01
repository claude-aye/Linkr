import { ApiProperty } from '@nestjs/swagger';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ProviderType } from '../enums/provider-type.enum';
import { ServiceProviderRecord } from '../repositories/service-provider.repository';

export class ServiceProviderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ProviderType })
  providerType!: ProviderType;

  @ApiProperty({ nullable: true })
  userId!: string | null;

  @ApiProperty({ nullable: true })
  organizationId!: string | null;

  @ApiProperty({
    description:
      'Resolved business name (falls back to organization.display_name for ORGANIZATION providers).',
    nullable: true,
  })
  businessName!: string | null;

  @ApiProperty({ nullable: true })
  headline!: string | null;

  @ApiProperty({ nullable: true })
  bio!: string | null;

  @ApiProperty({
    description: 'GeoJSON Point — coordinates are [longitude, latitude].',
    example: { type: 'Point', coordinates: [-71.52, 46.85] },
  })
  serviceBaseLocation!: GeoJSONPoint;

  @ApiProperty()
  serviceRadiusKm!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ nullable: true })
  activatedAtUtc!: Date | null;

  @ApiProperty()
  createdAtUtc!: Date;

  @ApiProperty()
  updatedAtUtc!: Date;

  static from(
    record: ServiceProviderRecord,
    resolvedBusinessName: string | null,
  ): ServiceProviderResponseDto {
    const dto = new ServiceProviderResponseDto();
    dto.id = record.id;
    dto.providerType = record.providerType;
    dto.userId = record.userId;
    dto.organizationId = record.organizationId;
    dto.businessName = resolvedBusinessName;
    dto.headline = record.headline;
    dto.bio = record.bio;
    dto.serviceBaseLocation = record.serviceBaseLocation;
    dto.serviceRadiusKm = record.serviceRadiusKm;
    dto.isActive = record.isActive;
    dto.activatedAtUtc = record.activatedAtUtc;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
