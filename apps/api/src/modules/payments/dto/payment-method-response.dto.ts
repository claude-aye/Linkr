import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType } from '../enums/payment-method-type.enum';
import { PaymentMethodRecord } from '../repositories/payment-method.repository';

/** A saved payment method, as returned to its owner. */
export class PaymentMethodResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: 'Stripe PaymentMethod id (pm_...).' })
  stripePaymentMethodId!: string;

  @ApiProperty({ enum: PaymentMethodType })
  type!: PaymentMethodType;

  @ApiPropertyOptional({ description: 'Card brand, e.g. visa / mastercard.' })
  brand!: string | null;

  @ApiProperty({ description: 'Last 4 digits for display.' })
  last4!: string;

  @ApiPropertyOptional({ description: 'Card expiry month (1-12).' })
  expMonth!: number | null;

  @ApiPropertyOptional({ description: 'Card expiry year (4-digit).' })
  expYear!: number | null;

  @ApiProperty() isDefault!: boolean;

  @ApiProperty() createdAtUtc!: Date;

  @ApiPropertyOptional({ description: 'Set when the method has been removed.' })
  deletedAtUtc!: Date | null;

  static from(record: PaymentMethodRecord): PaymentMethodResponseDto {
    const dto = new PaymentMethodResponseDto();
    dto.id = record.id;
    dto.stripePaymentMethodId = record.stripePaymentMethodId;
    dto.type = record.type;
    dto.brand = record.brand;
    dto.last4 = record.last4;
    dto.expMonth = record.expMonth;
    dto.expYear = record.expYear;
    dto.isDefault = record.isDefault;
    dto.createdAtUtc = record.createdAtUtc;
    dto.deletedAtUtc = record.deletedAtUtc;
    return dto;
  }
}
