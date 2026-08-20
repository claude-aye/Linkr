import { ApiProperty } from '@nestjs/swagger';
import { MyReviewRecord } from '../repositories/reviews.repository';

/**
 * One of the CALLER'S OWN reviews.
 *
 * ⚠️ IT CARRIES `serviceRequestId`, WHICH THE PUBLIC ITEM DELIBERATELY DOES NOT.
 * That is not an inconsistency: on the public profile the id would link a named
 * person to a purchase for any reader, which is why it is absent there. Here the
 * reader IS the author, the request is already theirs, and the id is the only
 * thing that lets their own review be matched back to the job it is about — and
 * retracted (D-3). Same field, opposite answer, because the audience differs.
 *
 * No `authorDisplayName`: the caller knows who they are.
 */
export class MyReviewItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'The request this review is about — the key the caller joins on.',
    format: 'uuid',
  })
  serviceRequestId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceProviderId!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @ApiProperty({ type: 'string', nullable: true, example: 'Travail impeccable.' })
  comment!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAtUtc!: Date;

  @ApiProperty({
    description:
      "The provider's single reply (D-2), or null. Written once and never edited; a retraction of the review takes it with it (D-3).",
    type: 'string',
    nullable: true,
    example: 'Merci beaucoup, ce fut un plaisir.',
  })
  providerResponse!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  providerRespondedAtUtc!: Date | null;

  static from(record: MyReviewRecord): MyReviewItemDto {
    const dto = new MyReviewItemDto();
    dto.id = record.id;
    dto.serviceRequestId = record.serviceRequestId;
    dto.serviceProviderId = record.serviceProviderId;
    dto.rating = record.rating;
    dto.comment = record.comment;
    dto.createdAtUtc = record.createdAtUtc;
    dto.providerResponse = record.providerResponse;
    dto.providerRespondedAtUtc = record.providerRespondedAtUtc;
    return dto;
  }
}
