import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PricingModel } from '../enums/pricing-model.enum';

export class CreateProfessionalServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceItemId!: string;

  @ApiProperty({ enum: PricingModel })
  @IsEnum(PricingModel)
  pricingModel!: PricingModel;

  @ApiPropertyOptional({
    description:
      'Required for FLAT/HOURLY, must be absent for QUOTE_ONLY. Minimum 0.',
    minimum: 0,
  })
  @ValidateIf((o: CreateProfessionalServiceDto) => o.pricingModel !== PricingModel.QUOTE_ONLY)
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceAmount?: number;

  @ApiPropertyOptional({ example: 'CAD', description: 'ISO 4217 currency code (3 uppercase letters)' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'priceCurrency must be a 3-letter ISO 4217 currency code' })
  priceCurrency?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  estimatedDurationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionOverride?: string;
}
