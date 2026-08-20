import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType } from '../enums/provider-type.enum';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

/**
 * A single discovered provider. Exact coordinates are never exposed — the
 * client only needs `distanceMeters` (base→client, in metres).
 */
export class DiscoveredProviderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ProviderType })
  providerType!: ProviderType;

  @ApiPropertyOptional({
    description: 'Public name: business_name, falling back to organization.display_name.',
    nullable: true,
  })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  headline!: string | null;

  @ApiProperty({ description: 'Primary service radius in km (0 = zone-only coverage).' })
  serviceRadiusKm!: number;

  @ApiProperty({ description: 'Distance from the provider base to the client, in metres (rounded).' })
  distanceMeters!: number;

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
