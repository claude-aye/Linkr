import { ApiProperty } from '@nestjs/swagger';
import { ProviderReviewItemDto } from './provider-review-item.dto';

/**
 * A provider's reviews and their aggregate.
 *
 * An honest envelope from the start — a dedicated DTO, `@ApiResponse`d with the
 * shape the runtime actually returns. This repository has been bitten three
 * times by an annotation claiming a bare array over an enveloping runtime
 * (`discover`, `GET /service-requests`, the provider dashboard listing); no
 * speculative generic `PaginatedResponseDto<T>` either — that generalisation
 * waits for a real repeated use.
 *
 * No `page`: there is no pagination and no cursor. `reviewCount` is what tells a
 * reader the cap bit.
 */
export class ProviderReviewListDto {
  @ApiProperty({ type: ProviderReviewItemDto, isArray: true })
  items!: ProviderReviewItemDto[];

  @ApiProperty({
    description:
      'Live reviews for this provider — the whole set, not the page. Soft-deleted reviews are excluded inside the aggregate itself.',
    type: 'integer',
    example: 4,
  })
  reviewCount!: number;

  /**
   * ⚠️ NULL BELOW THREE REVIEWS, AND THAT IS A RULE OF THE DATA, NOT OF THE
   * DISPLAY (D-4). The value is gated in SQL, so it never leaves the database
   * below the threshold and no consumer is asked to remember to hide it. An
   * average over one review is not a statistic; it condemns or oversells a
   * tradesperson on a sample of one. Same principle as the silence on
   * `GEOCODED` and the "not enough data to decide" banner on the demand map:
   * the platform never claims to know what it does not know.
   */
  @ApiProperty({
    description:
      'Mean rating rounded to 2 decimals, or null when there are fewer than 3 live reviews (D-4). Gated server-side — the front is never asked to hide it.',
    type: 'number',
    format: 'float',
    nullable: true,
    example: 4.67,
  })
  averageRating!: number | null;

  @ApiProperty({
    description: 'Server-side hard cap on `items`. There is no pagination.',
    type: 'integer',
    example: 50,
  })
  limit!: number;
}
