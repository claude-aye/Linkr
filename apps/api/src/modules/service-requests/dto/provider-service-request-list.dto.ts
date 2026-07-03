import { ApiProperty } from '@nestjs/swagger';
import { ProviderServiceRequestItemDto } from './provider-service-request-item.dto';

/**
 * Paginated envelope for the provider dashboard listing
 * (`GET /service-providers/:id/service-requests`, Vision B).
 *
 * Dedicated, endpoint-specific envelope — NOT a speculative generic
 * `PaginatedResponseDto<T>` (deliberate: close the contract bug without an
 * abstraction we don't yet have repeated usage for). Exists so the OpenAPI
 * contract reflects the runtime shape the service already returns
 * (`{ items, total, page, limit }`) instead of the earlier `isArray` lie.
 */
export class ProviderServiceRequestListDto {
  @ApiProperty({ type: ProviderServiceRequestItemDto, isArray: true })
  items!: ProviderServiceRequestItemDto[];

  @ApiProperty({ description: 'Total matching rows (before pagination)' })
  total!: number;

  @ApiProperty({ description: 'Current page (1-based)' })
  page!: number;

  @ApiProperty({ description: 'Page size' })
  limit!: number;
}
