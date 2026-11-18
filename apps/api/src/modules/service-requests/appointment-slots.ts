import { ServiceRequestStatus } from './enums/service-request-status.enum';
import { ServiceRequestType } from './enums/service-request-type.enum';

/**
 * Which appointments take time, and when two of them collide (CAL-3).
 *
 * ⚠️ THE ONE PLACE FOR THE BLOCKING STATUSES. The calendar module reads them
 * from here for the public availability, and this module reads them for the
 * two refusals (`SLOT_TAKEN` at creation, `SLOT_CONFLICT` at acceptance). The
 * file lives HERE, not in the calendar module, because the calendar already
 * imports this module's enums: the opposite direction would be a cycle.
 *
 * No import beyond the two enums: pure data and pure functions, so the rules
 * are pinned by plain table-driven tests.
 */

/** Statuses that still TAKE time ahead: the job is the provider's and not done. */
export const BUSY_JOB_STATUSES: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.ASSIGNED,
  ServiceRequestStatus.IN_PROGRESS,
];

/**
 * Statuses whose TIMED entries remove time from the public availability
 * (decision of 17 November 2026): the jobs still ahead, AND a direct booking
 * still OPEN — the client asked for that hour, so it is not offered to a
 * second client while the provider has not answered. A pending booking never
 * blocks for long: its response deadline is min(desired start, now + 48 h),
 * and the 5-minute expiry sweep turns it EXPIRED once that passes.
 *
 * Only TIMED entries count — an accepted tender names a day, not an hour, and
 * blocks nothing (the provider adds a blocked period if he wants the day).
 *
 * The same list refuses a new direct booking whose window overlaps one of
 * these entries (`SLOT_TAKEN`): what the picker hides, creation refuses.
 */
export const AVAILABILITY_BLOCKING_STATUSES: readonly ServiceRequestStatus[] = [
  ServiceRequestStatus.OPEN,
  ...BUSY_JOB_STATUSES,
];

/**
 * A timed appointment with no known duration lasts this long. The calendar's
 * `DEFAULT_EVENT_MINUTES` IS this value (re-exported, never re-declared).
 */
export const APPOINTMENT_DEFAULT_MINUTES = 60;

/** One appointment of the provider, as the slot check reads it. */
export interface SlotCandidate {
  id: string;
  status: ServiceRequestStatus;
  requestType: ServiceRequestType;
  /** COALESCE(scheduled_at_utc, desired_start_at_utc). Null = undated. */
  anchorAtUtc: Date | null;
  desiredEndAtUtc: Date | null;
  /** Duration the provider lists for this service, if it still offers it. */
  serviceDurationMinutes: number | null;
}

/** A half-open interval `[startMs, endMs)`. */
export interface SlotInterval {
  startMs: number;
  endMs: number;
}

const MS_PER_MINUTE = 60_000;

/**
 * The time an appointment occupies, or null when it occupies no HOUR.
 *
 * ⚠️ SAME RULE AS THE CALENDAR'S `resolveEventTiming` (TIMED branch), held
 * together by a parity test (`appointment-slots.spec.ts`). Diverging would let
 * the API refuse a slot the picker offers, or accept one it hides:
 * 1. start + the duration the provider lists for this service;
 * 2. else the end of the window the client offered, if after the start;
 * 3. else start + APPOINTMENT_DEFAULT_MINUTES.
 * Only a DIRECT_BOOKING has an hour; a tender names a day and occupies none.
 */
export function timedIntervalOf(candidate: Omit<SlotCandidate, 'id' | 'status'>): SlotInterval | null {
  if (candidate.requestType !== ServiceRequestType.DIRECT_BOOKING) return null;
  if (!candidate.anchorAtUtc) return null;
  const startMs = candidate.anchorAtUtc.getTime();

  const duration = candidate.serviceDurationMinutes;
  if (duration !== null && duration > 0) {
    return { startMs, endMs: startMs + duration * MS_PER_MINUTE };
  }
  const windowEndMs = candidate.desiredEndAtUtc?.getTime() ?? null;
  if (windowEndMs !== null && windowEndMs > startMs) {
    return { startMs, endMs: windowEndMs };
  }
  return { startMs, endMs: startMs + APPOINTMENT_DEFAULT_MINUTES * MS_PER_MINUTE };
}

/**
 * Do two half-open intervals overlap? Two appointments that only TOUCH (the
 * end of one is the start of the other) do not.
 */
export function intervalsOverlap(a: SlotInterval, b: SlotInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * The first candidate whose status is in `statuses` and whose time overlaps
 * `window`, or null. A candidate with the id `excludeId` (the request being
 * accepted) is never its own conflict.
 */
export function findSlotConflict(
  window: SlotInterval,
  candidates: readonly SlotCandidate[],
  statuses: readonly ServiceRequestStatus[],
  excludeId: string | null = null,
): SlotCandidate | null {
  for (const candidate of candidates) {
    if (candidate.id === excludeId) continue;
    if (!statuses.includes(candidate.status)) continue;
    const interval = timedIntervalOf(candidate);
    if (interval && intervalsOverlap(window, interval)) return candidate;
  }
  return null;
}
