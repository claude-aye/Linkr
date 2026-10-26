import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../enums/provider-type.enum';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

/**
 * Centre of the fixed grid cell (0.005° lat × 0.0073° lng, ≈ 555 m) holding the
 * provider's base. A map pin, never an address.
 */
export class ApproximateLocationDto {
  @ApiProperty({ type: 'number', format: 'double', example: 46.7775 })
  lat!: number;

  @ApiProperty({ type: 'number', format: 'double', example: -71.27355 })
  lng!: number;
}

/**
 * A single discovered provider.
 *
 * ⚠️ NOTHING HERE IS COMPUTED FROM THE EXACT BASE (CLAUDE.md §13.1, entry 22).
 * Presence, distance and order all come from the centre of the provider's grid
 * cell, which `approximateLocation` shows; an answer computed from the base —
 * three distances, a distance step, the edge of the radius — would locate it.
 * Do not add a field that is finer than the cell.
 */
export class DiscoveredProviderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ProviderType })
  providerType!: ProviderType;

  @ApiProperty({
    type: String,
    description: 'Public name: business_name, falling back to organization.display_name.',
    nullable: true,
  })
  displayName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  headline!: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'Primary service radius in km (0 = zone-only coverage).',
  })
  serviceRadiusKm!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 100,
    description:
      'Coarsened distance from the centre of the provider\'s grid cell (not the base) to the search point, in metres: 100 m steps under 1 km, 500 m steps from 1 km, never below 100.',
    example: 1500,
  })
  distanceMeters!: number;

  @ApiProperty({
    type: ApproximateLocationDto,
    nullable: true,
    description:
      'Centre of the grid cell holding the provider base (≈ 555 m cell), or null when the provider has no base point.',
  })
  approximateLocation!: ApproximateLocationDto | null;

  @ApiProperty({
    enum: PscVerificationStatus,
    description: 'VERIFIED (Hard Trust) | NOT_REQUIRED (Social Trust) for the requested category.',
  })
  categoryVerificationStatus!: PscVerificationStatus;

  /**
   * Live reviews for this provider — the whole set, not a page.
   *
   * Soft-deleted reviews are excluded inside the aggregate itself (D-3), so a
   * retracted review stops counting here the moment it is retracted.
   *
   * Zero when the provider has never been reviewed — AND zero when the rating
   * read failed, because discovery deliberately survives a broken aggregate
   * (see `ServiceProvidersService.discover`). Both cases render the same way:
   * nothing at all. Saying nothing about reputation is honest in either case;
   * the card never claims « 0 avis ».
   */
  @ApiProperty({
    description:
      'Live review count for this provider (soft-deleted reviews excluded). 0 when never reviewed, and also 0 if the rating read failed — discovery survives a broken aggregate.',
    type: 'integer',
    example: 4,
  })
  reviewCount!: number;

  /**
   * ⚠️ NULL BELOW THREE REVIEWS, AND THE GATE IS THE DATA'S, NOT THE DISPLAY'S
   * (D-4). Gated in SQL by the very same fragment the provider profile uses, so
   * a RESULT CARD CAN NEVER SHOW AN AVERAGE THE PROFILE REFUSES TO SHOW. That
   * agreement is the point: two surfaces reading one rule, rather than two
   * surfaces each remembering it.
   *
   * ⚠️ IT IS DISPLAYED, NEVER SORTED ON. Discovery is ordered by proximity and
   * only by proximity — the brief settles this. Ranking by reputation would
   * contradict the absolute proximity filter the spec is built on, and it would
   * compound: whoever has reviews is seen, therefore booked, therefore
   * accumulates reviews, which condemns every freshly recruited tradesperson to
   * invisibility. There is no sort parameter and none is being prepared.
   */
  @ApiProperty({
    description:
      'Mean rating rounded to 2 decimals, or null below 3 live reviews (D-4). Gated server-side — the front never hides it, and never sorts on it.',
    type: 'number',
    format: 'float',
    nullable: true,
    example: 4.67,
  })
  averageRating!: number | null;
}
