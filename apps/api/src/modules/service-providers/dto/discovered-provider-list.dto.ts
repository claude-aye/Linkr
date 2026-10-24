import { ApiProperty } from '@nestjs/swagger';
import { DiscoveredProviderDto } from './discovered-provider.dto';

/**
 * The real response envelope of `GET /service-providers/discover`. Until R2a
 * the route was annotated as a bare array while the runtime returned this
 * envelope; the front had to mirror it and cast. Dedicated to this endpoint —
 * no speculative generic `PaginatedResponseDto<T>` (pattern 3.12a-back-fix).
 */
export class DiscoveredProviderListDto {
  @ApiProperty({ type: DiscoveredProviderDto, isArray: true })
  items!: DiscoveredProviderDto[];

  @ApiProperty({ type: 'integer', description: 'Eligible providers in total, all pages.' })
  total!: number;

  @ApiProperty({ type: 'integer' })
  page!: number;

  @ApiProperty({ type: 'integer' })
  limit!: number;
}
