import { ApiProperty } from '@nestjs/swagger';
import { ReviewRecord } from '../repositories/reviews.repository';

/**
 * What the AUTHOR gets back after writing a review.
 *
 * No `providerResponse`: the column exists (migration 1780520000000) but nothing
 * writes it before tranche 2, and a contract should not advertise a field
 * nothing can fill. Adding it then is purely additive.
 *
 * Every property carries an explicit `@ApiProperty` with a CONCRETE type,
 * `nullable` included. The Swagger plugin is not enabled in `nest-cli.json`, so
 * an un-annotated field generates empty, and a `T | null` annotated without a
 * concrete `type` degrades to `Record<string, never>` in `schema.d.ts` — the
 * repository-wide *nullable* debt this DTO deliberately does not join.
 */
export class ReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  serviceRequestId!: string;

  @ApiProperty({
    description: 'The provider this review is about, resolved server-side.',
    format: 'uuid',
  })
  serviceProviderId!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @ApiProperty({ type: 'string', nullable: true, example: 'Travail impeccable.' })
  comment!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAtUtc!: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAtUtc!: Date;

  static from(record: ReviewRecord): ReviewResponseDto {
    const dto = new ReviewResponseDto();
    dto.id = record.id;
    dto.serviceRequestId = record.serviceRequestId;
    dto.serviceProviderId = record.serviceProviderId;
    dto.rating = record.rating;
    dto.comment = record.comment;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    return dto;
  }
}
