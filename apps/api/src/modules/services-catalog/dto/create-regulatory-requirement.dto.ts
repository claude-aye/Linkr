import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsTranslationMap } from '../../../common/validators/is-translation-map.validator';
import { InputType } from '../enums/input-type.enum';
import { RequiredDocumentType } from '../enums/required-document-type.enum';

export class CreateRegulatoryRequirementDto {
  @ApiProperty()
  @IsUUID()
  serviceCategoryId!: string;

  @ApiProperty({ example: 'CA' })
  @IsString()
  @Length(2, 2)
  countryCode!: string;

  @ApiPropertyOptional({ example: 'CA-QC', description: 'NULL = country-wide' })
  @IsOptional()
  @IsString()
  @Length(4, 6)
  subdivisionCode?: string;

  @ApiProperty({ example: 'RBQ' })
  @IsString()
  @Length(1, 40)
  authorityCode!: string;

  @ApiProperty({ example: { 'fr-CA': 'Régie du bâtiment du Québec', 'en-CA': 'Quebec Building Authority' } })
  @IsTranslationMap()
  authorityFullNameTranslations!: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  validationEndpointUrl?: string;

  @ApiProperty({ enum: RequiredDocumentType })
  @IsEnum(RequiredDocumentType)
  requiredDocumentType!: RequiredDocumentType;

  @ApiProperty({ enum: InputType })
  @IsEnum(InputType)
  inputType!: InputType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
