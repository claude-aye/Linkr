import {
  addDays,
  dateKeyInZone,
  dateKeyUtc,
  daysBetween,
  isDateKey,
  isValidTimeZone,
  isoWeekday,
  zoneOffsetMs,
  zonedTimeToUtcMs,
} from './zoned-time';

const TORONTO = 'America/Toronto';
const HOUR = 3_600_000;

const iso = (ms: number) => new Date(ms).toISOString();

describe('zoned-time', () => {
  describe('isValidTimeZone', () => {
    it('accepts IANA names and refuses everything else', () => {
      expect(isValidTimeZone('America/Toronto')).toBe(true);
      expect(isValidTimeZone('Europe/Paris')).toBe(true);
      expect(isValidTimeZone('Mars/Olympus')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
      expect(isValidTimeZone(null)).toBe(false);
      expect(isValidTimeZone(-5)).toBe(false);
    });
  });

  describe('date keys', () => {
    it('validates the shape AND the calendar', () => {
      expect(isDateKey('2026-11-16')).toBe(true);
      expect(isDateKey('2026-02-30')).toBe(false);
      expect(isDateKey('2026-2-3')).toBe(false);
      expect(isDateKey('nope')).toBe(false);
    });

    it('adds days across months, years and leap days', () => {
      expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(daysBetween('2026-11-16', '2026-11-30')).toBe(14);
    });

    it('gives the ISO weekday (1 = Monday, 7 = Sunday)', () => {
      expect(isoWeekday('2026-11-16')).toBe(1); // a Monday
      expect(isoWeekday('2026-11-21')).toBe(6);
      expect(isoWeekday('2026-11-22')).toBe(7);
    });

    it('reads the civil day IN THE ZONE, not in UTC', () => {
      // 02:30Z on the 17th is still the evening of the 16th in Toronto.
      const ms = Date.parse('2026-11-17T02:30:00Z');
      expect(dateKeyInZone(ms, TORONTO)).toBe('2026-11-16');
      expect(dateKeyUtc(ms)).toBe('2026-11-17');
    });
  });

  describe('zoneOffsetMs', () => {
    it('follows daylight saving time', () => {
      expect(zoneOffsetMs(Date.parse('2026-01-15T12:00:00Z'), TORONTO)).toBe(-5 * HOUR);
      expect(zoneOffsetMs(Date.parse('2026-07-15T12:00:00Z'), TORONTO)).toBe(-4 * HOUR);
    });
  });

  describe('zonedTimeToUtcMs', () => {
    it('maps 9 h in winter and 9 h in summer to DIFFERENT UTC hours', () => {
      // The whole point of a named zone: the wall clock stays, the offset moves.
      expect(iso(zonedTimeToUtcMs('2026-01-15', 9 * 60, TORONTO))).toBe(
        '2026-01-15T14:00:00.000Z',
      );
      expect(iso(zonedTimeToUtcMs('2026-07-15', 9 * 60, TORONTO))).toBe(
        '2026-07-15T13:00:00.000Z',
      );
    });

    it('accepts 1440 as « midnight at the end of the day »', () => {
      expect(zonedTimeToUtcMs('2026-11-16', 1440, TORONTO)).toBe(
        zonedTimeToUtcMs('2026-11-17', 0, TORONTO),
      );
    });

    it('is right on the days the clocks change', () => {
      // Spring forward: 8 March 2026, 02:00 → 03:00 (EST → EDT).
      expect(iso(zonedTimeToUtcMs('2026-03-08', 1 * 60, TORONTO))).toBe(
        '2026-03-08T06:00:00.000Z',
      );
      expect(iso(zonedTimeToUtcMs('2026-03-08', 9 * 60, TORONTO))).toBe(
        '2026-03-08T13:00:00.000Z',
      );
      // Fall back: 1 November 2026, 02:00 → 01:00 (EDT → EST).
      expect(iso(zonedTimeToUtcMs('2026-11-01', 9 * 60, TORONTO))).toBe(
        '2026-11-01T14:00:00.000Z',
      );
      expect(iso(zonedTimeToUtcMs('2026-10-31', 9 * 60, TORONTO))).toBe(
        '2026-10-31T13:00:00.000Z',
      );
    });

    it('slides a wall time that does not exist forward instead of losing it', () => {
      // 02:30 on 8 March 2026 does not exist in Toronto: it reads as 03:30 EDT.
      expect(iso(zonedTimeToUtcMs('2026-03-08', 2 * 60 + 30, TORONTO))).toBe(
        '2026-03-08T07:30:00.000Z',
      );
    });

    it('a day is 23 h or 25 h long across a change, never assumed to be 24', () => {
      const len = (key: string) =>
        (zonedTimeToUtcMs(key, 1440, TORONTO) - zonedTimeToUtcMs(key, 0, TORONTO)) / HOUR;
      expect(len('2026-03-08')).toBe(23);
      expect(len('2026-11-01')).toBe(25);
      expect(len('2026-11-16')).toBe(24);
    });

    it('works east of Greenwich and on half-hour zones', () => {
      expect(iso(zonedTimeToUtcMs('2026-07-15', 9 * 60, 'Europe/Paris'))).toBe(
        '2026-07-15T07:00:00.000Z',
      );
      expect(iso(zonedTimeToUtcMs('2026-07-15', 9 * 60, 'America/St_Johns'))).toBe(
        '2026-07-15T11:30:00.000Z',
      );
    });
  });
});
