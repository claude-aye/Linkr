import { ApiProperty } from '@nestjs/swagger';
import { MyReviewItemDto } from './my-review-item.dto';

/**
 * The caller's own reviews.
 *
 * An honest envelope from the start, like every list this chantier ships — no
 * bare array claiming to be one thing while the runtime returns another.
 * No `page` and no cursor: there is no pagination, and `limit` is what tells a
 * reader the server cap.
 */
export class MyReviewListDto {
  @ApiProperty({ type: MyReviewItemDto, isArray: true })
  items!: MyReviewItemDto[];

  @ApiProperty({
    description: 'Server-side hard cap on `items`. There is no pagination.',
    type: 'integer',
    example: 100,
  })
  limit!: number;
}
