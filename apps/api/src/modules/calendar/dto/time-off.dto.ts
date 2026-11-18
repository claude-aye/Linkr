import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIME_OFF_LABEL_MAX } from '../constants';
import type { TimeOffRecord } from '../repositories/provider-calendar.repository';

/** Trimmed; an empty label is `null`, never an empty string (the column CHECK refuses it). */
function normaliseLabel(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class CreateTimeOffDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  startsAtUtc!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  endsAtUtc!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TIME_OFF_LABEL_MAX,
    description: 'Private note of the provider. Never shown to clients.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLabel(value))
  @IsString()
  @MaxLength(TIME_OFF_LABEL_MAX)
  label?: string | null;
}

export class TimeOffDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) startsAtUtc!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endsAtUtc!: Date;
  @ApiProperty({ type: String, nullable: true }) label!: string | null;

  static from(record: TimeOffRecord): TimeOffDto {
    const dto = new TimeOffDto();
    dto.id = record.id;
    dto.startsAtUtc = record.startsAtUtc;
    dto.endsAtUtc = record.endsAtUtc;
    dto.label = record.label;
    return dto;
  }
}
