import { ApiProperty } from '@nestjs/swagger';
import { DemandSignalSummaryItemDto } from './demand-signal-summary-item.dto';

/**
 * Envelope for `GET /admin/demand-signals`. Dedicated and endpoint-specific —
 * NOT a speculative generic `PaginatedResponseDto<T>`, and honest about its
 * runtime shape from day one rather than declared as a bare array and corrected
 * later (the lesson of 3.12a-back-fix, 3.13-A and the `discover` mirror).
 *
 * There is no `page`: no pagination, only a hard server cap. `totalSectors` is
 * what tells the reader the cap bit — `items.length < totalSectors` means cells
 * exist that this response does not carry.
 */
export class DemandSignalSummaryListDto {
  @ApiProperty({ type: DemandSignalSummaryItemDto, isArray: true })
  items!: DemandSignalSummaryItemDto[];

  @ApiProperty({
    type: Number,
    description:
      'Distinct (trade × sector) cells across the WHOLE map, before the cap. Counted with a window function, so the cap cannot make it lie.',
  })
  totalSectors!: number;

  @ApiProperty({
    type: Number,
    description:
      'Total recorded signals across the WHOLE map, before the cap. This is the number that says whether there is yet enough to decide anything.',
  })
  totalSignals!: number;

  @ApiProperty({
    type: Number,
    description: 'The hard server cap applied to `items` (no cursor, no paging).',
  })
  limit!: number;
}
