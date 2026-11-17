import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { computeAvailability, subtractIntervals } from './availability';
import { resolveEventTiming } from './event-timing';
import { buildIcalendar, escapeIcalText, foldIcalLine, formatUtcStamp } from './ical';
import { normaliseWeeklyHours, readWeeklyHours } from './weekly-hours';

const TORONTO = 'America/Toronto';
const utc = (isoString: string) => Date.parse(isoString);
const iso = (ms: number) => new Date(ms).toISOString();

describe('normaliseWeeklyHours', () => {
  it('sorts, and merges ranges that touch', () => {
    const result = normaliseWeeklyHours([
      { weekday: 2, startMinute: 780, endMinute: 1020 },
      { weekday: 1, startMinute: 720, endMinute: 1020 },
      { weekday: 1, startMinute: 540, endMinute: 720 },
    ]);
    expect(result).toEqual({
      ok: true,
      ranges: [
        { weekday: 1, startMinute: 540, endMinute: 1020 },
        { weekday: 2, startMinute: 780, endMinute: 1020 },
      ],
    });
  });

  it('accepts an empty schedule (nothing published) and « until midnight »', () => {
    expect(normaliseWeeklyHours([])).toEqual({ ok: true, ranges: [] });
    expect(normaliseWeeklyHours([{ weekday: 7, startMinute: 1200, endMinute: 1440 }]).ok).toBe(
      true,
    );
  });

  it.each([
    ['not an array', { weekday: 1 }, 'NOT_AN_ARRAY'],
    ['weekday 0', [{ weekday: 0, startMinute: 0, endMinute: 60 }], 'BAD_RANGE'],
    ['weekday 8', [{ weekday: 8, startMinute: 0, endMinute: 60 }], 'BAD_RANGE'],
    ['end before start', [{ weekday: 1, startMinute: 600, endMinute: 540 }], 'BAD_RANGE'],
    ['empty range', [{ weekday: 1, startMinute: 540, endMinute: 540 }], 'BAD_RANGE'],
    ['past midnight', [{ weekday: 1, startMinute: 1380, endMinute: 1500 }], 'BAD_RANGE'],
    ['fractional', [{ weekday: 1, startMinute: 540.5, endMinute: 600 }], 'BAD_RANGE'],
    ['a string', [{ weekday: '1', startMinute: 540, endMinute: 600 }], 'BAD_RANGE'],
    ['null entry', [null], 'BAD_RANGE'],
    ['off the quarter-hour', [{ weekday: 1, startMinute: 545, endMinute: 600 }], 'OFF_GRID'],
    [
      'overlap',
      [
        { weekday: 3, startMinute: 540, endMinute: 720 },
        { weekday: 3, startMinute: 660, endMinute: 780 },
      ],
      'OVERLAP',
    ],
    [
      'five ranges in a day',
      [0, 1, 2, 3, 4].map((i) => ({
        weekday: 4,
        startMinute: i * 120,
        endMinute: i * 120 + 60,
      })),
      'TOO_MANY_RANGES',
    ],
  ])('refuses %s', (_label, input, violation) => {
    expect(normaliseWeeklyHours(input)).toEqual({ ok: false, violation });
  });

  it('the same overlap on two DIFFERENT weekdays is fine', () => {
    expect(
      normaliseWeeklyHours([
        { weekday: 3, startMinute: 540, endMinute: 720 },
        { weekday: 4, startMinute: 540, endMinute: 720 },
      ]).ok,
    ).toBe(true);
  });

  it('reads a damaged stored value as « no schedule », never a throw', () => {
    expect(readWeeklyHours('garbage')).toEqual([]);
    expect(readWeeklyHours([{ weekday: 99 }])).toEqual([]);
    expect(readWeeklyHours(null)).toEqual([]);
  });
});

describe('subtractIntervals', () => {
  const base = { startMs: 100, endMs: 200 };

  it('cuts the middle, the edges, everything, or nothing', () => {
    expect(subtractIntervals(base, [{ startMs: 120, endMs: 150 }])).toEqual([
      { startMs: 100, endMs: 120 },
      { startMs: 150, endMs: 200 },
    ]);
    expect(subtractIntervals(base, [{ startMs: 50, endMs: 130 }])).toEqual([
      { startMs: 130, endMs: 200 },
    ]);
    expect(subtractIntervals(base, [{ startMs: 180, endMs: 400 }])).toEqual([
      { startMs: 100, endMs: 180 },
    ]);
    expect(subtractIntervals(base, [{ startMs: 0, endMs: 500 }])).toEqual([]);
    expect(subtractIntervals(base, [{ startMs: 200, endMs: 300 }])).toEqual([base]);
    expect(subtractIntervals(base, [{ startMs: 0, endMs: 100 }])).toEqual([base]);
  });

  it('handles unsorted, overlapping holes', () => {
    expect(
      subtractIntervals(base, [
        { startMs: 160, endMs: 170 },
        { startMs: 110, endMs: 130 },
        { startMs: 125, endMs: 140 },
      ]),
    ).toEqual([
      { startMs: 100, endMs: 110 },
      { startMs: 140, endMs: 160 },
      { startMs: 170, endMs: 200 },
    ]);
  });
});

describe('computeAvailability', () => {
  // Monday 16 November 2026 — EST, UTC−5.
  const monday9to17 = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
  const longAgo = utc('2026-01-01T00:00:00Z');

  const compute = (over: Partial<Parameters<typeof computeAvailability>[0]> = {}) =>
    computeAvailability({
      timeZone: TORONTO,
      weeklyHours: monday9to17,
      blocked: [],
      fromDate: '2026-11-16',
      days: 1,
      notBeforeMs: longAgo,
      ...over,
    });

  const slots = (days: ReturnType<typeof compute>) =>
    days.flatMap((d) => d.slots.map((s) => [iso(s.startMs), iso(s.endMs)]));

  it('offers the opening hours of the weekday, in the zone', () => {
    expect(slots(compute())).toEqual([
      ['2026-11-16T14:00:00.000Z', '2026-11-16T22:00:00.000Z'],
    ]);
  });

  it('offers nothing on a weekday with no hours, and keeps the day in the list', () => {
    const days = compute({ fromDate: '2026-11-17' });
    expect(days).toEqual([{ date: '2026-11-17', slots: [] }]);
  });

  it('keeps 9 h at 9 h across the daylight-saving change', () => {
    // Monday 26 October 2026 is still EDT (UTC−4); the next Monday is EST.
    const days = compute({ fromDate: '2026-10-26', days: 8 });
    expect(slots(days).map(([start]) => start)).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  it('removes an appointment from the middle of the day', () => {
    const blocked = [
      { startMs: utc('2026-11-16T16:00:00Z'), endMs: utc('2026-11-16T17:00:00Z') },
    ];
    expect(slots(compute({ blocked }))).toEqual([
      ['2026-11-16T14:00:00.000Z', '2026-11-16T16:00:00.000Z'],
      ['2026-11-16T17:00:00.000Z', '2026-11-16T22:00:00.000Z'],
    ]);
  });

  it('a blocked period covering the day leaves nothing', () => {
    const blocked = [
      { startMs: utc('2026-11-15T00:00:00Z'), endMs: utc('2026-11-18T00:00:00Z') },
    ];
    expect(slots(compute({ blocked }))).toEqual([]);
  });

  it('never offers the past nor the lead time, and starts on the quarter-hour', () => {
    // « Now + lead » falls at 11 h 07 local: the first offered minute is 11 h 15.
    const notBeforeMs = utc('2026-11-16T16:07:00Z');
    expect(slots(compute({ notBeforeMs }))).toEqual([
      ['2026-11-16T16:15:00.000Z', '2026-11-16T22:00:00.000Z'],
    ]);
  });

  it('snaps both ends INWARDS when a blocked period is off the grid', () => {
    const blocked = [
      { startMs: utc('2026-11-16T16:07:00Z'), endMs: utc('2026-11-16T17:07:00Z') },
    ];
    expect(slots(compute({ blocked }))).toEqual([
      ['2026-11-16T14:00:00.000Z', '2026-11-16T16:00:00.000Z'],
      ['2026-11-16T17:15:00.000Z', '2026-11-16T22:00:00.000Z'],
    ]);
  });

  it('drops what is left when it is shorter than 30 minutes', () => {
    const blocked = [
      { startMs: utc('2026-11-16T14:15:00Z'), endMs: utc('2026-11-16T21:45:00Z') },
    ];
    // 15 minutes before and 15 minutes after: neither is worth offering.
    expect(slots(compute({ blocked }))).toEqual([]);
    const justEnough = [
      { startMs: utc('2026-11-16T14:30:00Z'), endMs: utc('2026-11-16T22:00:00Z') },
    ];
    expect(slots(compute({ blocked: justEnough }))).toEqual([
      ['2026-11-16T14:00:00.000Z', '2026-11-16T14:30:00.000Z'],
    ]);
  });

  it('serves exactly `days` days, in order', () => {
    const days = compute({ days: 14 });
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe('2026-11-16');
    expect(days[13].date).toBe('2026-11-29');
    // Two Mondays in the window.
    expect(days.filter((d) => d.slots.length > 0).map((d) => d.date)).toEqual([
      '2026-11-16',
      '2026-11-23',
    ]);
  });
});

describe('resolveEventTiming', () => {
  const start = new Date('2026-11-20T14:00:00Z');
  const direct = {
    requestType: ServiceRequestType.DIRECT_BOOKING,
    anchorAtUtc: start,
    desiredEndAtUtc: new Date('2026-11-20T22:00:00Z'),
    serviceDurationMinutes: null as number | null,
  };

  it('nothing dates it → unscheduled', () => {
    expect(resolveEventTiming({ ...direct, anchorAtUtc: null })).toEqual({
      kind: 'UNSCHEDULED',
    });
  });

  it('uses the LISTED DURATION before the client’s window', () => {
    // A 45-minute service booked « between 9 h and 17 h » takes 45 minutes,
    // not the provider's whole day.
    expect(resolveEventTiming({ ...direct, serviceDurationMinutes: 45 })).toEqual({
      kind: 'TIMED',
      startMs: start.getTime(),
      endMs: start.getTime() + 45 * 60_000,
    });
  });

  it('falls back on the window, then on one hour', () => {
    expect(resolveEventTiming(direct)).toEqual({
      kind: 'TIMED',
      startMs: start.getTime(),
      endMs: direct.desiredEndAtUtc.getTime(),
    });
    expect(resolveEventTiming({ ...direct, desiredEndAtUtc: null })).toEqual({
      kind: 'TIMED',
      startMs: start.getTime(),
      endMs: start.getTime() + 60 * 60_000,
    });
    // A window that ends before the retained start says nothing.
    expect(
      resolveEventTiming({ ...direct, desiredEndAtUtc: new Date('2026-11-20T13:00:00Z') }),
    ).toMatchObject({ endMs: start.getTime() + 60 * 60_000 });
  });

  it('an accepted tender is a DAY, read in UTC (the quote stores noon UTC)', () => {
    expect(
      resolveEventTiming({
        requestType: ServiceRequestType.PROJECT_TENDER,
        anchorAtUtc: new Date('2026-11-20T12:00:00Z'),
        desiredEndAtUtc: null,
        serviceDurationMinutes: 45,
      }),
    ).toEqual({ kind: 'ALL_DAY', date: '2026-11-20' });
  });
});

describe('iCalendar writer', () => {
  it('escapes text and drops control characters', () => {
    expect(escapeIcalText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeIcalText('ligne 1\r\nligne 2')).toBe('ligne 1\\nligne 2');
    expect(escapeIcalText('x\u0000y\u0007z')).toBe('xyz');
  });

  it('cannot be made to inject a property through a label', () => {
    const ics = buildIcalendar({
      name: 'Linkr',
      nowMs: utc('2026-11-16T12:00:00Z'),
      events: [
        {
          uid: 'u1@linkr',
          summary: 'Indisponible — vacances\r\nATTENDEE:mailto:x@example.com',
          status: 'CONFIRMED',
          timing: { kind: 'TIMED', startMs: utc('2026-11-20T14:00:00Z'), endMs: utc('2026-11-20T15:00:00Z') },
        },
      ],
    });
    expect(ics.split('\r\n').some((line) => line.startsWith('ATTENDEE'))).toBe(false);
    expect(ics).toContain('SUMMARY:Indisponible — vacances\\nATTENDEE:mailto:x@example.com');
  });

  it('folds at 75 octets without cutting a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(100)}`;
    const folded = foldIcalLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    for (const part of folded.slice(1)) expect(part.startsWith(' ')).toBe(true);
    // Unfolding gives the line back, byte for byte.
    expect(folded.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('writes a timed event in UTC and a day-long event as an exclusive DATE range', () => {
    const ics = buildIcalendar({
      name: 'Linkr',
      nowMs: utc('2026-11-16T12:00:00Z'),
      events: [
        {
          uid: 'a@linkr',
          summary: 'Linkr · Coiffure',
          status: 'TENTATIVE',
          timing: { kind: 'TIMED', startMs: utc('2026-11-20T14:00:00Z'), endMs: utc('2026-11-20T14:45:00Z') },
        },
        {
          uid: 'b@linkr',
          summary: 'Linkr · Décoration',
          status: 'CONFIRMED',
          timing: { kind: 'ALL_DAY', date: '2026-11-30' },
        },
      ],
    });
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(lines).toContain('DTSTART:20261120T140000Z');
    expect(lines).toContain('DTEND:20261120T144500Z');
    expect(lines).toContain('STATUS:TENTATIVE');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261130');
    expect(lines).toContain('DTEND;VALUE=DATE:20261201');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines).toContain(`DTSTAMP:${formatUtcStamp(utc('2026-11-16T12:00:00Z'))}`);
  });

  it('an empty calendar is still a valid document', () => {
    const ics = buildIcalendar({ name: 'Linkr', nowMs: 0, events: [] });
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
