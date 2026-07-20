import { ApiProperty } from '@nestjs/swagger';

/**
 * One geocoding candidate. `lat`/`lng` are WGS84 decimal degrees — the exact
 * shape `GET /service-providers/discover` consumes (`?lat=&lng=`), so a
 * candidate feeds discovery without any transformation.
 */
export class GeocodeCandidateDto {
  @ApiProperty({
    description: 'Human-readable address label (fr-CA).',
    example: 'Laval, Laval, Québec, Canada',
  })
  label!: string;

  @ApiProperty({
    description: 'Latitude in WGS84 decimal degrees.',
    example: 45.6066,
  })
  lat!: number;

  @ApiProperty({
    description: 'Longitude in WGS84 decimal degrees.',
    example: -73.7124,
  })
  lng!: number;
}
