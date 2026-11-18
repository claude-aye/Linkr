import { HttpException, HttpStatus } from '@nestjs/common';
import {
  CALENDAR_RANGE_MAX_DAYS,
  TIME_OFF_MAX_DAYS,
  TIME_OFF_MAX_UPCOMING,
  WEEKLY_HOURS_MAX_RANGES_PER_DAY,
  WEEKLY_HOURS_STEP_MINUTES,
} from '../constants';
import type { WeeklyHoursViolation } from '../weekly-hours';

const WEEKLY_HOURS_MESSAGES: Record<WeeklyHoursViolation, string> = {
  NOT_AN_ARRAY: 'weeklyHours must be an array',
  BAD_RANGE:
    'Each range needs weekday 1–7 (ISO, 1 = Monday) and 0 <= startMinute < endMinute <= 1440',
  OFF_GRID: `Opening hours must fall on ${WEEKLY_HOURS_STEP_MINUTES}-minute steps`,
  TOO_MANY_RANGES: `At most ${WEEKLY_HOURS_MAX_RANGES_PER_DAY} ranges per weekday`,
  OVERLAP: 'Two ranges of the same weekday overlap',
};

/** 422 — the weekly schedule is well-formed JSON but not a valid schedule. */
export class InvalidWeeklyHoursException extends HttpException {
  constructor(violation: WeeklyHoursViolation) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        code: `WEEKLY_HOURS_${violation}`,
        message: WEEKLY_HOURS_MESSAGES[violation],
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export type TimeOffPeriodViolation = 'END_BEFORE_START' | 'ALREADY_OVER' | 'TOO_LONG';

const TIME_OFF_MESSAGES: Record<TimeOffPeriodViolation, string> = {
  END_BEFORE_START: 'endsAtUtc must be after startsAtUtc',
  ALREADY_OVER: 'The period is already over',
  TOO_LONG: `A blocked period cannot exceed ${TIME_OFF_MAX_DAYS} days`,
};

/** 422 — a blocked period that ends before it starts, is already over, or is too long. */
export class InvalidTimeOffPeriodException extends HttpException {
  constructor(violation: TimeOffPeriodViolation) {
    super(TIME_OFF_MESSAGES[violation], HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** Machine-readable code of the 409 below. Part of the contract: the web maps on it. */
export const TIME_OFF_LIMIT_REACHED = 'TIME_OFF_LIMIT_REACHED';

/** 409 — the provider already holds TIME_OFF_MAX_UPCOMING periods not over yet. */
export class TimeOffLimitReachedException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: TIME_OFF_LIMIT_REACHED,
        message: `At most ${TIME_OFF_MAX_UPCOMING} upcoming blocked periods`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the window is not ordered, or is wider than the ceiling. */
export class InvalidCalendarRangeException extends HttpException {
  constructor(violation: 'ORDER' | 'TOO_WIDE') {
    super(
      violation === 'ORDER'
        ? 'The end of the window must be after its start'
        : `The window cannot exceed ${CALENDAR_RANGE_MAX_DAYS} days`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
