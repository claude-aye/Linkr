import { ApiProperty } from '@nestjs/swagger';
import { ServiceRequestResponseDto } from './service-request-response.dto';

/**
 * Paginated envelope for the client/admin listing
 * (`GET /service-requests`).
 *
 * Dedicated, endpoint-specific envelope — NOT a speculative generic
 * `PaginatedResponseDto<T>` (deliberate: close the contract bug without an
 * abstraction we don't yet have repeated usage for; same call as
 * `ProviderServiceRequestListDto` in 3.12a-back-fix). Exists so the OpenAPI
 * contract reflects the runtime shape the service already returns
 * (`{ items, total, page, limit }`) instead of the earlier empty 200
 * (`content?: never`) — the handler had no `@ApiResponse` at all.
 */
export class ServiceRequestListDto {
  @ApiProperty({ type: ServiceRequestResponseDto, isArray: true })
  items!: ServiceRequestResponseDto[];

  @ApiProperty({ description: 'Total matching rows (before pagination)' })
  total!: number;

  @ApiProperty({ description: 'Current page (1-based)' })
  page!: number;

  @ApiProperty({ description: 'Page size' })
  limit!: number;
}
