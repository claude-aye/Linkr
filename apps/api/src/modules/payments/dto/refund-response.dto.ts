import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus } from '../enums/refund-status.enum';

export class RefundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() paymentId!: string;
  @ApiProperty({ description: 'Refund amount (major units).' }) amount!: string;
  @ApiProperty({ description: 'ISO 4217, UPPERCASE.' }) currency!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() initiatedByUserId!: string;
  @ApiProperty({ enum: RefundStatus }) status!: RefundStatus;
  @ApiPropertyOptional() stripeRefundId!: string | null;
  @ApiPropertyOptional() failureReason!: string | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;
}
