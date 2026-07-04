import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsTranslationMap } from '../../../common/validators/is-translation-map.validator';
import { RegulationLevel } from '../enums/regulation-level.enum';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateServiceCategoryDto {
  @ApiProperty({ example: 'plomberie' })
  @IsString()
  @Length(3, 80)
  @Matches(SLUG_RE, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @ApiProperty({
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
    additionalProperties: { type: 'string' }, // types the JSONB map (codegen → Record<string, string>)
  })
  @IsTranslationMap()
  nameTranslations!: Record<string, string>;

  @ApiPropertyOptional({
    example: { 'fr-CA': 'Services de plomberie résidentielle' },
    additionalProperties: { type: 'string' }, // idem
  })
  @IsOptional()
  @IsTranslationMap()
  descriptionTranslations?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiProperty({ enum: RegulationLevel })
  @IsEnum(RegulationLevel)
  regulationLevel!: RegulationLevel;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
