import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsGeoJSONPolygon } from '../../../common/validators/is-geojson-polygon.validator';
import { GeoJSONPolygon } from '../../../common/geojson/geojson.types';

export class UpdateServiceZoneDto {
  @ApiPropertyOptional({
    description: 'GeoJSON Polygon — coordinates are [longitude, latitude], rings closed.',
  })
  @IsOptional()
  @IsGeoJSONPolygon()
  zonePolygon?: GeoJSONPolygon;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  zoneLabel?: string;
}
