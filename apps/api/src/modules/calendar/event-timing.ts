import { type DateKey, dateKeyUtc } from '../../common/time/zoned-time';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { DEFAULT_EVENT_MINUTES } from './constants';
import type { CalendarEventRecord } from './repositories/calendar-events.repository';

/**
 * How an appointment sits on a calendar.
 *
 * - TIMED: a direct booking. It starts at its anchor — the start the provider
 *   retained by accepting (§13.1 nº 15c), or the start of the offered window
 *   while the booking is still open.
 * - ALL_DAY: an accepted tender. Its quote proposes a DAY (stored at noon UTC
 *   precisely so that it reads as the same civil day on the whole continent),
 *   never an hour, so it is drawn as a day-long entry.
 * - UNSCHEDULED: nothing dates it yet.
 */
export type EventTiming =
  | { kind: 'TIMED'; startMs: number; endMs: number }
  | { kind: 'ALL_DAY'; date: DateKey }
  | { kind: 'UNSCHEDULED' };

const MS_PER_MINUTE = 60_000;

/**
 * Resolves the timing of one appointment. Pure.
 *
 * The END of a timed appointment, in order of preference:
 * 1. start + the duration the provider lists for this service — the best
 *    estimate of the time it really takes;
 * 2. the end of the window the client offered — the client said « between 9
 *    and 12 », so the provider is expected somewhere in there;
 * 3. start + DEFAULT_EVENT_MINUTES — an entry has to have a height.
 *
 * ⚠️ (1) BEFORE (2), DELIBERATELY. The window is when the CLIENT is available,
 * not how long the job lasts: a 45-minute haircut booked « between 9 h and
 * 17 h » would otherwise block the provider's whole day and hide seven free
 * hours from every other client.
 */
export function resolveEventTiming(
  record: Pick<
    CalendarEventRecord,
    'requestType' | 'anchorAtUtc' | 'desiredEndAtUtc' | 'serviceDurationMinutes'
  >,
): EventTiming {
  if (!record.anchorAtUtc) return { kind: 'UNSCHEDULED' };
  const startMs = record.anchorAtUtc.getTime();

  if (record.requestType !== ServiceRequestType.DIRECT_BOOKING) {
    return { kind: 'ALL_DAY', date: dateKeyUtc(startMs) };
  }

  const duration = record.serviceDurationMinutes;
  if (duration !== null && duration > 0) {
    return { kind: 'TIMED', startMs, endMs: startMs + duration * MS_PER_MINUTE };
  }
  const windowEndMs = record.desiredEndAtUtc?.getTime() ?? null;
  if (windowEndMs !== null && windowEndMs > startMs) {
    return { kind: 'TIMED', startMs, endMs: windowEndMs };
  }
  return { kind: 'TIMED', startMs, endMs: startMs + DEFAULT_EVENT_MINUTES * MS_PER_MINUTE };
}
