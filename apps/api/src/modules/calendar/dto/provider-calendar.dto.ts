import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';
import { CalendarEventDto } from './calendar-event.dto';
import { TimeOffDto } from './time-off.dto';
import { WeeklyRangeDto } from './weekly-hours.dto';

export class CalendarRangeQueryDto {
  @ApiProperty({ format: 'date-time', description: 'Start of the window (inclusive)' })
  @IsDateString()
  from!: string;

  @ApiProperty({ format: 'date-time', description: 'End of the window (exclusive)' })
  @IsDateString()
  to!: string;
}

/** Everything the provider's calendar page renders, in one read. */
export class ProviderCalendarDto {
  @ApiProperty({ example: 'America/Toronto' })
  timeZone!: string;

  @ApiProperty({ type: WeeklyRangeDto, isArray: true })
  weeklyHours!: WeeklyRangeDto[];

  @ApiProperty({
    type: CalendarEventDto,
    isArray: true,
    description: 'Dated appointments touching the window (timed or day-long), in order',
  })
  events!: CalendarEventDto[];

  @ApiProperty({
    type: CalendarEventDto,
    isArray: true,
    description: 'Jobs still to do that nothing dates yet — whatever the window',
  })
  unscheduled!: CalendarEventDto[];

  @ApiProperty({
    type: TimeOffDto,
    isArray: true,
    description: 'Blocked periods overlapping the window',
  })
  timeOff!: TimeOffDto[];

  @ApiProperty({
    type: TimeOffDto,
    isArray: true,
    description: 'Every blocked period not over yet — the management list',
  })
  upcomingTimeOff!: TimeOffDto[];

  @ApiProperty({ description: 'Whether an iCal feed link is active' })
  feedEnabled!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  feedCreatedAtUtc!: Date | null;
}
