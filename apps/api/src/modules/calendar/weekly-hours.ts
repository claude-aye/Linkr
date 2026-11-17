import { MINUTES_PER_DAY } from '../../common/time/zoned-time';
import { WEEKLY_HOURS_MAX_RANGES_PER_DAY, WEEKLY_HOURS_STEP_MINUTES } from './constants';

/**
 * One opening range of the weekly schedule, in WALL TIME of the calendar's
 * time zone: « on this weekday, from startMinute to endMinute after midnight ».
 *
 * `weekday` is ISO: 1 = Monday … 7 = Sunday. `endMinute` may be 1440 (open
 * until midnight). A range never crosses midnight: « 22 h → 2 h » is two
 * ranges, on two weekdays.
 */
export interface WeeklyRange {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Why a weekly schedule was refused. One reason, the first found. */
export type WeeklyHoursViolation =
  | 'NOT_AN_ARRAY'
  | 'BAD_RANGE'
  | 'OFF_GRID'
  | 'TOO_MANY_RANGES'
  | 'OVERLAP';

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validates a weekly schedule and returns it NORMALISED: sorted by weekday then
 * start, with touching ranges of a same day merged (9–12 + 12–17 → 9–17).
 *
 * The same function guards the write (the DTO only checks the shape) and
 * cleans what is read back from JSONB, so a row edited by hand cannot make the
 * availability computation trip.
 */
export function normaliseWeeklyHours(
  input: unknown,
): { ok: true; ranges: WeeklyRange[] } | { ok: false; violation: WeeklyHoursViolation } {
  if (!Array.isArray(input)) return { ok: false, violation: 'NOT_AN_ARRAY' };

  const ranges: WeeklyRange[] = [];
  for (const raw of input) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const { weekday, startMinute, endMinute } = r;
    if (
      !isInt(weekday) ||
      !isInt(startMinute) ||
      !isInt(endMinute) ||
      weekday < 1 ||
      weekday > 7 ||
      startMinute < 0 ||
      endMinute > MINUTES_PER_DAY ||
      startMinute >= endMinute
    ) {
      return { ok: false, violation: 'BAD_RANGE' };
    }
    if (
      startMinute % WEEKLY_HOURS_STEP_MINUTES !== 0 ||
      endMinute % WEEKLY_HOURS_STEP_MINUTES !== 0
    ) {
      return { ok: false, violation: 'OFF_GRID' };
    }
    ranges.push({ weekday, startMinute, endMinute });
  }

  ranges.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

  const merged: WeeklyRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && last.weekday === range.weekday) {
      // Strictly inside the previous range → two ranges claim the same minutes.
      if (range.startMinute < last.endMinute) return { ok: false, violation: 'OVERLAP' };
      if (range.startMinute === last.endMinute) {
        last.endMinute = range.endMinute;
        continue;
      }
    }
    merged.push({ ...range });
  }

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if (merged.filter((r) => r.weekday === weekday).length > WEEKLY_HOURS_MAX_RANGES_PER_DAY) {
      return { ok: false, violation: 'TOO_MANY_RANGES' };
    }
  }

  return { ok: true, ranges: merged };
}

/** What is read back from the JSONB column: a clean schedule, or none at all. */
export function readWeeklyHours(stored: unknown): WeeklyRange[] {
  const result = normaliseWeeklyHours(stored);
  return result.ok ? result.ranges : [];
}
