import {
  type DateKey,
  addDays,
  isoWeekday,
  zonedTimeToUtcMs,
} from '../../common/time/zoned-time';
import { AVAILABILITY_GRID_MINUTES, AVAILABILITY_MIN_SLOT_MINUTES } from './constants';
import type { WeeklyRange } from './weekly-hours';

/** A half-open interval of UTC instants, `[startMs, endMs)`. */
export interface Interval {
  startMs: number;
  endMs: number;
}

export interface AvailabilityDay {
  /** The civil day, in the calendar's time zone. */
  date: DateKey;
  /** Free intervals that START on this day, in order. */
  slots: Interval[];
}

export interface AvailabilityInput {
  timeZone: string;
  weeklyHours: readonly WeeklyRange[];
  /** Blocked periods (time off) AND confirmed appointments — both simply remove time. */
  blocked: readonly Interval[];
  /** First civil day served (in `timeZone`). */
  fromDate: DateKey;
  days: number;
  /** Nothing is offered before this instant (now + the booking lead time). */
  notBeforeMs: number;
}

const MS_PER_MINUTE = 60_000;

/** `base` minus every interval of `holes`. `holes` need not be sorted nor disjoint. */
export function subtractIntervals(base: Interval, holes: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const hole of holes) {
    if (hole.endMs <= hole.startMs) continue;
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (hole.endMs <= piece.startMs || hole.startMs >= piece.endMs) {
        next.push(piece);
        continue;
      }
      if (hole.startMs > piece.startMs) {
        next.push({ startMs: piece.startMs, endMs: hole.startMs });
      }
      if (hole.endMs < piece.endMs) {
        next.push({ startMs: hole.endMs, endMs: piece.endMs });
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * The availability grid: quarter-hours of the epoch. Every real time zone sits
 * a whole number of quarter-hours from UTC, so a grid point is « :00, :15, :30
 * or :45 » on every wall clock.
 */
const GRID_MS = AVAILABILITY_GRID_MINUTES * MS_PER_MINUTE;

function ceilToGrid(ms: number): number {
  return Math.ceil(ms / GRID_MS) * GRID_MS;
}

function floorToGrid(ms: number): number {
  return Math.floor(ms / GRID_MS) * GRID_MS;
}

/**
 * The free intervals of a provider, day by day.
 *
 * For each civil day: the weekly opening ranges of its weekday, turned into UTC
 * instants IN THE CALENDAR'S ZONE (so 9 h stays 9 h across a DST change), minus
 * everything blocked, minus the past and the booking lead time. What is left
 * and still at least AVAILABILITY_MIN_SLOT_MINUTES long is offered.
 *
 * ⚠️ THIS IS THE ONLY THING THE PUBLIC READ IS BUILT FROM. It returns free
 * time and nothing else: no reason an hour is taken, no label, no client. A
 * caller can infer THAT a provider is busy inside his published hours — that
 * is what publishing availability means — but never with whom, where or why.
 *
 * Pure: no clock, no database. `notBeforeMs` is the only notion of « now ».
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityDay[] {
  const { timeZone, weeklyHours, blocked, fromDate, days, notBeforeMs } = input;
  const minMs = AVAILABILITY_MIN_SLOT_MINUTES * MS_PER_MINUTE;
  const out: AvailabilityDay[] = [];

  for (let i = 0; i < days; i += 1) {
    const date = addDays(fromDate, i);
    const weekday = isoWeekday(date);
    const slots: Interval[] = [];

    for (const range of weeklyHours) {
      if (range.weekday !== weekday) continue;
      const open: Interval = {
        startMs: zonedTimeToUtcMs(date, range.startMinute, timeZone),
        endMs: zonedTimeToUtcMs(date, range.endMinute, timeZone),
      };
      if (open.endMs <= open.startMs) continue; // swallowed by a DST gap

      for (const piece of subtractIntervals(open, blocked)) {
        // The lead time cuts the START of a piece. Both ends then snap INWARDS
        // to the grid: a blocked period may end at 14 h 07, and « libre dès
        // 14 h 07 » is not something to offer.
        const startMs = ceilToGrid(Math.max(piece.startMs, notBeforeMs));
        const endMs = floorToGrid(piece.endMs);
        if (endMs - startMs >= minMs) {
          slots.push({ startMs, endMs });
        }
      }
    }

    slots.sort((a, b) => a.startMs - b.startMs);
    out.push({ date, slots });
  }

  return out;
}
