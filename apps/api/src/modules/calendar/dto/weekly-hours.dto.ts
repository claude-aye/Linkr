import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { WEEKLY_HOURS_MAX_RANGES_PER_DAY } from '../constants';
import type { WeeklyRange } from '../weekly-hours';

/**
 * One opening range, in wall time of the calendar's zone. The DTO checks the
 * SHAPE; whether the ranges form a valid schedule (grid, overlap, count per
 * day) is decided by `normaliseWeeklyHours`, which answers 422 with a code.
 */
export class WeeklyRangeDto {
  @ApiProperty({ description: 'ISO weekday: 1 = Monday … 7 = Sunday', minimum: 1, maximum: 7 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ description: 'Minutes after local midnight', minimum: 0, maximum: 1439 })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @ApiProperty({
    description: 'Minutes after local midnight; 1440 = until midnight',
    minimum: 1,
    maximum: 1440,
  })
  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;

  static from(range: WeeklyRange): WeeklyRangeDto {
    const dto = new WeeklyRangeDto();
    dto.weekday = range.weekday;
    dto.startMinute = range.startMinute;
    dto.endMinute = range.endMinute;
    return dto;
  }
}

export class UpdateWeeklyHoursDto {
  @ApiProperty({
    type: WeeklyRangeDto,
    isArray: true,
    description:
      'The WHOLE weekly schedule (it replaces the previous one). An empty array unpublishes it.',
  })
  @IsArray()
  @ArrayMaxSize(7 * WEEKLY_HOURS_MAX_RANGES_PER_DAY)
  @ValidateNested({ each: true })
  @Type(() => WeeklyRangeDto)
  weeklyHours!: WeeklyRangeDto[];
}

/** What a write of the schedule answers: the schedule as stored (normalised). */
export class WeeklyHoursDto {
  @ApiProperty({
    description: 'IANA time zone the hours are expressed in',
    example: 'America/Toronto',
  })
  timeZone!: string;

  @ApiProperty({ type: WeeklyRangeDto, isArray: true })
  weeklyHours!: WeeklyRangeDto[];
}
