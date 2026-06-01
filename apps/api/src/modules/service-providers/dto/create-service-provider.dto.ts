import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsGeoJSONPoint } from '../../../common/validators/is-geojson-point.validator';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';
import { ProviderType } from '../enums/provider-type.enum';

export class CreateServiceProviderDto {
  @ApiProperty({ enum: ProviderType })
  @IsEnum(ProviderType)
  providerType!: ProviderType;

  @ApiPropertyOptional({
    description:
      'Required when providerType=ORGANIZATION; forbidden when INDIVIDUAL (user_id derives from the JWT).',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  businessName?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  headline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({
    description:
      'GeoJSON Point — coordinates are [longitude, latitude] (NOT lat,lng!).',
    example: { type: 'Point', coordinates: [-71.52, 46.85] },
  })
  @IsGeoJSONPoint()
  serviceBaseLocation!: GeoJSONPoint;

  @ApiProperty({
    description: 'Primary service radius in km; 0 = coverage by named zones only.',
    minimum: 0,
    example: 25,
  })
  @IsInt()
  @Min(0)
  serviceRadiusKm!: number;
}
