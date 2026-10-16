import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDefined, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PORTFOLIO_CAPTION_MAX } from '../constants';
import { normaliseCaption } from './caption.transform';

/**
 * Body of `PATCH /service-providers/me/portfolio/:id` — the caption, and
 * nothing else (position has its own route, the file cannot be replaced).
 *
 * ⚠️ `caption` IS REQUIRED AS A KEY. `PATCH {}` is a 400, not a silent no-op
 * (lesson of PR C2, where an optional-only DTO let an empty body reach the
 * database). To clear a caption, send `null` or an empty string.
 */
export class UpdatePortfolioCaptionDto {
  @ApiProperty({
    description: `New caption, at most ${PORTFOLIO_CAPTION_MAX} characters after trimming. null or an empty string clears it.`,
    maxLength: PORTFOLIO_CAPTION_MAX,
    type: String,
    nullable: true,
  })
  @IsDefined()
  @Transform(({ value }) => normaliseCaption(value))
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(PORTFOLIO_CAPTION_MAX)
  caption!: string | null;
}
