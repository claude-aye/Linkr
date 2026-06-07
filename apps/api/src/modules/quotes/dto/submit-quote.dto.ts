import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitQuoteDto {
  @ApiProperty({ description: 'Quoted amount (> 0).', example: 250.0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({
    description: 'ISO 4217 currency code (exactly 3 chars).',
    example: 'CAD',
    minLength: 3,
    maxLength: 3,
  })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ description: 'Estimated duration in minutes (> 0).', example: 120 })
  @IsInt()
  @IsPositive()
  estimatedDurationMinutes!: number;

  @ApiPropertyOptional({
    description: 'Proposed start (ISO 8601, stored as timestamptz).',
    format: 'date-time',
  })
  @IsOptional()
  @IsDateString()
  proposedStartAtUtc?: string;

  @ApiProperty({ description: "The Pro's pitch / scope of the quote." })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    description: 'Quote expiration (ISO 8601, timestamptz). Must be in the future.',
    format: 'date-time',
  })
  @IsDateString()
  validUntilUtc!: string;
}
