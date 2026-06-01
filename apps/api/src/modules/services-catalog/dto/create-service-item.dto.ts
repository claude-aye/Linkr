import {
  IsBoolean,
  IsEnum,
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
import { ApprovalStatus } from '../enums/approval-status.enum';
import { PriceRangeDto } from './price-range.dto';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateServiceItemDto {
  @ApiProperty()
  @IsUUID()
  serviceCategoryId!: string;

  @ApiProperty({ example: 'deboucher-evier' })
  @IsString()
  @Length(3, 80)
  @Matches(SLUG_RE, { message: 'slug must be lowercase alphanumeric with hyphens' })
  slug!: string;

  @ApiProperty({ example: { 'fr-CA': 'Déboucher un évier', 'en-CA': 'Unclog a sink' } })
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

  // Admin can create items directly as APPROVED; default is PENDING.
  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  approvalStatus?: ApprovalStatus;

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
