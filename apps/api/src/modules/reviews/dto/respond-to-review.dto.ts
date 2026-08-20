import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `POST /reviews/:id/response` — the provider's single reply (D-2).
 *
 * ⚠️ ONE FIELD, AND NOTHING ELSE. Which review, which provider, and whether a
 * reply already exists are all read server-side: the review id comes from the
 * path, the provider from the review, and the « only once » from the column.
 * Under `forbidNonWhitelisted` any extra key 400s the whole reply anyway.
 *
 * Required and non-blank after trimming — an empty reply is not a reply, and
 * `chk_reviews_response_paired` plus `chk_reviews_response_length` would reject
 * it in the database regardless.
 */
export class RespondToReviewDto {
  @ApiProperty({
    description:
      "The provider's reply, 1 to 2000 characters after trimming. It can be written ONCE (D-2) and cannot be edited or removed afterwards; a client who retracts their review takes the reply with it (D-3).",
    maxLength: 2000,
    type: 'string',
    example: 'Merci beaucoup, ce fut un plaisir. Au plaisir de vous revoir.',
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(2000)
  response!: string;
}
