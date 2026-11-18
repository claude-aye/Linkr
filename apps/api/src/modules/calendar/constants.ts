/**
 * Limits of the provider calendar. The ones a screen must know are MIRRORED in
 * `apps/web/src/lib/calendar/calendar-limits.ts` and held together by
 * `scripts/check-mirrored-constants.mjs` — written as LITERALS on both sides,
 * because the guard reads a literal, never an expression.
 */

/** The zone a calendar starts in. A named zone, never an offset (see zoned-time.ts). */
export const CALENDAR_DEFAULT_TIME_ZONE = 'America/Toronto';

/** Opening hours are entered in quarter-hours. Mirrored on the web. */
export const WEEKLY_HOURS_STEP_MINUTES = 15;

/** At most this many ranges per weekday (morning, afternoon, evening…). Mirrored on the web. */
export const WEEKLY_HOURS_MAX_RANGES_PER_DAY = 4;

/** Private label of a blocked period. Also a column CHECK. Mirrored on the web. */
export const TIME_OFF_LABEL_MAX = 80;

/** A blocked period cannot be longer than this. Mirrored on the web. */
export const TIME_OFF_MAX_DAYS = 366;

/** Live blocked periods that have not ended yet, per provider. Mirrored on the web. */
export const TIME_OFF_MAX_UPCOMING = 50;

/** Widest window `GET me/calendar` reads at once (a 6-week month grid is 42 days). */
export const CALENDAR_RANGE_MAX_DAYS = 62;

/** Public availability: days served by default, and the most a caller may ask for. */
export const AVAILABILITY_DEFAULT_DAYS = 14;
export const AVAILABILITY_MAX_DAYS = 28;

/** A free interval shorter than this is not worth offering. */
export const AVAILABILITY_MIN_SLOT_MINUTES = 30;

/** Free intervals start on this grid, so « libre dès 14 h 07 » never appears. */
export const AVAILABILITY_GRID_MINUTES = 15;

/** What the iCal feed and the export cover, around « now ». */
export const ICAL_PAST_DAYS = 30;
export const ICAL_FUTURE_DAYS = 180;

/**
 * A timed appointment with no known duration is drawn this long. Declared once,
 * in the requests module (CAL-3), so the slot-conflict refusal reads the same
 * value as the availability.
 */
export { APPOINTMENT_DEFAULT_MINUTES as DEFAULT_EVENT_MINUTES } from '../service-requests/appointment-slots';

/** Shape of a feed token: 32 random bytes, base64url. Checked before any lookup. */
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
