/**
 * Rules of the provider calendar (web side): time-zone arithmetic, the week and
 * month grids, the layout of overlapping entries, the validation of opening
 * hours and blocked periods, and the messages shown for each HTTP status.
 *
 * ⚠️ IMPORT-FREE BY CONTRACT. `node --test` loads this file as-is (the CI web
 * job installs nothing), and both Server and Client Components import it. It
 * must not import anything — not the generated API types, not `@/…`.
 *
 * ⚠️ THE CALENDAR IS RENDERED IN THE CALENDAR'S OWN TIME ZONE, the IANA name
 * the API returns (`timeZone`), never the browser's and never a fixed offset.
 * Every function that turns an instant into a wall-clock position takes that
 * zone as a parameter. The zone arithmetic below is the web twin of
 * `apps/api/src/common/time/zoned-time.ts`; the two are kept in step by hand
 * and by the same test cases (DST days included).
 */

// ── Limits mirrored from the API (`modules/calendar/constants.ts`) ───────────
// Held together by `scripts/check-mirrored-constants.mjs`: literals on purpose.

export const WEEKLY_HOURS_STEP_MINUTES = 15;
export const WEEKLY_HOURS_MAX_RANGES_PER_DAY = 4;
export const TIME_OFF_LABEL_MAX = 80;
export const TIME_OFF_MAX_DAYS = 366;
export const TIME_OFF_MAX_UPCOMING = 50;

/** Web-only: the zone assumed BEFORE the API has said which one the calendar uses. */
export const CALENDAR_DEFAULT_TIME_ZONE = 'America/Toronto';

/** Web path of the calendar page. Quasi-immutable: every exported `.ics` links to it. */
export const CALENDAR_PATH = '/calendrier';
/** Prefix of the public feed relay. Quasi-immutable: it is inside subscribed URLs. */
export const CALENDAR_FEED_PREFIX = '/calendrier/flux/';
/** Authenticated one-off download. */
export const CALENDAR_EXPORT_PATH = '/calendrier/export';

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** A civil day, `YYYY-MM-DD`. Never wrapped in a `Date` (§13.1 nº 17). */
export type DateKey = string;

export type CalendarView = 'semaine' | 'mois';

// ── Zone arithmetic ─────────────────────────────────────────────────────────

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(timeZone, fmt);
  }
  return fmt;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(utcMs))) {
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

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function toDateKey(year: number, month: number, day: number): DateKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseDateKey(
  key: string,
): { year: number; month: number; day: number } | null {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
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

/** The civil day an instant falls on, in `timeZone`. */
export function dateKeyInZone(utcMs: number, timeZone: string): DateKey {
  const p = zonedParts(utcMs, timeZone);
  return toDateKey(p.year, p.month, p.day);
}

/** Minutes after local midnight of an instant, on the wall clock of `timeZone`. */
export function minuteOfDayInZone(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  return p.hour * 60 + p.minute;
}

export function addDays(key: DateKey, days: number): DateKey {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * MS_PER_DAY);
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: DateKey): number {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The UTC instant of « `minutes` after local midnight » on `key` in
 * `timeZone` (1440 = the next midnight). Two passes; a wall time inside a DST
 * gap slides forward. Same algorithm as the API.
 */
export function zonedTimeToUtcMs(key: DateKey, minutes: number, timeZone: string): number {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const naive = Date.UTC(p.year, p.month - 1, p.day) + minutes * MS_PER_MINUTE;
  const guess = naive - zoneOffsetMs(naive, timeZone);
  const corrected = naive - zoneOffsetMs(guess, timeZone);
  if (zoneOffsetMs(corrected, timeZone) !== naive - corrected) {
    return Math.max(guess, corrected);
  }
  return corrected;
}

// ── Week and month grids ────────────────────────────────────────────────────

/**
 * The Sunday on or before `key`. Weeks START ON SUNDAY here, the convention of
 * calendars in Québec (and what Outlook and Google show by default in fr-CA).
 * The stored weekday stays ISO (1 = Monday): only the DISPLAY starts on Sunday.
 */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -(isoWeekday(key) % 7));
}

export function weekDays(weekStart: DateKey): DateKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** First day of the month `key` belongs to. */
export function startOfMonth(key: DateKey): DateKey {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  return toDateKey(p.year, p.month, 1);
}

/** The weeks (Sunday → Saturday) that cover the month of `key`: 4 to 6 rows. */
export function monthWeeks(key: DateKey): DateKey[][] {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  const first = toDateKey(p.year, p.month, 1);
  const weeks: DateKey[][] = [];
  let cursor = startOfWeek(first);
  for (;;) {
    const week = weekDays(cursor);
    weeks.push(week);
    cursor = addDays(cursor, 7);
    const next = parseDateKey(cursor);
    if (!next || next.year !== p.year || next.month !== p.month) break;
  }
  return weeks;
}

/** Same month as `reference`? (Greys out the leading and trailing days of a month grid.) */
export function isSameMonth(key: DateKey, reference: DateKey): boolean {
  return key.slice(0, 7) === reference.slice(0, 7);
}

/** `?vue=` → a view. Anything unknown is the week. */
export function parseView(raw: unknown): CalendarView {
  return raw === 'mois' ? 'mois' : 'semaine';
}

/** `?date=` → the anchor day, or `today` when absent or malformed. */
export function parseAnchor(raw: unknown, today: DateKey): DateKey {
  return isDateKey(raw) ? raw : today;
}

/** The anchor one step earlier (`-1`) or later (`+1`): a week, or a month. */
export function shiftAnchor(view: CalendarView, anchor: DateKey, direction: -1 | 1): DateKey {
  if (view === 'semaine') return addDays(anchor, 7 * direction);
  const p = parseDateKey(anchor);
  if (!p) throw new RangeError(`Invalid date key: ${anchor}`);
  // The 1st of the neighbouring month: every month has one, so « 31 January +
  // 1 month » cannot overflow into March.
  const d = new Date(Date.UTC(p.year, p.month - 1 + direction, 1));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** The civil days a view shows, in order. */
export function viewDays(view: CalendarView, anchor: DateKey): DateKey[] {
  return view === 'semaine' ? weekDays(startOfWeek(anchor)) : monthWeeks(anchor).flat();
}

/** `/calendrier?vue=…&date=…` — the URL is the state (no client store). */
export function calendarHref(view: CalendarView, anchor: DateKey | null): string {
  const params = new URLSearchParams();
  if (view !== 'semaine') params.set('vue', view);
  if (anchor) params.set('date', anchor);
  const query = params.toString();
  return query ? `${CALENDAR_PATH}?${query}` : CALENDAR_PATH;
}

// ── Labels (fr-CA) ──────────────────────────────────────────────────────────

/** « 9 h 00 », « 13 h 30 ». 1440 reads « minuit ». Pure: no Intl, no zone. */
export function minutesLabel(minutes: number): string {
  if (minutes === MINUTES_PER_DAY) return 'minuit';
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`;
}

/** « 9 h 00 – 12 h 00 ». */
export function minutesRangeLabel(startMinute: number, endMinute: number): string {
  return `${minutesLabel(startMinute)} – ${minutesLabel(endMinute)}`;
}

/** Wall-clock label of an instant in the calendar's zone, same shape as {@link minutesLabel}. */
export function timeLabel(utcMs: number, timeZone: string): string {
  return minutesLabel(minuteOfDayInZone(utcMs, timeZone));
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
};

export const WEEKDAY_SHORT_LABELS: Record<number, string> = {
  1: 'lun.',
  2: 'mar.',
  3: 'mer.',
  4: 'jeu.',
  5: 'ven.',
  6: 'sam.',
  7: 'dim.',
};

/** Weekdays in DISPLAY order (Sunday first), as ISO numbers. */
export const WEEKDAY_DISPLAY_ORDER = [7, 1, 2, 3, 4, 5, 6] as const;

/**
 * A civil day, formatted. The day is pinned at noon UTC and formatted IN UTC:
 * formatting a `YYYY-MM-DD` in a zone west of Greenwich would show the day
 * before (the `admin/demand-signals` rule, §13.1 nº 17b).
 */
function civilDate(key: DateKey): Date {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
}

const dayLongFmt = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const dayMediumFmt = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayMonthFmt = new Intl.DateTimeFormat('fr-CA', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const dayMonthYearFmt = new Intl.DateTimeFormat('fr-CA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthYearFmt = new Intl.DateTimeFormat('fr-CA', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** « lundi 16 novembre ». */
export function dayLongLabel(key: DateKey): string {
  return dayLongFmt.format(civilDate(key));
}

/** « lun. 16 nov. ». */
export function dayMediumLabel(key: DateKey): string {
  return dayMediumFmt.format(civilDate(key));
}

/** « novembre 2026 ». */
export function monthLabel(key: DateKey): string {
  return monthYearFmt.format(civilDate(key));
}

/** Title of the period a view shows: « 15 au 21 novembre 2026 », « novembre 2026 ». */
export function periodLabel(view: CalendarView, anchor: DateKey): string {
  if (view === 'mois') return monthLabel(anchor);
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  const from = parseDateKey(start);
  const to = parseDateKey(end);
  if (!from || !to) return '';
  if (from.month === to.month) {
    return `${from.day} au ${dayMonthYearFmt.format(civilDate(end))}`;
  }
  if (from.year === to.year) {
    return `${dayMonthFmt.format(civilDate(start))} au ${dayMonthYearFmt.format(civilDate(end))}`;
  }
  return `${dayMonthYearFmt.format(civilDate(start))} au ${dayMonthYearFmt.format(civilDate(end))}`;
}

/**
 * A period (blocked time), in words, in the calendar's zone:
 * - whole days → « lun. 16 nov., toute la journée », « du jeu. 24 déc. au sam. 2 janv. » ;
 * - otherwise → « lun. 16 nov., 13 h 00 – 15 h 00 »,
 *   « du lun. 16 nov. à 13 h 00 au mar. 17 nov. à 15 h 00 ».
 * A period that ends at midnight ends ON THE DAY BEFORE, as a person would say it.
 */
export function periodWhenLabel(startMs: number, endMs: number, timeZone: string): string {
  const startKey = dateKeyInZone(startMs, timeZone);
  const startMinute = minuteOfDayInZone(startMs, timeZone);
  const endMinute = minuteOfDayInZone(endMs, timeZone);
  const endsAtMidnight = endMinute === 0;
  const rawEndKey = dateKeyInZone(endMs, timeZone);
  const lastKey = endsAtMidnight && rawEndKey > startKey ? addDays(rawEndKey, -1) : rawEndKey;

  if (startMinute === 0 && endsAtMidnight) {
    return lastKey === startKey
      ? `${dayMediumLabel(startKey)}, toute la journée`
      : `du ${dayMediumLabel(startKey)} au ${dayMediumLabel(lastKey)}`;
  }
  const endLabel = endsAtMidnight ? minutesLabel(MINUTES_PER_DAY) : minutesLabel(endMinute);
  if (lastKey === startKey) {
    return `${dayMediumLabel(startKey)}, ${minutesLabel(startMinute)} – ${endLabel}`;
  }
  return `du ${dayMediumLabel(startKey)} à ${minutesLabel(startMinute)} au ${dayMediumLabel(lastKey)} à ${endLabel}`;
}

/** « 45 min », « 1 h », « 1 h 30 ». */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${pad(rest)}`;
}

// ── Layout of a day column ──────────────────────────────────────────────────

/** Something that takes time: an appointment or a blocked period. */
export interface TimedItem {
  id: string;
  startMs: number;
  endMs: number;
}

/** A {@link TimedItem} placed in one day column. */
export interface DayBlock {
  id: string;
  /** Minutes after local midnight, clipped to the day. */
  startMinute: number;
  endMinute: number;
  /** True when the item began before this day / continues after it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Side-by-side placement among the items it overlaps: column `column` of `columns`. */
  column: number;
  columns: number;
}

/** A block is never drawn shorter than this, or its label would not fit. */
export const MIN_BLOCK_MINUTES = 30;

/**
 * Places the items that touch civil day `date` in its column.
 *
 * Positions are WALL-CLOCK minutes in `timeZone`, not « milliseconds since the
 * day's midnight »: on the two days a year the clocks change, those differ by
 * an hour, and 10 h must still be drawn at the 10 h line.
 *
 * Overlapping items share the width: each cluster of mutually reachable
 * overlaps is split into as many columns as its deepest overlap, the classic
 * calendar layout.
 */
export function layoutDay(
  items: readonly TimedItem[],
  date: DateKey,
  timeZone: string,
): DayBlock[] {
  const dayStartMs = zonedTimeToUtcMs(date, 0, timeZone);
  const dayEndMs = zonedTimeToUtcMs(date, MINUTES_PER_DAY, timeZone);

  const blocks: DayBlock[] = [];
  for (const item of items) {
    if (!(item.endMs > dayStartMs && item.startMs < dayEndMs)) continue;
    const continuesBefore = item.startMs < dayStartMs;
    const continuesAfter = item.endMs > dayEndMs;
    const startMinute = continuesBefore ? 0 : minuteOfDayInZone(item.startMs, timeZone);
    const rawEnd =
      continuesAfter || item.endMs === dayEndMs
        ? MINUTES_PER_DAY
        : minuteOfDayInZone(item.endMs, timeZone);
    blocks.push({
      id: item.id,
      startMinute,
      // Never before its own start (a DST fold could otherwise invert them).
      endMinute: Math.max(rawEnd, startMinute),
      continuesBefore,
      continuesAfter,
      column: 0,
      columns: 1,
    });
  }

  blocks.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  // What a block occupies on screen (its minimum height included): two short
  // appointments 10 minutes apart must not be drawn on top of each other.
  const visualEnd = (b: DayBlock) =>
    Math.max(b.endMinute, Math.min(b.startMinute + MIN_BLOCK_MINUTES, MINUTES_PER_DAY));

  let cluster: DayBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columnEnds: number[] = [];
    for (const block of cluster) {
      let column = columnEnds.findIndex((end) => end <= block.startMinute);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = visualEnd(block);
      block.column = column;
    }
    for (const block of cluster) block.columns = columnEnds.length;
    cluster = [];
    clusterEnd = -1;
  };

  for (const block of blocks) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) flush();
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, visualEnd(block));
  }
  if (cluster.length > 0) flush();

  return blocks;
}

/** Hours the week grid shows when nothing forces more: 7 h to 19 h. */
export const DEFAULT_GRID_START_MINUTE = 7 * 60;
export const DEFAULT_GRID_END_MINUTE = 19 * 60;

/**
 * The vertical span of the week grid, in whole hours: wide enough for every
 * block and every opening range, and never narrower than 7 h–19 h.
 */
export function gridSpan(
  ranges: ReadonlyArray<{ startMinute: number; endMinute: number }>,
): { startMinute: number; endMinute: number } {
  let start = DEFAULT_GRID_START_MINUTE;
  let end = DEFAULT_GRID_END_MINUTE;
  for (const r of ranges) {
    start = Math.min(start, Math.floor(r.startMinute / 60) * 60);
    end = Math.max(end, Math.ceil(r.endMinute / 60) * 60);
  }
  return { startMinute: Math.max(0, start), endMinute: Math.min(MINUTES_PER_DAY, end) };
}

// ── Weekly opening hours ────────────────────────────────────────────────────

export interface WeeklyRange {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** The ranges of one weekday, in order. */
export function rangesOfWeekday(
  ranges: readonly WeeklyRange[],
  weekday: number,
): WeeklyRange[] {
  return ranges
    .filter((r) => r.weekday === weekday)
    .sort((a, b) => a.startMinute - b.startMinute);
}

/** Options of a time `<select>`: every quarter-hour. `includeMidnightEnd` adds 1440 (an END only). */
export function timeOptions(includeMidnightEnd: boolean): number[] {
  const out: number[] = [];
  for (let m = 0; m < MINUTES_PER_DAY; m += WEEKLY_HOURS_STEP_MINUTES) out.push(m);
  if (includeMidnightEnd) out.push(MINUTES_PER_DAY);
  return out;
}

/**
 * Why a weekly schedule cannot be saved, in French — or `null` when it can.
 * The same rules as the API's `normaliseWeeklyHours`, so a 422 is unexpected.
 */
export function weeklyHoursError(ranges: readonly WeeklyRange[]): string | null {
  for (const r of ranges) {
    if (
      !Number.isInteger(r.weekday) ||
      r.weekday < 1 ||
      r.weekday > 7 ||
      !Number.isInteger(r.startMinute) ||
      !Number.isInteger(r.endMinute) ||
      r.startMinute < 0 ||
      r.endMinute > MINUTES_PER_DAY
    ) {
      return 'Une plage horaire est invalide.';
    }
    if (r.startMinute >= r.endMinute) {
      return `${WEEKDAY_LABELS[r.weekday]} : la fin d’une plage doit être après son début.`;
    }
    if (
      r.startMinute % WEEKLY_HOURS_STEP_MINUTES !== 0 ||
      r.endMinute % WEEKLY_HOURS_STEP_MINUTES !== 0
    ) {
      return 'Les heures se choisissent au quart d’heure.';
    }
  }
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const day = rangesOfWeekday(ranges, weekday);
    if (day.length > WEEKLY_HOURS_MAX_RANGES_PER_DAY) {
      return `${WEEKDAY_LABELS[weekday]} : au plus ${WEEKLY_HOURS_MAX_RANGES_PER_DAY} plages par jour.`;
    }
    for (let i = 1; i < day.length; i += 1) {
      if (day[i].startMinute < day[i - 1].endMinute) {
        return `${WEEKDAY_LABELS[weekday]} : deux plages se chevauchent.`;
      }
    }
  }
  return null;
}

/** The body of `PUT …/weekly-hours`, field by field — or `null` when the input is not a schedule. */
export function assembleWeeklyHoursBody(
  incoming: unknown,
): { weeklyHours: WeeklyRange[] } | null {
  const source = (incoming ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source.weeklyHours)) return null;
  const weeklyHours: WeeklyRange[] = [];
  for (const raw of source.weeklyHours) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof r.weekday !== 'number' ||
      typeof r.startMinute !== 'number' ||
      typeof r.endMinute !== 'number'
    ) {
      return null;
    }
    weeklyHours.push({
      weekday: r.weekday,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    });
  }
  return { weeklyHours };
}

/** A new range offered when the provider adds one to a weekday: after the last, or 9 h–17 h. */
export function suggestRange(day: readonly WeeklyRange[], weekday: number): WeeklyRange | null {
  if (day.length >= WEEKLY_HOURS_MAX_RANGES_PER_DAY) return null;
  if (day.length === 0) return { weekday, startMinute: 9 * 60, endMinute: 17 * 60 };
  const lastEnd = Math.max(...day.map((r) => r.endMinute));
  const startMinute = Math.min(lastEnd + 60, MINUTES_PER_DAY - 60);
  if (startMinute < lastEnd) return null;
  return {
    weekday,
    startMinute,
    endMinute: Math.min(startMinute + 180, MINUTES_PER_DAY),
  };
}

// ── Blocked periods ─────────────────────────────────────────────────────────

export interface TimeOffInput {
  startMs: number | null;
  endMs: number | null;
  label: string;
}

export type TimeOffField = 'start' | 'end' | 'label';

export type TimeOffAssembly =
  | { ok: true; body: { startsAtUtc: string; endsAtUtc: string; label: string | null } }
  | { ok: false; field: TimeOffField; message: string };

/** Validates a blocked period with the API's own rules and builds the body. Clock passed in. */
export function assembleTimeOff(input: TimeOffInput, nowMs: number): TimeOffAssembly {
  if (input.startMs === null) {
    return { ok: false, field: 'start', message: 'Indiquez le début de la période.' };
  }
  if (input.endMs === null) {
    return { ok: false, field: 'end', message: 'Indiquez la fin de la période.' };
  }
  if (input.endMs <= input.startMs) {
    return { ok: false, field: 'end', message: 'La fin doit être après le début.' };
  }
  if (input.endMs <= nowMs) {
    return { ok: false, field: 'end', message: 'Cette période est déjà terminée.' };
  }
  if (input.endMs - input.startMs > TIME_OFF_MAX_DAYS * MS_PER_DAY) {
    return {
      ok: false,
      field: 'end',
      message: `Une période ne peut pas dépasser ${TIME_OFF_MAX_DAYS} jours.`,
    };
  }
  const label = input.label.trim();
  if (label.length > TIME_OFF_LABEL_MAX) {
    return {
      ok: false,
      field: 'label',
      message: `La note ne peut pas dépasser ${TIME_OFF_LABEL_MAX} caractères.`,
    };
  }
  return {
    ok: true,
    body: {
      startsAtUtc: new Date(input.startMs).toISOString(),
      endsAtUtc: new Date(input.endMs).toISOString(),
      label: label === '' ? null : label,
    },
  };
}

/** The body of `POST …/time-off`, field by field — or `null` when the shape is wrong. */
export function assembleTimeOffBody(
  incoming: unknown,
): { startsAtUtc: string; endsAtUtc: string; label: string | null } | null {
  const source = (incoming ?? {}) as Record<string, unknown>;
  const { startsAtUtc, endsAtUtc, label } = source;
  if (typeof startsAtUtc !== 'string' || typeof endsAtUtc !== 'string') return null;
  if (label !== undefined && label !== null && typeof label !== 'string') return null;
  return { startsAtUtc, endsAtUtc, label: typeof label === 'string' ? label : null };
}

// ── Messages, by HTTP status alone (lock 3.12b) ─────────────────────────────

export const UNAVAILABLE_MESSAGE =
  'Le service est momentanément indisponible. Réessayez plus tard.';
export const SESSION_EXPIRED_MESSAGE =
  'Votre session a expiré. Veuillez vous reconnecter.';
const TOO_MANY_MESSAGE =
  'Vous avez fait beaucoup de modifications. Patientez un peu avant de réessayer.';
const NO_PROVIDER_MESSAGE = 'Votre profil prestataire est introuvable. Actualisez la page.';

/**
 * ⚠️ A 403 here is ALWAYS « adresse non confirmée » (the routes are the
 * caller's own; the only 403 they can answer is the verified-email guard), but
 * the caller still checks the body's code through `isEmailNotVerified` before
 * showing the dedicated message. This is the fallback wording.
 */
const FORBIDDEN_MESSAGE = 'Cette action ne vous est pas permise.';

export function weeklyHoursErrorMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'Ces heures ne sont pas valides. Vérifiez les plages, puis réessayez.';
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 403:
      return FORBIDDEN_MESSAGE;
    case 404:
      return NO_PROVIDER_MESSAGE;
    case 429:
      return TOO_MANY_MESSAGE;
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

export function timeOffCreateErrorMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'Cette période n’est pas valide. Vérifiez les dates, puis réessayez.';
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 403:
      return FORBIDDEN_MESSAGE;
    case 404:
      return NO_PROVIDER_MESSAGE;
    case 409:
      return `Vous avez déjà ${TIME_OFF_MAX_UPCOMING} périodes à venir. Supprimez-en une pour en ajouter une autre.`;
    case 429:
      return TOO_MANY_MESSAGE;
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

export function timeOffDeleteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 404:
      return 'Cette période n’existe plus. La page va être actualisée.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

export function feedErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return SESSION_EXPIRED_MESSAGE;
    case 403:
      return FORBIDDEN_MESSAGE;
    case 404:
      return NO_PROVIDER_MESSAGE;
    case 429:
      return 'Vous avez généré beaucoup de liens. Patientez un peu avant de réessayer.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

// ── Subscription link ───────────────────────────────────────────────────────

const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Is this pathname the public iCal feed? Used by `proxy.ts` to let it through
 * WITHOUT a session: a calendar app has no cookie, the token in the path is the
 * credential. Exactly one segment after the prefix, and it must LOOK like a
 * token (an optional `.ics` suffix is tolerated) — `/calendrier/flux/` alone or
 * anything deeper stays protected.
 */
export function isCalendarFeedPath(pathname: string): boolean {
  if (!pathname.startsWith(CALENDAR_FEED_PREFIX)) return false;
  return feedTokenFromSegment(pathname.slice(CALENDAR_FEED_PREFIX.length)) !== null;
}

/** The token carried by the last path segment (`<token>` or `<token>.ics`), or `null`. */
export function feedTokenFromSegment(segment: string): string | null {
  const token = segment.endsWith('.ics') ? segment.slice(0, -4) : segment;
  return FEED_TOKEN_RE.test(token) ? token : null;
}

export interface FeedLinks {
  /** The address to paste into « s'abonner à un calendrier ». */
  httpsUrl: string;
  /** Same address with the `webcal:` scheme: opens the default calendar app. */
  webcalUrl: string;
  /** One-click subscription pages. */
  googleUrl: string;
  outlookUrl: string;
}

/**
 * The ways to subscribe to a feed. `origin` is the site's own
 * (`window.location.origin`), `path` what the API returned (`/calendrier/flux/…`).
 * `.ics` is appended: some apps only recognise a calendar by its extension.
 */
export function feedLinks(origin: string, path: string): FeedLinks {
  const httpsUrl = `${origin.replace(/\/+$/, '')}${path}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:/, 'webcal:');
  return {
    httpsUrl,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
    outlookUrl: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent('Linkr')}`,
  };
}

// ── Availability, as a client sees it ───────────────────────────────────────

export interface FreeSlot {
  startMs: number;
  endMs: number;
}

/** Step between the start times offered inside a free interval. */
export const START_TIME_STEP_MINUTES = 30;

/**
 * The start times a client may pick inside free intervals: every half-hour
 * from the start of each interval, as long as `durationMinutes` still fits
 * before its end. Deduplicated and sorted.
 */
export function startTimesInSlots(
  slots: readonly FreeSlot[],
  durationMinutes: number,
): number[] {
  const duration = Math.max(durationMinutes, 1) * MS_PER_MINUTE;
  const step = START_TIME_STEP_MINUTES * MS_PER_MINUTE;
  const out = new Set<number>();
  for (const slot of slots) {
    for (let start = slot.startMs; start + duration <= slot.endMs; start += step) {
      out.add(start);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Does `[startMs, endMs)` sit entirely inside one free interval? */
export function isWithinSlots(
  startMs: number,
  endMs: number,
  slots: readonly FreeSlot[],
): boolean {
  return slots.some((slot) => startMs >= slot.startMs && endMs <= slot.endMs);
}

/** Does an appointment STARTING at `startMs` fall inside a free interval? */
export function startsWithinSlots(startMs: number, slots: readonly FreeSlot[]): boolean {
  return slots.some((slot) => startMs >= slot.startMs && startMs < slot.endMs);
}

/** The API's availability, as it travels (ISO instants). */
export interface AvailabilityDayWire {
  date: DateKey;
  slots: ReadonlyArray<{ startAtUtc: string; endAtUtc: string }>;
}

export function toFreeSlots(days: readonly AvailabilityDayWire[]): FreeSlot[] {
  return days.flatMap((day) =>
    day.slots.map((slot) => ({
      startMs: Date.parse(slot.startAtUtc),
      endMs: Date.parse(slot.endAtUtc),
    })),
  );
}

/** The window a picked start time proposes is at least this long (the form's own default). */
export const PICKED_WINDOW_MIN_MINUTES = 120;

export interface StartTimeDay {
  date: DateKey;
  /** « mar. 17 nov. ». */
  label: string;
  /** « mardi 17 novembre ». */
  longLabel: string;
  times: Array<{ startIso: string; endIso: string; label: string }>;
}

/**
 * Availability turned into the days and start times of the booking picker,
 * every label in the PROVIDER'S zone.
 *
 * Picking a time proposes a window: from that time, for the longer of the
 * service's duration and PICKED_WINDOW_MIN_MINUTES — but never past the end of
 * the free interval it sits in (the client is offering a margin, not promising
 * time the provider has not opened).
 */
export function startTimeDays(
  days: readonly AvailabilityDayWire[],
  timeZone: string,
  durationMinutes: number,
): StartTimeDay[] {
  const windowMs = Math.max(durationMinutes, PICKED_WINDOW_MIN_MINUTES) * MS_PER_MINUTE;
  return days.map((day) => {
    const times: StartTimeDay['times'] = [];
    for (const wire of day.slots) {
      const slot: FreeSlot = {
        startMs: Date.parse(wire.startAtUtc),
        endMs: Date.parse(wire.endAtUtc),
      };
      for (const startMs of startTimesInSlots([slot], durationMinutes)) {
        times.push({
          startIso: new Date(startMs).toISOString(),
          endIso: new Date(Math.min(slot.endMs, startMs + windowMs)).toISOString(),
          label: timeLabel(startMs, timeZone),
        });
      }
    }
    times.sort((a, b) => a.startIso.localeCompare(b.startIso));
    return {
      date: day.date,
      label: dayMediumLabel(day.date),
      longLabel: dayLongLabel(day.date),
      times,
    };
  });
}

/** « 9 h 00 – 10 h 00 » for each free interval of a day, in the provider's zone. */
export function slotLabels(day: AvailabilityDayWire, timeZone: string): string[] {
  return day.slots.map((slot) => {
    const endMs = Date.parse(slot.endAtUtc);
    // An interval that runs to the end of the day ends at « minuit », not « 0 h 00 ».
    const endMinute = minuteOfDayInZone(endMs, timeZone);
    const endLabel = endMinute === 0 ? minutesLabel(MINUTES_PER_DAY) : minutesLabel(endMinute);
    return `${timeLabel(Date.parse(slot.startAtUtc), timeZone)} – ${endLabel}`;
  });
}

/** « heure de l’Est » — the generic name of a zone, or its IANA id when Intl has none. */
export function zoneGenericLabel(timeZone: string, atMs: number): string {
  try {
    const name = new Intl.DateTimeFormat('fr-CA', { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date(atMs))
      .find((part) => part.type === 'timeZoneName')?.value;
    return name ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** « lundi : 9 h 00 – 17 h 00 » rows of a published schedule, Sunday first, closed days included. */
export function weeklyHoursSummary(
  ranges: readonly WeeklyRange[],
): Array<{ weekday: number; label: string; hours: string | null }> {
  return WEEKDAY_DISPLAY_ORDER.map((weekday) => {
    const day = rangesOfWeekday(ranges, weekday);
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      hours:
        day.length === 0
          ? null
          : day.map((r) => minutesRangeLabel(r.startMinute, r.endMinute)).join(', '),
    };
  });
}
