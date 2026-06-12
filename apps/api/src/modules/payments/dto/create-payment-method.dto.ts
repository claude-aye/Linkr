import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CreatePaymentMethodDto {
  @ApiProperty({
    description:
      'Stripe PaymentMethod id (pm_...) created client-side (e.g. via Stripe Elements, or a test token like pm_card_visa).',
    example: 'pm_card_visa',
  })
  @IsString()
  @Matches(/^pm_/, { message: 'stripePaymentMethodId must start with "pm_"' })
  stripePaymentMethodId!: string;

  @ApiPropertyOptional({
    description:
      'Make this the default method. The first method saved is always default regardless.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  setDefault?: boolean;
}
