import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType } from '../enums/payment-method-type.enum';
import { PaymentMethodRecord } from '../repositories/payment-method.repository';

/**
 * A saved payment method, as returned to its owner.
 *
 * ⚠️ THE NULLABLE FIELDS CARRY `type` + `nullable` EXPLICITLY, and they have to.
 * A bare `@ApiPropertyOptional()` emits a schema with no type at all, which
 * openapi-typescript renders as `Record<string, never>` — a field the web app
 * cannot display without a cast, on the one DTO whose brand / expiry / last4 ARE
 * the screen (5.1). Nothing else changes: the wire shape is identical.
 */
export class PaymentMethodResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({ description: 'Stripe PaymentMethod id (pm_...).' })
  stripePaymentMethodId!: string;

  @ApiProperty({ enum: PaymentMethodType })
  type!: PaymentMethodType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Card brand, e.g. visa / mastercard.',
  })
  brand!: string | null;

  @ApiProperty({ description: 'Last 4 digits for display.' })
  last4!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Card expiry month (1-12).',
  })
  expMonth!: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Card expiry year (4-digit).',
  })
  expYear!: number | null;

  @ApiProperty() isDefault!: boolean;

  @ApiProperty() createdAtUtc!: Date;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'Set when the method has been removed.',
  })
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
