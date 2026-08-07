import { ApiProperty } from '@nestjs/swagger';
import { NotificationItemDto } from './notification-item.dto';

/**
 * Envelope for `GET /notifications`. Dedicated and endpoint-specific — NOT a
 * speculative generic `PaginatedResponseDto<T>` (same call as 3.12a-back-fix and
 * 3.13-A), and honest about its runtime shape from day one rather than declared
 * as a bare array and corrected later.
 *
 * There is no `page`: the endpoint has no pagination, only a hard server cap.
 * `total` is what tells the reader the cap bit — `items.length < total` means
 * older notifications exist and are not in this response.
 */
export class NotificationListDto {
  @ApiProperty({ type: NotificationItemDto, isArray: true })
  items!: NotificationItemDto[];

  @ApiProperty({
    type: Number,
    description:
      'Unread notifications across the WHOLE set, not just this page — a badge computed on the page would under-count as soon as the cap truncates.',
  })
  unreadCount!: number;

  @ApiProperty({
    type: Number,
    description: 'Total matching notifications, before the cap.',
  })
  total!: number;

  @ApiProperty({
    type: Number,
    description: 'The hard server cap applied to `items` (no cursor, no paging).',
  })
  limit!: number;
}
