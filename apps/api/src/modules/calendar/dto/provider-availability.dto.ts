import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AVAILABILITY_DEFAULT_DAYS, AVAILABILITY_MAX_DAYS } from '../constants';
import { WeeklyRangeDto } from './weekly-hours.dto';

export class AvailabilityQueryDto {
  @ApiPropertyOptional({
    default: AVAILABILITY_DEFAULT_DAYS,
    minimum: 1,
    maximum: AVAILABILITY_MAX_DAYS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(AVAILABILITY_MAX_DAYS)
  days?: number = AVAILABILITY_DEFAULT_DAYS;
}

export class AvailabilitySlotDto {
  @ApiProperty({ type: String, format: 'date-time' }) startAtUtc!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endAtUtc!: Date;
}

export class AvailabilityDayDto {
  @ApiProperty({ description: "Civil day in the provider's time zone", example: '2026-11-20' })
  date!: string;

  @ApiProperty({ type: AvailabilitySlotDto, isArray: true })
  slots!: AvailabilitySlotDto[];
}

/**
 * A provider's availability, as ANOTHER user may see it.
 *
 * ⚠️ A WHITELIST (CLAUDE.md §13.1 nº 21): the published weekly hours and the
 * free time left in the coming days. Nothing says WHY an hour is not free —
 * no appointment, no blocked-period label, no client, no address.
 */
export class ProviderAvailabilityDto {
  @ApiProperty({ example: 'America/Toronto' })
  timeZone!: string;

  @ApiProperty({
    description:
      'False when the provider has published no weekly hours (or is paused): `days` then holds no slot, and that says nothing about whether he is free.',
  })
  published!: boolean;

  @ApiProperty({ type: WeeklyRangeDto, isArray: true })
  weeklyHours!: WeeklyRangeDto[];

  @ApiProperty({ type: AvailabilityDayDto, isArray: true })
  days!: AvailabilityDayDto[];
}
