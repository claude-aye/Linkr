import { ApiProperty } from '@nestjs/swagger';
import { ProviderTenderItemDto } from './provider-tender-item.dto';

/**
 * Paginated envelope for the provider tender feed
 * (`GET /service-providers/:id/tenders`).
 *
 * Dedicated and endpoint-specific, like `ProviderServiceRequestListDto` next
 * door — not a speculative generic `PaginatedResponseDto<T>`. Annotated from the
 * start so the contract states the runtime shape, rather than being corrected
 * later the way the `isArray` lie had to be.
 */
export class ProviderTenderListDto {
  @ApiProperty({ type: ProviderTenderItemDto, isArray: true })
  items!: ProviderTenderItemDto[];

  @ApiProperty({ description: 'Total matching rows (before pagination)' })
  total!: number;

  @ApiProperty({ description: 'Current page (1-based)' })
  page!: number;

  @ApiProperty({ description: 'Page size' })
  limit!: number;
}
