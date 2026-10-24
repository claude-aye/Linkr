import { ApiProperty } from '@nestjs/swagger';
import { ServiceProviderRecord } from '../repositories/service-provider.repository';

/**
 * The public profile of a provider — `GET /service-providers/:id`, readable by
 * anyone, without a token.
 *
 * ⚠️ AN ALLOW-LIST, NOT A FILTER. Every field here was chosen because a visitor
 * needs it to decide whether to book; anything not listed does not leave the
 * API. The owner keeps the full `ServiceProviderResponseDto` (`/me`, POST,
 * PATCH). The two are separate classes on purpose: a field added to the owner
 * DTO must not reach strangers by default.
 *
 * Deliberately absent:
 * - `serviceBaseLocation` — the provider's exact base, usually their home.
 * - `serviceRadiusKm` — next to a distance it helps place the base.
 * - `userId`, `organizationId` — internal links to an account.
 * - `providerType`, `isActive` and the technical dates — nothing to show.
 *
 * `from` copies field by field. Never spread the record or the owner DTO into
 * it: a spread would silently publish the next column someone adds.
 */
export class PublicServiceProviderDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Resolved business name (falls back to organization.display_name for ORGANIZATION providers).',
  })
  businessName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  headline!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  static from(
    record: ServiceProviderRecord,
    resolvedBusinessName: string | null,
  ): PublicServiceProviderDto {
    const dto = new PublicServiceProviderDto();
    dto.id = record.id;
    dto.businessName = resolvedBusinessName;
    dto.headline = record.headline;
    dto.bio = record.bio;
    return dto;
  }
}
