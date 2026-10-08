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

/**
 * Price floor of a FLAT/HOURLY service, in the service's currency.
 *
 * Below it, the offer cannot be sold: a zero budget 400s when the request is
 * created, a 0 ¢ deposit is refused, and Stripe has a per-charge minimum. One
 * flat value, no per-currency table — the platform runs in CAD only.
 *
 * ⚠️ MIRRORED BY HAND in `apps/web/src/lib/provider-services/service-rules.ts`
 * (`MIN_SERVICE_PRICE`): the form and its relay apply the same floor, the relay
 * as defense in depth. Move both together.
 *
 * Inherited by `UpdateProfessionalServiceDto` through `PartialType`, which
 * only validates the fields that are SENT: a historical service priced under
 * the floor can still be edited (duration, description, toggle) without
 * restating its price, but a new `priceAmount` must clear it.
 */
export const MIN_SERVICE_PRICE_AMOUNT = 5;

export class CreateProfessionalServiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceItemId!: string;

  @ApiProperty({ enum: PricingModel })
  @IsEnum(PricingModel)
  pricingModel!: PricingModel;

  @ApiPropertyOptional({
    description: `Required for FLAT/HOURLY, must be absent for QUOTE_ONLY. Minimum ${MIN_SERVICE_PRICE_AMOUNT}.`,
    minimum: MIN_SERVICE_PRICE_AMOUNT,
  })
  @ValidateIf((o: CreateProfessionalServiceDto) => o.pricingModel !== PricingModel.QUOTE_ONLY)
  @IsNumber()
  @Min(MIN_SERVICE_PRICE_AMOUNT)
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
