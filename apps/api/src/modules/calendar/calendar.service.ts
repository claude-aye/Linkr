import { randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  addDays,
  dateKeyInZone,
  isValidTimeZone,
  zonedTimeToUtcMs,
} from '../../common/time/zoned-time';
import { hashToken } from '../auth/token-hash';
import { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { MIN_LEAD_TIME_HOURS } from '../service-requests/constants';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { type Interval, computeAvailability } from './availability';
import {
  CALENDAR_DEFAULT_TIME_ZONE,
  CALENDAR_RANGE_MAX_DAYS,
  FEED_TOKEN_RE,
  ICAL_FUTURE_DAYS,
  ICAL_PAST_DAYS,
  TIME_OFF_MAX_DAYS,
} from './constants';
import { CalendarEventDto } from './dto/calendar-event.dto';
import { CalendarFeedDto } from './dto/calendar-feed.dto';
import {
  AvailabilityDayDto,
  ProviderAvailabilityDto,
} from './dto/provider-availability.dto';
import { ProviderCalendarDto } from './dto/provider-calendar.dto';
import { CreateTimeOffDto, TimeOffDto } from './dto/time-off.dto';
import { WeeklyHoursDto, WeeklyRangeDto } from './dto/weekly-hours.dto';
import { type EventTiming, resolveEventTiming } from './event-timing';
import {
  InvalidCalendarRangeException,
  InvalidTimeOffPeriodException,
  InvalidWeeklyHoursException,
  TimeOffLimitReachedException,
} from './exceptions/calendar-exceptions';
import { type IcalEvent, buildIcalendar } from './ical';
import {
  BUSY_JOB_STATUSES,
  CalendarEventsRepository,
} from './repositories/calendar-events.repository';
import {
  ProviderCalendarRepository,
  type ProviderCalendarRecord,
} from './repositories/provider-calendar.repository';
import { type WeeklyRange, normaliseWeeklyHours, readWeeklyHours } from './weekly-hours';

const PROVIDER_NOT_FOUND = 'Service provider not found';
const TIME_OFF_NOT_FOUND = 'Blocked period not found';
const FEED_NOT_FOUND = 'Calendar feed not found';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Web path of the provider calendar. Quasi-immutable: it is written into every `.ics`. */
export const CALENDAR_WEB_PATH = '/calendrier';
/** Web path of the feed relay, followed by the token. Quasi-immutable: it is in subscribed URLs. */
export const CALENDAR_FEED_WEB_PREFIX = '/calendrier/flux/';

/** `fr-CA`, then `en-CA`, then whatever exists — the API-side twin of the web's `pickTranslation`. */
function pickLabel(map: Record<string, string> | null | undefined): string | null {
  if (!map) return null;
  return map['fr-CA'] ?? map['en-CA'] ?? Object.values(map)[0] ?? null;
}

/**
 * The provider calendar: published opening hours, blocked periods, the live
 * view of appointments, the public availability and the iCal export.
 *
 * ⚠️ THREE AUDIENCES, THREE PROJECTIONS — never merge them:
 *
 * 1. THE PROVIDER HIMSELF (`getMine`) sees his appointments with their title,
 *    address and client name, exactly as on his dashboard.
 * 2. ANOTHER USER (`availability`) sees FREE TIME ONLY: the published hours and
 *    what is left of them. Nothing says why an hour is taken.
 * 3. A CALENDAR APP (`feed`, `exportMine`) receives the provider's schedule
 *    WITHOUT anything that identifies a client: the trade and service names
 *    come from the catalogue, and the title, address and client name are not
 *    even read from the database on that path (`findDated`). The file ends up
 *    on Google's or Microsoft's servers; a client's address has no business
 *    there, and nothing in the privacy policy covers sending it.
 *
 * Appointments are never stored: they are derived from `service_requests` at
 * read time, so this calendar cannot drift from the dashboard.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);
  private readonly webBaseUrl: string;

  constructor(
    private readonly calendars: ProviderCalendarRepository,
    private readonly events: CalendarEventsRepository,
    private readonly providers: ServiceProviderRepository,
    config: ConfigService,
  ) {
    this.webBaseUrl = config.getOrThrow<string>('WEB_APP_BASE_URL').replace(/\/+$/, '');
  }

  // ── The provider's own calendar ───────────────────────────────────────────

  async getMine(userId: string, fromIso: string, toIso: string): Promise<ProviderCalendarDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!(to.getTime() > from.getTime())) throw new InvalidCalendarRangeException('ORDER');
    if (to.getTime() - from.getTime() > CALENDAR_RANGE_MAX_DAYS * MS_PER_DAY) {
      throw new InvalidCalendarRangeException('TOO_WIDE');
    }

    const now = new Date();
    const [calendar, records, timeOff, upcomingTimeOff] = await Promise.all([
      this.calendars.findByProvider(providerId),
      this.events.findForOwner(providerId, from, to),
      this.calendars.findTimeOffOverlapping(providerId, from, to),
      this.calendars.findUpcomingTimeOff(providerId, now),
    ]);
    const timeZone = this.timeZoneOf(calendar);

    const dated: CalendarEventDto[] = [];
    const unscheduled: CalendarEventDto[] = [];
    for (const record of records) {
      const timing = resolveEventTiming(record);
      const dto = CalendarEventDto.from(record, timing);
      if (timing.kind === 'UNSCHEDULED') {
        unscheduled.push(dto);
      } else if (this.touchesWindow(timing, timeZone, from.getTime(), to.getTime())) {
        dated.push(dto);
      }
    }

    const dto = new ProviderCalendarDto();
    dto.timeZone = timeZone;
    dto.weeklyHours = readWeeklyHours(calendar?.weeklyHours ?? []).map((r) =>
      WeeklyRangeDto.from(r),
    );
    dto.events = dated;
    dto.unscheduled = unscheduled;
    dto.timeOff = timeOff.map((t) => TimeOffDto.from(t));
    dto.upcomingTimeOff = upcomingTimeOff.map((t) => TimeOffDto.from(t));
    dto.feedEnabled = calendar?.hasFeed ?? false;
    dto.feedCreatedAtUtc = calendar?.feedTokenCreatedAtUtc ?? null;
    return dto;
  }

  /**
   * Replaces the weekly schedule as a whole. The DTO checked the shape; this
   * decides whether it is a schedule (grid, overlap, count per day) and stores
   * it NORMALISED, so what is read back is what every reader computes with.
   */
  async saveWeeklyHours(userId: string, ranges: WeeklyRange[]): Promise<WeeklyHoursDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const result = normaliseWeeklyHours(ranges);
    if (!result.ok) throw new InvalidWeeklyHoursException(result.violation);

    const saved = await this.calendars.saveWeeklyHours(providerId, result.ranges);
    const dto = new WeeklyHoursDto();
    dto.timeZone = this.timeZoneOf(saved);
    dto.weeklyHours = result.ranges.map((r) => WeeklyRangeDto.from(r));
    return dto;
  }

  async addTimeOff(userId: string, input: CreateTimeOffDto): Promise<TimeOffDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const startsAtUtc = new Date(input.startsAtUtc);
    const endsAtUtc = new Date(input.endsAtUtc);
    const now = new Date();

    if (!(endsAtUtc.getTime() > startsAtUtc.getTime())) {
      throw new InvalidTimeOffPeriodException('END_BEFORE_START');
    }
    // A period entirely in the past blocks nothing: refusing it keeps the list
    // (and its ceiling) about what is still ahead.
    if (endsAtUtc.getTime() <= now.getTime()) {
      throw new InvalidTimeOffPeriodException('ALREADY_OVER');
    }
    if (endsAtUtc.getTime() - startsAtUtc.getTime() > TIME_OFF_MAX_DAYS * MS_PER_DAY) {
      throw new InvalidTimeOffPeriodException('TOO_LONG');
    }

    const result = await this.calendars.insertTimeOffUnderCap(
      { serviceProviderId: providerId, startsAtUtc, endsAtUtc, label: input.label ?? null },
      now,
    );
    if (!result.inserted) {
      if (result.reason === 'LIMIT_REACHED') throw new TimeOffLimitReachedException();
      throw new NotFoundException(PROVIDER_NOT_FOUND);
    }
    return TimeOffDto.from(result.timeOff);
  }

  /**
   * ⚠️ « NOT YOURS » IS A 404, NEVER A 403: someone else's blocked period reads
   * exactly like a missing one, so the route cannot confirm that an id exists
   * (precedent: the portfolio, DELETE /reviews/:id).
   */
  async removeTimeOff(userId: string, timeOffId: string): Promise<void> {
    const providerId = await this.resolveOwnProviderId(userId);
    const removed = await this.calendars.softDeleteTimeOff(timeOffId, providerId);
    if (!removed) throw new NotFoundException(TIME_OFF_NOT_FOUND);
  }

  // ── iCal: subscription feed and one-off export ────────────────────────────

  /**
   * Generates the feed link. The token is 32 random bytes; only its SHA-256 is
   * stored, so it is returned HERE AND NEVER AGAIN. Calling this again replaces
   * the hash — that is the rotation, and what revokes the previous URL.
   *
   * The token is never logged (CLAUDE.md §13 nº 19).
   */
  async createFeed(userId: string): Promise<CalendarFeedDto> {
    const providerId = await this.resolveOwnProviderId(userId);
    const token = randomBytes(32).toString('base64url');
    const createdAtUtc = await this.calendars.setFeedTokenHash(providerId, hashToken(token));
    this.logger.log(`Calendar feed link (re)generated for provider ${providerId}`);

    const dto = new CalendarFeedDto();
    dto.token = token;
    dto.path = `${CALENDAR_FEED_WEB_PREFIX}${token}`;
    dto.createdAtUtc = createdAtUtc;
    return dto;
  }

  async revokeFeed(userId: string): Promise<void> {
    const providerId = await this.resolveOwnProviderId(userId);
    await this.calendars.clearFeedToken(providerId);
    this.logger.log(`Calendar feed link revoked for provider ${providerId}`);
  }

  /** The provider's calendar as an `.ics` document, for a one-off import. */
  async exportMine(userId: string): Promise<string> {
    const providerId = await this.resolveOwnProviderId(userId);
    return this.buildIcs(providerId);
  }

  /**
   * The feed a calendar app polls. ONE answer for every failure — malformed
   * token, unknown, revoked, provider or account gone: 404. A token of the
   * wrong shape is refused before any lookup.
   */
  async feed(token: string): Promise<string> {
    if (!FEED_TOKEN_RE.test(token)) throw new NotFoundException(FEED_NOT_FOUND);
    const owner = await this.calendars.findFeedOwner(hashToken(token));
    if (!owner) throw new NotFoundException(FEED_NOT_FOUND);
    return this.buildIcs(owner.serviceProviderId);
  }

  /**
   * ⚠️ NOTHING HERE IDENTIFIES A CLIENT, BY CONSTRUCTION: `findDated` reads
   * neither the request's title, nor its address, nor the client. An entry is
   * named after the catalogue trade and service, and links back to the Linkr
   * calendar for the details. A blocked period carries the provider's OWN
   * label: it is his note, in a file he chose to export.
   */
  private async buildIcs(providerId: string): Promise<string> {
    const nowMs = Date.now();
    const from = new Date(nowMs - ICAL_PAST_DAYS * MS_PER_DAY);
    const to = new Date(nowMs + ICAL_FUTURE_DAYS * MS_PER_DAY);
    const [records, timeOff] = await Promise.all([
      this.events.findDated(providerId, from, to),
      this.calendars.findTimeOffOverlapping(providerId, from, to),
    ]);

    const calendarUrl = `${this.webBaseUrl}${CALENDAR_WEB_PATH}`;
    const events: IcalEvent[] = [];

    for (const record of records) {
      const timing = resolveEventTiming(record);
      if (timing.kind === 'UNSCHEDULED') continue;
      const trade = pickLabel(record.categoryNameTranslations) ?? 'Rendez-vous';
      const item = pickLabel(record.itemNameTranslations);
      const pending = record.status === ServiceRequestStatus.OPEN;
      events.push({
        uid: `demande-${record.id}@linkr`,
        summary: `Linkr · ${item ? `${trade} — ${item}` : trade}${pending ? ' (à confirmer)' : ''}`,
        description: pending
          ? `Demande en attente de votre réponse. Détails dans votre calendrier Linkr : ${calendarUrl}`
          : `Détails dans votre calendrier Linkr : ${calendarUrl}`,
        url: calendarUrl,
        status: pending ? 'TENTATIVE' : 'CONFIRMED',
        timing:
          timing.kind === 'TIMED'
            ? { kind: 'TIMED', startMs: timing.startMs, endMs: timing.endMs }
            : { kind: 'ALL_DAY', date: timing.date },
        lastModifiedMs: record.updatedAtUtc.getTime(),
      });
    }

    for (const period of timeOff) {
      events.push({
        uid: `indisponibilite-${period.id}@linkr`,
        summary: period.label ? `Indisponible — ${period.label}` : 'Indisponible',
        status: 'CONFIRMED',
        timing: {
          kind: 'TIMED',
          startMs: period.startsAtUtc.getTime(),
          endMs: period.endsAtUtc.getTime(),
        },
        lastModifiedMs: period.updatedAtUtc.getTime(),
      });
    }

    return buildIcalendar({ name: 'Linkr', events, nowMs });
  }

  // ── What another user may see ─────────────────────────────────────────────

  /**
   * Free time of a provider over the coming days.
   *
   * Visibility = the profile's, verbatim (`findById`: exists, not deleted). A
   * PAUSED provider keeps a profile but takes no booking, so nothing is
   * published for him — neither slots nor hours.
   *
   * What removes time from the published hours:
   * - blocked periods;
   * - appointments still ahead that have an HOUR (direct bookings ASSIGNED or
   *   IN_PROGRESS).
   *
   * What deliberately does NOT:
   * - a booking still OPEN: nothing is agreed, and letting an unanswered
   *   request hide a slot would let anyone empty a provider's calendar by
   *   sending requests;
   * - an accepted tender: its quote names a day, not an hour, and blocking the
   *   whole day for a job that may take one hour would hide real availability.
   *   Showing a slot that turns out taken costs a declined request; hiding a
   *   free one costs a booking nobody ever sees was lost.
   */
  async availability(providerId: string, days: number): Promise<ProviderAvailabilityDto> {
    const provider = await this.providers.findById(providerId);
    if (!provider) throw new NotFoundException(PROVIDER_NOT_FOUND);

    const calendar = await this.calendars.findByProvider(providerId);
    const timeZone = this.timeZoneOf(calendar);
    const weeklyHours = readWeeklyHours(calendar?.weeklyHours ?? []);
    const published = provider.isActive && weeklyHours.length > 0;

    const nowMs = Date.now();
    const fromDate = dateKeyInZone(nowMs, timeZone);

    const dto = new ProviderAvailabilityDto();
    dto.timeZone = timeZone;
    dto.published = published;
    dto.weeklyHours = published ? weeklyHours.map((r) => WeeklyRangeDto.from(r)) : [];

    if (!published) {
      dto.days = Array.from({ length: days }, (_, i) => {
        const day = new AvailabilityDayDto();
        day.date = addDays(fromDate, i);
        day.slots = [];
        return day;
      });
      return dto;
    }

    const from = new Date(zonedTimeToUtcMs(fromDate, 0, timeZone));
    const to = new Date(zonedTimeToUtcMs(addDays(fromDate, days), 0, timeZone));
    const [timeOff, dated] = await Promise.all([
      this.calendars.findTimeOffOverlapping(providerId, from, to),
      this.events.findDated(providerId, from, to),
    ]);

    const blocked: Interval[] = timeOff.map((t) => ({
      startMs: t.startsAtUtc.getTime(),
      endMs: t.endsAtUtc.getTime(),
    }));
    for (const record of dated) {
      if (!BUSY_JOB_STATUSES.includes(record.status)) continue;
      const timing = resolveEventTiming(record);
      if (timing.kind === 'TIMED') {
        blocked.push({ startMs: timing.startMs, endMs: timing.endMs });
      }
    }

    dto.days = computeAvailability({
      timeZone,
      weeklyHours,
      blocked,
      fromDate,
      days,
      notBeforeMs: nowMs + MIN_LEAD_TIME_HOURS * MS_PER_HOUR,
    }).map((d) => {
      const day = new AvailabilityDayDto();
      day.date = d.date;
      day.slots = d.slots.map((s) => ({
        startAtUtc: new Date(s.startMs),
        endAtUtc: new Date(s.endMs),
      }));
      return day;
    });
    return dto;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The caller's own provider — 404 when the user has none (same as `me/portfolio`). */
  private async resolveOwnProviderId(userId: string): Promise<string> {
    const provider = await this.providers.findByUserId(userId);
    if (!provider) throw new NotFoundException(PROVIDER_NOT_FOUND);
    return provider.id;
  }

  /** The stored zone, or the default when there is no row — or a zone this runtime cannot compute with. */
  private timeZoneOf(calendar: ProviderCalendarRecord | null): string {
    const zone = calendar?.timeZone;
    return isValidTimeZone(zone) ? zone : CALENDAR_DEFAULT_TIME_ZONE;
  }

  /** Does a dated entry intersect `[fromMs, toMs)`? A day-long entry spans its civil day in the calendar's zone. */
  private touchesWindow(
    timing: Exclude<EventTiming, { kind: 'UNSCHEDULED' }>,
    timeZone: string,
    fromMs: number,
    toMs: number,
  ): boolean {
    const startMs =
      timing.kind === 'TIMED' ? timing.startMs : zonedTimeToUtcMs(timing.date, 0, timeZone);
    const endMs =
      timing.kind === 'TIMED'
        ? timing.endMs
        : zonedTimeToUtcMs(addDays(timing.date, 1), 0, timeZone);
    return endMs > fromMs && startMs < toMs;
  }
}
