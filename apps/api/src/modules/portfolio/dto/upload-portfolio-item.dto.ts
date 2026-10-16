import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PORTFOLIO_CAPTION_MAX } from '../constants';
import { normaliseCaption } from './caption.transform';

/**
 * Non-file field of `POST /service-providers/me/portfolio` (multipart). The file
 * itself arrives through `@UploadedFile()` under the field name `file`.
 *
 * The length is checked AFTER trimming (the transform runs first), so trailing
 * spaces never cost a character.
 */
export class UploadPortfolioItemDto {
  @ApiPropertyOptional({
    description: `Optional caption, at most ${PORTFOLIO_CAPTION_MAX} characters after trimming. Empty → null.`,
    maxLength: PORTFOLIO_CAPTION_MAX,
    type: String,
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }) => normaliseCaption(value))
  @IsString()
  @MaxLength(PORTFOLIO_CAPTION_MAX)
  caption?: string | null;
}
