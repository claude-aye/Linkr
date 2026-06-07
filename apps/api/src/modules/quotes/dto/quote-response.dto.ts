import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuoteStatus } from '../enums/quote-status.enum';

export class QuoteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceRequestId!: string;
  @ApiProperty() serviceProviderId!: string;
  @ApiProperty({ description: 'Decimal serialized as string, paired with currency.' })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() estimatedDurationMinutes!: number;
  @ApiPropertyOptional() proposedStartAtUtc!: Date | null;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: QuoteStatus }) status!: QuoteStatus;
  @ApiProperty() validUntilUtc!: Date;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;
}
