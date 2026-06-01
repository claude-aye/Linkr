import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsGeoJSONPolygon } from '../../../common/validators/is-geojson-polygon.validator';
import { GeoJSONPolygon } from '../../../common/geojson/geojson.types';

export class CreateServiceZoneDto {
  @ApiProperty({
    description:
      'GeoJSON Polygon — rings of [longitude, latitude] positions, first === last (closed). NOT lat,lng!',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [-71.56, 46.88],
          [-71.48, 46.88],
          [-71.48, 46.83],
          [-71.56, 46.83],
          [-71.56, 46.88],
        ],
      ],
    },
  })
  @IsGeoJSONPolygon()
  zonePolygon!: GeoJSONPolygon;

  @ApiProperty({ maxLength: 120, example: 'Val-Bélair' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  zoneLabel!: string;
}
