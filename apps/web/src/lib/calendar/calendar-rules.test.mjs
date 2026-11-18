import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  TIME_OFF_LABEL_MAX,
  TIME_OFF_MAX_DAYS,
  addDays,
  assembleTimeOff,
  assembleTimeOffBody,
  assembleWeeklyHoursBody,
  calendarHref,
  dateKeyInZone,
  feedErrorMessage,
  feedLinks,
  feedTokenFromSegment,
  gridSpan,
  isCalendarFeedPath,
  isoWeekday,
  layoutDay,
  minutesLabel,
  monthWeeks,
  parseAnchor,
  parseView,
  periodLabel,
  periodWhenLabel,
  shiftAnchor,
  slotLabels,
  startOfWeek,
  startTimeDays,
  startTimesInSlots,
  startsWithinSlots,
  suggestRange,
  timeOffCreateErrorMessage,
  weeklyHoursError,
  weeklyHoursSummary,
  zonedTimeToUtcMs,
} from './calendar-rules.ts';

const TZ = 'America/Toronto';
const utc = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
const TOKEN = 'a'.repeat(43);

test('the module imports nothing (node --test loads it as-is)', () => {
  const source = readFileSync(fileURLToPath(new URL('./calendar-rules.ts', import.meta.url)), 'utf8');
  assert.equal(/^\s*import\s/m.test(source), false);
});

// ── Zone arithmetic: the same cases as the API's zoned-time.spec.ts ─────────

test('9 h stays 9 h across daylight saving time', () => {
  assert.equal(iso(zonedTimeToUtcMs('2026-01-15', 540, TZ)), '2026-01-15T14:00:00.000Z');
  assert.equal(iso(zonedTimeToUtcMs('2026-07-15', 540, TZ)), '2026-07-15T13:00:00.000Z');
});

test('a wall time inside the spring gap slides forward', () => {
  assert.equal(iso(zonedTimeToUtcMs('2026-03-08', 150, TZ)), '2026-03-08T07:30:00.000Z');
});

test('days are 23 h and 25 h long on the change days', () => {
  const len = (k) => (zonedTimeToUtcMs(k, 1440, TZ) - zonedTimeToUtcMs(k, 0, TZ)) / 3_600_000;
  assert.equal(len('2026-03-08'), 23);
  assert.equal(len('2026-11-01'), 25);
});

test('the civil day is read in the zone, not in UTC', () => {
  assert.equal(dateKeyInZone(utc('2026-11-17T02:30:00Z'), TZ), '2026-11-16');
});

// ── Grids ───────────────────────────────────────────────────────────────────

test('weeks start on Sunday; weekdays stay ISO', () => {
  assert.equal(isoWeekday('2026-11-16'), 1);
  assert.equal(startOfWeek('2026-11-16'), '2026-11-15');
  assert.equal(startOfWeek('2026-11-15'), '2026-11-15');
  assert.equal(startOfWeek('2026-11-21'), '2026-11-15');
});

test('a month grid covers the month in whole weeks', () => {
  const weeks = monthWeeks('2026-11-16');
  assert.equal(weeks[0][0], '2026-11-01');
  assert.equal(weeks.at(-1)[6], '2026-12-05');
  for (const week of weeks) assert.equal(week.length, 7);
  // February 2026 starts on a Sunday and ends on a Saturday: exactly 4 rows.
  assert.equal(monthWeeks('2026-02-10').length, 4);
});

test('month navigation never overflows (31 January + 1 month = 1 February)', () => {
  assert.equal(shiftAnchor('mois', '2026-01-31', 1), '2026-02-01');
  assert.equal(shiftAnchor('mois', '2026-01-15', -1), '2025-12-01');
  assert.equal(shiftAnchor('semaine', '2026-11-16', 1), '2026-11-23');
});

test('the URL is the state, with defaults left out', () => {
  assert.equal(parseView('mois'), 'mois');
  assert.equal(parseView('nope'), 'semaine');
  assert.equal(parseAnchor('2026-02-30', '2026-11-16'), '2026-11-16');
  assert.equal(parseAnchor('2026-11-20', '2026-11-16'), '2026-11-20');
  assert.equal(calendarHref('semaine', null), '/calendrier');
  assert.equal(calendarHref('mois', '2026-11-01'), '/calendrier?vue=mois&date=2026-11-01');
});

test('period titles read like a person would say them', () => {
  assert.equal(periodLabel('semaine', '2026-11-16'), '15 au 21 novembre 2026');
  assert.equal(periodLabel('semaine', '2026-11-30'), '29 novembre au 5 décembre 2026');
  assert.equal(periodLabel('mois', '2026-11-16'), 'novembre 2026');
});

// ── Day layout ──────────────────────────────────────────────────────────────

test('overlapping entries share the width; separate ones do not', () => {
  const blocks = layoutDay(
    [
      { id: 'a', startMs: utc('2026-11-19T14:00:00Z'), endMs: utc('2026-11-19T16:00:00Z') },
      { id: 'b', startMs: utc('2026-11-19T14:30:00Z'), endMs: utc('2026-11-19T16:30:00Z') },
      { id: 'c', startMs: utc('2026-11-19T20:00:00Z'), endMs: utc('2026-11-19T21:00:00Z') },
    ],
    '2026-11-19',
    TZ,
  );
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  assert.deepEqual([byId.a.column, byId.a.columns], [0, 2]);
  assert.deepEqual([byId.b.column, byId.b.columns], [1, 2]);
  assert.deepEqual([byId.c.column, byId.c.columns], [0, 1]);
  assert.equal(byId.a.startMinute, 9 * 60);
});

test('an entry spanning midnight is clipped to each day', () => {
  const item = [{ id: 'x', startMs: utc('2026-11-20T03:00:00Z'), endMs: utc('2026-11-20T07:00:00Z') }];
  const [first] = layoutDay(item, '2026-11-19', TZ);
  const [second] = layoutDay(item, '2026-11-20', TZ);
  assert.deepEqual([first.startMinute, first.endMinute, first.continuesAfter], [22 * 60, 1440, true]);
  assert.deepEqual([second.startMinute, second.endMinute, second.continuesBefore], [0, 120, true]);
});

test('the grid spans 7 h–19 h at least, and grows to fit', () => {
  assert.deepEqual(gridSpan([]), { startMinute: 420, endMinute: 1140 });
  assert.deepEqual(gridSpan([{ startMinute: 375, endMinute: 1230 }]), {
    startMinute: 360,
    endMinute: 1260,
  });
});

// ── Weekly hours ────────────────────────────────────────────────────────────

test('weekly hours: same rules as the API', () => {
  assert.equal(weeklyHoursError([{ weekday: 1, startMinute: 540, endMinute: 1020 }]), null);
  assert.match(weeklyHoursError([{ weekday: 1, startMinute: 600, endMinute: 540 }]), /après son début/);
  assert.match(weeklyHoursError([{ weekday: 1, startMinute: 545, endMinute: 600 }]), /quart d’heure/);
  assert.match(
    weeklyHoursError([
      { weekday: 3, startMinute: 540, endMinute: 720 },
      { weekday: 3, startMinute: 660, endMinute: 780 },
    ]),
    /chevauchent/,
  );
  assert.match(
    weeklyHoursError(
      [0, 1, 2, 3, 4].map((i) => ({ weekday: 4, startMinute: i * 120, endMinute: i * 120 + 60 })),
    ),
    /au plus 4/,
  );
});

test('the weekly-hours body is assembled field by field', () => {
  assert.deepEqual(
    assembleWeeklyHoursBody({
      weeklyHours: [{ weekday: 1, startMinute: 540, endMinute: 1020, junk: 1 }],
      extra: true,
    }),
    { weeklyHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] },
  );
  assert.equal(assembleWeeklyHoursBody({}), null);
  assert.equal(assembleWeeklyHoursBody({ weeklyHours: [{ weekday: '1' }] }), null);
});

test('a suggested range follows the last one, or is 9 h–17 h on an empty day', () => {
  assert.deepEqual(suggestRange([], 2), { weekday: 2, startMinute: 540, endMinute: 1020 });
  assert.deepEqual(suggestRange([{ weekday: 2, startMinute: 540, endMinute: 720 }], 2), {
    weekday: 2,
    startMinute: 780,
    endMinute: 960,
  });
});

test('the public summary lists closed days too, Sunday first', () => {
  const rows = weeklyHoursSummary([{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
  assert.equal(rows[0].label, 'Dimanche');
  assert.equal(rows[0].hours, null);
  assert.equal(rows[1].hours, '9 h 00 – 17 h 00');
  assert.equal(minutesLabel(1440), 'minuit');
});

// ── Blocked periods ─────────────────────────────────────────────────────────

test('a blocked period is validated with the API’s rules', () => {
  const now = utc('2026-11-16T15:00:00Z');
  const start = utc('2026-11-20T05:00:00Z');
  const ok = assembleTimeOff({ startMs: start, endMs: start + 86_400_000, label: '  Vacances  ' }, now);
  assert.equal(ok.ok, true);
  assert.equal(ok.body.label, 'Vacances');
  assert.equal(assembleTimeOff({ startMs: start, endMs: start, label: '' }, now).field, 'end');
  assert.equal(assembleTimeOff({ startMs: null, endMs: start, label: '' }, now).field, 'start');
  assert.match(
    assembleTimeOff({ startMs: now - 10_000_000, endMs: now - 1, label: '' }, now).message,
    /déjà terminée/,
  );
  assert.match(
    assembleTimeOff(
      { startMs: start, endMs: start + (TIME_OFF_MAX_DAYS + 1) * 86_400_000, label: '' },
      now,
    ).message,
    /366 jours/,
  );
  assert.equal(
    assembleTimeOff({ startMs: start, endMs: start + 1, label: 'x'.repeat(TIME_OFF_LABEL_MAX + 1) }, now)
      .field,
    'label',
  );
  // An empty note is null, never '' (the column CHECK refuses it).
  assert.equal(assembleTimeOff({ startMs: start, endMs: start + 1, label: '   ' }, now).body.label, null);
});

test('the blocked-period body drops every other key', () => {
  assert.deepEqual(
    assembleTimeOffBody({ startsAtUtc: 'a', endsAtUtc: 'b', label: 'x', serviceProviderId: 'evil' }),
    { startsAtUtc: 'a', endsAtUtc: 'b', label: 'x' },
  );
  assert.equal(assembleTimeOffBody({ startsAtUtc: 'a' }), null);
  assert.equal(assembleTimeOffBody({ startsAtUtc: 'a', endsAtUtc: 'b', label: 3 }), null);
});

test('a period reads in words, whole days and hours alike', () => {
  assert.equal(
    periodWhenLabel(zonedTimeToUtcMs('2026-11-18', 0, TZ), zonedTimeToUtcMs('2026-11-19', 0, TZ), TZ),
    'mer. 18 nov., toute la journée',
  );
  assert.equal(
    periodWhenLabel(zonedTimeToUtcMs('2026-12-24', 0, TZ), zonedTimeToUtcMs('2027-01-03', 0, TZ), TZ),
    'du jeu. 24 déc. au sam. 2 janv.',
  );
  assert.equal(
    periodWhenLabel(utc('2026-11-17T18:00:00Z'), utc('2026-11-17T20:00:00Z'), TZ),
    'mar. 17 nov., 13 h 00 – 15 h 00',
  );
});

test('messages are chosen by status alone', () => {
  assert.match(timeOffCreateErrorMessage(409), /50 périodes/);
  assert.match(feedErrorMessage(429), /beaucoup de liens/);
  assert.match(feedErrorMessage(500), /indisponible/);
});

// ── Feed ────────────────────────────────────────────────────────────────────

test('only a token-shaped segment is a public feed path', () => {
  assert.equal(isCalendarFeedPath(`/calendrier/flux/${TOKEN}`), true);
  assert.equal(isCalendarFeedPath(`/calendrier/flux/${TOKEN}.ics`), true);
  assert.equal(isCalendarFeedPath('/calendrier/flux/'), false);
  assert.equal(isCalendarFeedPath('/calendrier/flux/nope'), false);
  assert.equal(isCalendarFeedPath(`/calendrier/flux/${TOKEN}/x`), false);
  assert.equal(isCalendarFeedPath('/calendrier'), false);
  assert.equal(isCalendarFeedPath('/calendrier/export'), false);
  assert.equal(feedTokenFromSegment(`${TOKEN}.ics`), TOKEN);
  assert.equal(feedTokenFromSegment(`${TOKEN}!`), null);
});

test('subscription links: https, webcal, Google and Outlook', () => {
  const links = feedLinks('https://linkrapp.com/', `/calendrier/flux/${TOKEN}`);
  assert.equal(links.httpsUrl, `https://linkrapp.com/calendrier/flux/${TOKEN}.ics`);
  assert.equal(links.webcalUrl, `webcal://linkrapp.com/calendrier/flux/${TOKEN}.ics`);
  assert.ok(links.googleUrl.startsWith('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F'));
  assert.ok(links.outlookUrl.startsWith('https://outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2F'));
});

// ── Availability, client side ───────────────────────────────────────────────

const DAY = {
  date: '2026-11-17',
  slots: [
    { startAtUtc: '2026-11-17T14:00:00.000Z', endAtUtc: '2026-11-17T15:00:00.000Z' },
    { startAtUtc: '2026-11-17T16:00:00.000Z', endAtUtc: '2026-11-18T05:00:00.000Z' },
  ],
};

test('start times fit the service duration inside each free interval', () => {
  const slots = [{ startMs: utc('2026-11-17T14:00:00Z'), endMs: utc('2026-11-17T15:00:00Z') }];
  assert.deepEqual(startTimesInSlots(slots, 45).map(iso), ['2026-11-17T14:00:00.000Z']);
  assert.deepEqual(startTimesInSlots(slots, 30).map(iso), [
    '2026-11-17T14:00:00.000Z',
    '2026-11-17T14:30:00.000Z',
  ]);
  assert.deepEqual(startTimesInSlots(slots, 90), []);
});

test('a picked time proposes a window that never leaves its free interval', () => {
  const [day] = startTimeDays([DAY], TZ, 45);
  assert.equal(day.label, 'mar. 17 nov.');
  assert.equal(day.times[0].label, '9 h 00');
  // 2 h wanted, but the interval ends at 10 h.
  assert.equal(day.times[0].endIso, '2026-11-17T15:00:00.000Z');
  assert.equal(day.times[1].label, '11 h 00');
  assert.equal(day.times[1].endIso, '2026-11-17T18:00:00.000Z');
});

test('free intervals read in the provider’s zone; the end of day is « minuit »', () => {
  assert.deepEqual(slotLabels(DAY, TZ), ['9 h 00 – 10 h 00', '11 h 00 – minuit']);
});

test('the « outside availability » hint looks at the START only', () => {
  const slots = [{ startMs: utc('2026-11-17T14:00:00Z'), endMs: utc('2026-11-17T15:00:00Z') }];
  assert.equal(startsWithinSlots(utc('2026-11-17T14:30:00Z'), slots), true);
  assert.equal(startsWithinSlots(utc('2026-11-17T15:00:00Z'), slots), false);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});
