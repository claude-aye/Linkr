import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({
    description:
      'Refund amount in the payment currency (major units, e.g. 25.00). Must not exceed the still-refundable balance of the payment.',
    example: 25.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({
    description: 'Reason for the refund (admin audit trail).',
    example: 'Service not delivered as agreed',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
