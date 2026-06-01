import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsGeoJSONPoint } from '../../../common/validators/is-geojson-point.validator';
import { GeoJSONPoint } from '../../../common/geojson/geojson.types';

/**
 * providerType, user_id and organization_id are IMMUTABLE and intentionally
 * absent here. Only the fields below are editable.
 */
export class UpdateServiceProviderDto {
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

  @ApiPropertyOptional({
    description: 'GeoJSON Point — coordinates are [longitude, latitude].',
    example: { type: 'Point', coordinates: [-71.52, 46.85] },
  })
  @IsOptional()
  @IsGeoJSONPoint()
  serviceBaseLocation?: GeoJSONPoint;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  serviceRadiusKm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
