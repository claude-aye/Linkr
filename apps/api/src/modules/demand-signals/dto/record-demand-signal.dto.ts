import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsUUID } from 'class-validator';

/**
 * Body of `POST /demand-signals`.
 *
 * ⚠️ `lat` / `lng` ARE THE EXACT SEARCHED POINT, AND THEY ARE NEVER STORED. They
 * arrive exact because the server has to re-run the eligibility predicate at the
 * very point that returned zero — verifying at a rounded point could answer a
 * different question, up to a kilometre away. They are used for that check, then
 * rounded to a sector (`toSector`) and discarded. This is not a new exposure:
 * `GET /service-providers/discover` already receives the same coordinate on the
 * same request path.
 *
 * ⚠️ THERE IS NO CALLER FIELD, AND THERE MUST NEVER BE ONE. The route is
 * JWT-guarded (every searcher is authenticated — `/recherche` is private) but the
 * controller never reads `@CurrentUser()`: the identity gates the route and is
 * then dropped on the floor. Adding a caller id here would turn an anonymous
 * measurement into personal information and pull a retention policy in behind it.
 */
export class RecordDemandSignalDto {
  @ApiProperty({
    description: 'Service category (Métier) that was searched for.',
    format: 'uuid',
  })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({
    description:
      'Latitude of the search that returned zero, -90..90. Used to re-verify the claim, then rounded to a coarse sector. NEVER stored as sent.',
    example: 45.5017,
  })
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @ApiProperty({
    description:
      'Longitude of the search that returned zero, -180..180. Used to re-verify the claim, then rounded to a coarse sector. NEVER stored as sent.',
    example: -73.5673,
  })
  @IsNumber()
  @IsLongitude()
  lng!: number;
}
