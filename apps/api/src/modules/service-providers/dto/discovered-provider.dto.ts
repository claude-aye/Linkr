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
}
