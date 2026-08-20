import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /reviews`.
 *
 * ⚠️ THREE FIELDS THE CALLER DOES NOT GET TO SEND, AND THAT IS THE POINT. The
 * reviewed PROVIDER, the AUTHOR and the fact that the job is finished are all
 * read server-side from the service request (D-1): the provider comes from
 * `assigned_service_provider_id`, the author from the JWT's `sub`, and the state
 * from `status`. Accepting any of them here would make a review forgeable, which
 * is precisely what makes moderation unnecessary in this design. Under
 * `forbidNonWhitelisted`, sending one is a 400 anyway.
 *
 * ⚠️ `rating` IS `@IsInt()` AND THAT VALIDATOR IS THE ONLY THING THAT REJECTS
 * 3.5. The database CHECK bounds the range, but PostgreSQL coerces a fractional
 * value into `smallint` (rounding 3.5 to 4) before any CHECK can run — see the
 * column comment in migration 1780520000000. Loosen this to `@IsNumber()` and
 * fractional ratings start silently rounding into the aggregate.
 */
export class CreateReviewDto {
  @ApiProperty({
    description:
      'The COMPLETED service request being reviewed. The provider and the author are derived from it server-side and are NOT accepted here.',
    format: 'uuid',
  })
  @IsUUID()
  serviceRequestId!: string;

  @ApiProperty({
    description: 'Whole-star rating, 1 to 5. Never fractional (D-5).',
    type: 'integer',
    minimum: 1,
    maximum: 5,
    example: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  /**
   * Optional (D-5): a mandatory comment would cut volume, and volume is what
   * makes the three-review threshold reachable in the first place.
   *
   * Trimmed here so that whitespace cannot pass for content — the database
   * CHECK rejects a blank-but-present comment, and the service turns an empty
   * string into `NULL` rather than storing one.
   */
  @ApiPropertyOptional({
    description:
      'Free-text comment, 1 to 2000 characters after trimming. Optional — omit it rather than sending an empty string.',
    maxLength: 2000,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  comment?: string;
}
