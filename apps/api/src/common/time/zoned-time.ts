/**
 * Wall-clock time in a NAMED time zone ↔ UTC instants, with no dependency.
 *
 * The calendar stores weekly opening hours as WALL TIME (« lundi, 9 h à 17 h »)
 * in the provider's IANA time zone, and everything else as UTC instants. This
 * file is the one bridge between the two.
 *
 * ⚠️ A NAMED ZONE, NEVER A FIXED OFFSET. « America/Toronto » is UTC−5 half of
 * the year and UTC−4 the other half; a stored `-05:00` would publish every
 * summer opening hour one hour late. The offset is therefore resolved PER
 * INSTANT, through `Intl.DateTimeFormat` (full ICU ships with Node 22).
 *
 * A civil day is carried as a `DateKey`, the string `YYYY-MM-DD`: a day has no
 * instant of its own, and wrapping it in a `Date` would smuggle a time zone
 * back in (CLAUDE.md §13.1 nº 17).
 */

/** A civil day, `YYYY-MM-DD`. */
export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // `h23`, not `hour12: false`: the latter prints midnight as « 24 » on
      // some ICU versions, which would land every midnight on the wrong day.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/** True when `timeZone` is an IANA zone this runtime can compute with. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  second: number;
}

/** The wall-clock reading of an instant in `timeZone`. */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** `local − UTC`, in milliseconds, at this instant (negative west of Greenwich). */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // The formatter drops milliseconds; compare against the same truncation.
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } | null {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Round-trip through UTC to refuse « 2026-02-30 ».
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isDateKey(value: unknown): value is DateKey {
  return typeof value === 'string' && parseDateKey(value) !== null;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function toDateKey(year: number, month: number, day: number): DateKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The civil day an instant falls on, in `timeZone`. */
export function dateKeyInZone(utcMs: number, timeZone: string): DateKey {
  const p = zonedParts(utcMs, timeZone);
  return toDateKey(p.year, p.month, p.day);
}

/** The civil day an instant falls on, in UTC (used for date-only values stored at noon UTC). */
export function dateKeyUtc(utcMs: number): DateKey {
  const d = new Date(utcMs);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** `key` shifted by `days` civil days (negative allowed). Pure calendar arithmetic. */
export function addDays(key: DateKey, days: number): DateKey {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * MS_PER_DAY);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole civil days from `a` to `b` (`b − a`). */
export function daysBetween(a: DateKey, b: DateKey): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  if (!pa || !pb) throw new RangeError(`Invalid date key: ${!pa ? a : b}`);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      MS_PER_DAY,
  );
}

/** ISO weekday of a civil day: 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: DateKey): number {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The UTC instant of « `minutes` after local midnight » on civil day `key` in
 * `timeZone`. `minutes` may be 1440 (the end of the day = next midnight).
 *
 * Two passes, the classic way: guess with the offset at the naive instant,
 * then correct with the offset at the guess. One pass is wrong for the hours
 * right around a DST change.
 *
 * DST edges, stated rather than hidden:
 * - a wall time that does NOT exist (spring forward, 02:30) resolves to the
 *   instant one hour later on the clock (03:30) — the opening hour slides, it
 *   does not vanish;
 * - a wall time that exists TWICE (fall back, 01:30) resolves to one of the
 *   two; nothing in the calendar depends on which.
 */
export function zonedTimeToUtcMs(key: DateKey, minutes: number, timeZone: string): number {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const naive = Date.UTC(p.year, p.month - 1, p.day) + minutes * MS_PER_MINUTE;
  const guess = naive - zoneOffsetMs(naive, timeZone);
  const corrected = naive - zoneOffsetMs(guess, timeZone);
  // A wall time inside a DST gap reads back as itself from NEITHER candidate
  // (the two straddle the change). Take the later one: the clock slid forward.
  if (zoneOffsetMs(corrected, timeZone) !== naive - corrected) {
    return Math.max(guess, corrected);
  }
  return corrected;
}
