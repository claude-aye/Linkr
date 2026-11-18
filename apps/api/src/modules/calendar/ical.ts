import { type DateKey, addDays, parseDateKey } from '../../common/time/zoned-time';

/**
 * A minimal iCalendar (RFC 5545) writer — just what a read-only published
 * calendar needs, and no dependency.
 *
 * Every instant is written in UTC (`…Z`), so the file carries no VTIMEZONE and
 * each calendar app shows the event in its own user's zone. A day-long event
 * is written as a DATE (`VALUE=DATE`), which has no zone at all.
 */

export type IcalTiming =
  | { kind: 'TIMED'; startMs: number; endMs: number }
  /** One civil day. */
  | { kind: 'ALL_DAY'; date: DateKey };

export interface IcalEvent {
  /** Stable across fetches: a calendar app updates the event it already holds. */
  uid: string;
  summary: string;
  description?: string;
  url?: string;
  status: 'CONFIRMED' | 'TENTATIVE';
  timing: IcalTiming;
  /** When the underlying row last changed; falls back to the generation time. */
  lastModifiedMs?: number;
}

export interface IcalCalendar {
  /** Shown as the calendar's name by apps that honour `X-WR-CALNAME`. */
  name: string;
  events: readonly IcalEvent[];
  /** Generation time — `DTSTAMP` of every event. */
  nowMs: number;
}

const CRLF = '\r\n';

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `YYYYMMDDTHHMMSSZ`. */
export function formatUtcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    pad(d.getUTCFullYear(), 4) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function formatDateValue(key: DateKey): string {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`Invalid date key: ${key}`);
  return pad(p.year, 4) + pad(p.month) + pad(p.day);
}

/**
 * TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, and newlines
 * as a literal `\n`. Control characters are dropped — a stray CR or LF in a
 * value would otherwise start a new property line of the writer's choosing.
 */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Folds one content line at 75 OCTETS (RFC 5545 §3.1), never inside a UTF-8
 * sequence: continuation lines start with one space, which counts.
 */
export function foldIcalLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > 75) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join(CRLF);
}

function eventLines(event: IcalEvent, nowMs: number): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcalText(event.uid)}`,
    `DTSTAMP:${formatUtcStamp(nowMs)}`,
    `LAST-MODIFIED:${formatUtcStamp(event.lastModifiedMs ?? nowMs)}`,
  ];
  if (event.timing.kind === 'TIMED') {
    lines.push(`DTSTART:${formatUtcStamp(event.timing.startMs)}`);
    lines.push(`DTEND:${formatUtcStamp(event.timing.endMs)}`);
  } else {
    // DTEND of a DATE event is EXCLUSIVE: one day → the next day.
    lines.push(`DTSTART;VALUE=DATE:${formatDateValue(event.timing.date)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateValue(addDays(event.timing.date, 1))}`);
  }
  lines.push(`SUMMARY:${escapeIcalText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${event.status}`);
  // Every entry takes time: an appointment or a blocked period both read as
  // « busy » in the app that subscribes.
  lines.push('TRANSP:OPAQUE');
  lines.push('END:VEVENT');
  return lines;
}

/** The whole `.ics` document, CRLF-terminated. */
export function buildIcalendar(calendar: IcalCalendar): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Linkr//Calendrier//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcalText(calendar.name)}`,
    // Hints only; each app keeps its own polling rhythm (hours, usually).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of calendar.events) {
    lines.push(...eventLines(event, calendar.nowMs));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcalLine).join(CRLF) + CRLF;
}
