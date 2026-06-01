import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsTranslationMap } from '../../../common/validators/is-translation-map.validator';
import { PriceRangeDto } from './price-range.dto';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Identical shape to CreateServiceItemDto but without approvalStatus —
// suggestions always start as PENDING, set by the service layer.
export class SuggestServiceItemDto {
  @ApiProperty()
  @IsUUID()
  serviceCategoryId!: string;

  @ApiProperty({ example: 'installation-thermostat' })
  @IsString()
  @Length(3, 80)
  @Matches(SLUG_RE, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @ApiProperty({ example: { 'fr-CA': 'Installation de thermostat' } })
  @IsTranslationMap()
  nameTranslations!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsTranslationMap()
  descriptionTranslations?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  typicalDurationMinutes?: number;

  @ApiPropertyOptional({ type: PriceRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PriceRangeDto)
  suggestedPriceRange?: PriceRangeDto;
}
