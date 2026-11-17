import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { hashToken } from '../auth/token-hash';
import type { ServiceProviderRepository } from '../service-providers/repositories/service-provider.repository';
import { ServiceRequestStatus } from '../service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { CalendarService } from './calendar.service';
import { FEED_TOKEN_RE, TIME_OFF_MAX_DAYS } from './constants';
import {
  InvalidCalendarRangeException,
  InvalidTimeOffPeriodException,
  InvalidWeeklyHoursException,
  TimeOffLimitReachedException,
} from './exceptions/calendar-exceptions';
import type {
  CalendarEventDetailRecord,
  CalendarEventRecord,
  CalendarEventsRepository,
} from './repositories/calendar-events.repository';
import type {
  ProviderCalendarRecord,
  ProviderCalendarRepository,
  TimeOffRecord,
} from './repositories/provider-calendar.repository';

/**
 * Frozen clock: Monday 16 November 2026, 10 h in Toronto (15:00Z, EST).
 * `nextTick`/`setImmediate` stay real so awaited promises resolve.
 */
const NOW = new Date('2026-11-16T15:00:00Z');
const USER = 'user-1';
const PROVIDER = 'provider-1';

const SECRET_TITLE = 'Coupe chez Mme Tremblay';
const SECRET_ADDRESS = '12 rue Secrète, Laval';
const SECRET_CLIENT = 'Marie Tremblay';

function baseEvent(over: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'req-1',
    status: ServiceRequestStatus.ASSIGNED,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    anchorAtUtc: new Date('2026-11-17T15:00:00Z'), // Tuesday 10 h
    desiredEndAtUtc: new Date('2026-11-17T20:00:00Z'),
    serviceDurationMinutes: 60,
    quoteDurationMinutes: null,
    updatedAtUtc: new Date('2026-11-10T00:00:00Z'),
    categoryNameTranslations: { 'fr-CA': 'Coiffure', 'en-CA': 'Hairdressing' },
    itemNameTranslations: { 'fr-CA': 'Coupe homme' },
    ...over,
  };
}

function detailEvent(over: Partial<CalendarEventDetailRecord> = {}): CalendarEventDetailRecord {
  return {
    ...baseEvent(),
    title: SECRET_TITLE,
    serviceAddress: SECRET_ADDRESS,
    clientDisplayName: SECRET_CLIENT,
    ...over,
  };
}

function timeOff(over: Partial<TimeOffRecord> = {}): TimeOffRecord {
  return {
    id: 'off-1',
    serviceProviderId: PROVIDER,
    startsAtUtc: new Date('2026-11-18T05:00:00Z'), // all of Wednesday
    endsAtUtc: new Date('2026-11-19T05:00:00Z'),
    label: 'Vacances',
    createdAtUtc: NOW,
    updatedAtUtc: NOW,
    ...over,
  };
}

const EVERY_DAY_9_TO_17 = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startMinute: 540,
  endMinute: 1020,
}));

function calendarRow(over: Partial<ProviderCalendarRecord> = {}): ProviderCalendarRecord {
  return {
    serviceProviderId: PROVIDER,
    timeZone: 'America/Toronto',
    weeklyHours: EVERY_DAY_9_TO_17,
    hasFeed: false,
    feedTokenCreatedAtUtc: null,
    updatedAtUtc: NOW,
    ...over,
  };
}

function setup() {
  const calendars = {
    findByProvider: jest.fn().mockResolvedValue(calendarRow()),
    saveWeeklyHours: jest.fn().mockImplementation(async () => calendarRow()),
    setFeedTokenHash: jest.fn().mockResolvedValue(NOW),
    clearFeedToken: jest.fn().mockResolvedValue(undefined),
    findFeedOwner: jest.fn().mockResolvedValue(null),
    findTimeOffOverlapping: jest.fn().mockResolvedValue([]),
    findUpcomingTimeOff: jest.fn().mockResolvedValue([]),
    insertTimeOffUnderCap: jest.fn(),
    softDeleteTimeOff: jest.fn().mockResolvedValue(true),
  };
  const events = {
    findForOwner: jest.fn().mockResolvedValue([]),
    findDated: jest.fn().mockResolvedValue([]),
  };
  const providers = {
    findByUserId: jest.fn().mockResolvedValue({ id: PROVIDER, isActive: true }),
    findById: jest.fn().mockResolvedValue({ id: PROVIDER, isActive: true }),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('https://linkr.test/') };
  const service = new CalendarService(
    calendars as unknown as ProviderCalendarRepository,
    events as unknown as CalendarEventsRepository,
    providers as unknown as ServiceProviderRepository,
    config as unknown as ConfigService,
  );
  return { service, calendars, events, providers };
}

describe('CalendarService', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getMine — the provider’s own view', () => {
    const FROM = '2026-11-16T05:00:00Z';
    const TO = '2026-11-23T05:00:00Z';

    it('404 when the user has no provider, before any read', async () => {
      const { service, providers, events } = setup();
      providers.findByUserId.mockResolvedValue(null);
      await expect(service.getMine(USER, FROM, TO)).rejects.toBeInstanceOf(NotFoundException);
      expect(events.findForOwner).not.toHaveBeenCalled();
    });

    it('refuses an inverted or too wide window', async () => {
      const { service } = setup();
      await expect(service.getMine(USER, TO, FROM)).rejects.toBeInstanceOf(
        InvalidCalendarRangeException,
      );
      await expect(service.getMine(USER, FROM, FROM)).rejects.toBeInstanceOf(
        InvalidCalendarRangeException,
      );
      await expect(
        service.getMine(USER, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      ).rejects.toBeInstanceOf(InvalidCalendarRangeException);
    });

    it('splits dated appointments from the ones nothing dates', async () => {
      const { service, events } = setup();
      events.findForOwner.mockResolvedValue([
        detailEvent(),
        detailEvent({ id: 'req-open', status: ServiceRequestStatus.OPEN }),
        detailEvent({
          id: 'req-tender',
          requestType: ServiceRequestType.PROJECT_TENDER,
          anchorAtUtc: new Date('2026-11-20T12:00:00Z'),
          quoteDurationMinutes: 240,
        }),
        detailEvent({ id: 'req-undated', anchorAtUtc: null }),
      ]);

      const dto = await service.getMine(USER, FROM, TO);

      expect(dto.events.map((e) => [e.id, e.kind, e.timing])).toEqual([
        ['req-1', 'JOB', 'TIMED'],
        ['req-open', 'PENDING_REQUEST', 'TIMED'],
        ['req-tender', 'JOB', 'ALL_DAY'],
      ]);
      expect(dto.unscheduled.map((e) => e.id)).toEqual(['req-undated']);
      // The provider IS the counterparty: title, address and name are his to see.
      expect(dto.events[0]).toMatchObject({
        title: SECRET_TITLE,
        serviceAddress: SECRET_ADDRESS,
        clientDisplayName: SECRET_CLIENT,
        durationMinutes: 60,
      });
      expect(dto.events[2]).toMatchObject({ date: '2026-11-20', durationMinutes: 240 });
    });

    it('drops a dated appointment that only the slack of the SQL filter let in', async () => {
      const { service, events } = setup();
      // Ended the day before the window opens.
      events.findForOwner.mockResolvedValue([
        detailEvent({ anchorAtUtc: new Date('2026-11-15T15:00:00Z') }),
      ]);
      const dto = await service.getMine(USER, FROM, TO);
      expect(dto.events).toEqual([]);
    });

    it('applies the defaults when the provider never wrote a settings row', async () => {
      const { service, calendars } = setup();
      calendars.findByProvider.mockResolvedValue(null);
      const dto = await service.getMine(USER, FROM, TO);
      expect(dto).toMatchObject({
        timeZone: 'America/Toronto',
        weeklyHours: [],
        feedEnabled: false,
        feedCreatedAtUtc: null,
      });
    });

    it('falls back on the default zone when the stored one is unusable', async () => {
      const { service, calendars } = setup();
      calendars.findByProvider.mockResolvedValue(calendarRow({ timeZone: 'Mars/Olympus' }));
      expect((await service.getMine(USER, FROM, TO)).timeZone).toBe('America/Toronto');
    });
  });

  describe('saveWeeklyHours', () => {
    it('stores the NORMALISED schedule', async () => {
      const { service, calendars } = setup();
      const dto = await service.saveWeeklyHours(USER, [
        { weekday: 1, startMinute: 720, endMinute: 1020 },
        { weekday: 1, startMinute: 540, endMinute: 720 },
      ]);
      const merged = [{ weekday: 1, startMinute: 540, endMinute: 1020 }];
      expect(calendars.saveWeeklyHours).toHaveBeenCalledWith(PROVIDER, merged);
      expect(dto.weeklyHours).toEqual(merged);
    });

    it('refuses an invalid schedule with its code, and writes nothing', async () => {
      const { service, calendars } = setup();
      const attempt = service.saveWeeklyHours(USER, [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 600, endMinute: 780 },
      ]);
      await expect(attempt).rejects.toBeInstanceOf(InvalidWeeklyHoursException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'WEEKLY_HOURS_OVERLAP' },
        status: 422,
      });
      expect(calendars.saveWeeklyHours).not.toHaveBeenCalled();
    });
  });

  describe('addTimeOff', () => {
    const body = (startsAtUtc: string, endsAtUtc: string, label?: string) => ({
      startsAtUtc,
      endsAtUtc,
      label,
    });

    it.each([
      ['ends before it starts', '2026-11-20T10:00:00Z', '2026-11-20T09:00:00Z'],
      ['empty', '2026-11-20T10:00:00Z', '2026-11-20T10:00:00Z'],
      ['already over', '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z'],
      ['too long', '2026-11-20T00:00:00Z', '2028-01-01T00:00:00Z'],
    ])('refuses a period that %s', async (_label, start, end) => {
      const { service, calendars } = setup();
      await expect(service.addTimeOff(USER, body(start, end))).rejects.toBeInstanceOf(
        InvalidTimeOffPeriodException,
      );
      expect(calendars.insertTimeOffUnderCap).not.toHaveBeenCalled();
    });

    it('accepts a period already begun, and one of exactly the maximum length', async () => {
      const { service, calendars } = setup();
      calendars.insertTimeOffUnderCap.mockResolvedValue({ inserted: true, timeOff: timeOff() });
      await service.addTimeOff(USER, body('2026-11-15T00:00:00Z', '2026-11-17T00:00:00Z'));
      const start = new Date('2026-12-01T00:00:00Z');
      const end = new Date(start.getTime() + TIME_OFF_MAX_DAYS * 86_400_000);
      await service.addTimeOff(USER, body(start.toISOString(), end.toISOString(), 'Sabbatique'));
      expect(calendars.insertTimeOffUnderCap).toHaveBeenCalledTimes(2);
      expect(calendars.insertTimeOffUnderCap.mock.calls[1][0]).toMatchObject({
        serviceProviderId: PROVIDER,
        label: 'Sabbatique',
      });
      // The cap counts what is not over AT THE CLOCK OF THE CALL.
      expect(calendars.insertTimeOffUnderCap.mock.calls[1][1]).toEqual(NOW);
    });

    it('answers 409 with a code at the ceiling', async () => {
      const { service, calendars } = setup();
      calendars.insertTimeOffUnderCap.mockResolvedValue({
        inserted: false,
        reason: 'LIMIT_REACHED',
      });
      const attempt = service.addTimeOff(
        USER,
        body('2026-11-20T10:00:00Z', '2026-11-21T10:00:00Z'),
      );
      await expect(attempt).rejects.toBeInstanceOf(TimeOffLimitReachedException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'TIME_OFF_LIMIT_REACHED' },
      });
    });
  });

  describe('removeTimeOff', () => {
    it('scopes the delete to the caller’s provider, and answers 404 — never 403', async () => {
      const { service, calendars } = setup();
      await service.removeTimeOff(USER, 'off-1');
      expect(calendars.softDeleteTimeOff).toHaveBeenCalledWith('off-1', PROVIDER);

      calendars.softDeleteTimeOff.mockResolvedValue(false);
      await expect(service.removeTimeOff(USER, 'someone-elses')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('feed link', () => {
    it('returns the token ONCE and stores only its SHA-256', async () => {
      const { service, calendars } = setup();
      const feed = await service.createFeed(USER);

      expect(feed.token).toMatch(FEED_TOKEN_RE);
      expect(feed.path).toBe(`/calendrier/flux/${feed.token}`);
      const [providerId, stored] = calendars.setFeedTokenHash.mock.calls[0];
      expect(providerId).toBe(PROVIDER);
      expect(stored).toBe(hashToken(feed.token));
      expect(stored).toHaveLength(64);
      expect(stored).not.toContain(feed.token);
    });

    it('two links are two different tokens', async () => {
      const { service } = setup();
      const a = await service.createFeed(USER);
      const b = await service.createFeed(USER);
      expect(a.token).not.toBe(b.token);
    });

    it('never logs the token', async () => {
      const { service } = setup();
      const logged: string[] = [];
      const spy = jest
        .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
        .mockImplementation((message: string) => {
          logged.push(message);
        });
      const feed = await service.createFeed(USER);
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) expect(line).not.toContain(feed.token);
      spy.mockRestore();
    });

    it('a malformed token is a 404 WITHOUT any lookup', async () => {
      const { service, calendars } = setup();
      for (const bad of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(43)}.ics`]) {
        await expect(service.feed(bad)).rejects.toBeInstanceOf(NotFoundException);
      }
      expect(calendars.findFeedOwner).not.toHaveBeenCalled();
    });

    it('an unknown or revoked token is the same 404, looked up by hash', async () => {
      const { service, calendars } = setup();
      const token = 'a'.repeat(43);
      await expect(service.feed(token)).rejects.toBeInstanceOf(NotFoundException);
      expect(calendars.findFeedOwner).toHaveBeenCalledWith(hashToken(token));
    });
  });

  describe('iCal document — what a calendar app receives', () => {
    const TOKEN = 'b'.repeat(43);

    function withFeed() {
      const ctx = setup();
      ctx.calendars.findFeedOwner.mockResolvedValue({
        serviceProviderId: PROVIDER,
        timeZone: 'America/Toronto',
      });
      return ctx;
    }

    it('reads through the lean projection — never the owner’s detailed one', async () => {
      const { service, events } = withFeed();
      await service.feed(TOKEN);
      await service.exportMine(USER);
      expect(events.findDated).toHaveBeenCalledTimes(2);
      // The detailed read carries the title, the address and the client's name.
      expect(events.findForOwner).not.toHaveBeenCalled();
    });

    it('names an entry after the catalogue, links back to Linkr, and marks a pending one', async () => {
      const { service, events, calendars } = withFeed();
      events.findDated.mockResolvedValue([
        baseEvent(),
        baseEvent({ id: 'req-open', status: ServiceRequestStatus.OPEN }),
        baseEvent({
          id: 'req-tender',
          requestType: ServiceRequestType.PROJECT_TENDER,
          anchorAtUtc: new Date('2026-11-20T12:00:00Z'),
          itemNameTranslations: null,
        }),
        baseEvent({ id: 'req-undated', anchorAtUtc: null }),
      ]);
      calendars.findTimeOffOverlapping.mockResolvedValue([timeOff()]);

      const lines = (await service.feed(TOKEN)).split('\r\n');

      expect(lines).toContain('SUMMARY:Linkr · Coiffure — Coupe homme');
      expect(lines).toContain('SUMMARY:Linkr · Coiffure — Coupe homme (à confirmer)');
      expect(lines).toContain('SUMMARY:Linkr · Coiffure');
      expect(lines).toContain('SUMMARY:Indisponible — Vacances');
      expect(lines).toContain('UID:demande-req-1@linkr');
      expect(lines).toContain('URL:https://linkr.test/calendrier');
      expect(lines).toContain('DTSTART:20261117T150000Z');
      expect(lines).toContain('DTEND:20261117T160000Z');
      expect(lines).toContain('DTSTART;VALUE=DATE:20261120');
      expect(lines.filter((l) => l === 'STATUS:TENTATIVE')).toHaveLength(1);
      // The undated job has nowhere to sit on a calendar.
      expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(4);
    });

    it('covers a bounded window around now', async () => {
      const { service, events } = withFeed();
      await service.feed(TOKEN);
      const [, from, to] = events.findDated.mock.calls[0] as [string, Date, Date];
      expect(from.toISOString()).toBe('2026-10-17T15:00:00.000Z');
      expect(to.toISOString()).toBe('2027-05-15T15:00:00.000Z');
    });
  });

  describe('availability — what another user sees', () => {
    const slotsOf = (dto: Awaited<ReturnType<CalendarService['availability']>>, date: string) =>
      (dto.days.find((d) => d.date === date)?.slots ?? []).map((s) => [
        s.startAtUtc.toISOString(),
        s.endAtUtc.toISOString(),
      ]);

    it('404 when the provider is not visible', async () => {
      const { service, providers } = setup();
      providers.findById.mockResolvedValue(null);
      await expect(service.availability(PROVIDER, 14)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('publishes nothing — not even the hours — without a schedule', async () => {
      const { service, calendars, events } = setup();
      calendars.findByProvider.mockResolvedValue(null);
      const dto = await service.availability(PROVIDER, 3);
      expect(dto.published).toBe(false);
      expect(dto.weeklyHours).toEqual([]);
      expect(dto.days.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
      expect(dto.days.every((d) => d.slots.length === 0)).toBe(true);
      // Nothing to compute: no appointment is even read.
      expect(events.findDated).not.toHaveBeenCalled();
    });

    it('publishes nothing for a PAUSED provider, whatever his schedule', async () => {
      const { service, providers } = setup();
      providers.findById.mockResolvedValue({ id: PROVIDER, isActive: false });
      const dto = await service.availability(PROVIDER, 3);
      expect(dto).toMatchObject({ published: false, weeklyHours: [] });
      expect(dto.days.every((d) => d.slots.length === 0)).toBe(true);
    });

    it('applies the booking lead time to today', async () => {
      const { service } = setup();
      const dto = await service.availability(PROVIDER, 2);
      // 10 h now + 2 h of lead time → today opens at noon (17:00Z), not at 9 h.
      expect(slotsOf(dto, '2026-11-16')).toEqual([
        ['2026-11-16T17:00:00.000Z', '2026-11-16T22:00:00.000Z'],
      ]);
      expect(slotsOf(dto, '2026-11-17')).toEqual([
        ['2026-11-17T14:00:00.000Z', '2026-11-17T22:00:00.000Z'],
      ]);
    });

    it('removes a confirmed appointment and a blocked period', async () => {
      const { service, events, calendars } = setup();
      events.findDated.mockResolvedValue([baseEvent()]); // Tuesday 10 h–11 h
      calendars.findTimeOffOverlapping.mockResolvedValue([timeOff()]); // all Wednesday
      const dto = await service.availability(PROVIDER, 3);
      expect(slotsOf(dto, '2026-11-17')).toEqual([
        ['2026-11-17T14:00:00.000Z', '2026-11-17T15:00:00.000Z'],
        ['2026-11-17T16:00:00.000Z', '2026-11-17T22:00:00.000Z'],
      ]);
      expect(slotsOf(dto, '2026-11-18')).toEqual([]);
    });

    it.each([
      ['a booking still OPEN', { status: ServiceRequestStatus.OPEN }],
      ['a job already COMPLETED', { status: ServiceRequestStatus.COMPLETED }],
      [
        'an accepted tender (a day, not an hour)',
        {
          requestType: ServiceRequestType.PROJECT_TENDER,
          anchorAtUtc: new Date('2026-11-17T12:00:00Z'),
        },
      ],
    ])('does NOT remove time for %s', async (_label, over) => {
      const { service, events } = setup();
      events.findDated.mockResolvedValue([baseEvent(over)]);
      const dto = await service.availability(PROVIDER, 2);
      expect(slotsOf(dto, '2026-11-17')).toEqual([
        ['2026-11-17T14:00:00.000Z', '2026-11-17T22:00:00.000Z'],
      ]);
    });

    it('serves FREE TIME ONLY: nothing of the appointment or of the label leaks', async () => {
      const { service, events, calendars } = setup();
      // Even if a detailed record reached this path, nothing of it may come out.
      events.findDated.mockResolvedValue([detailEvent()]);
      calendars.findTimeOffOverlapping.mockResolvedValue([timeOff({ label: 'Chimio' })]);
      const dto = await service.availability(PROVIDER, 7);

      const wire = JSON.stringify(dto);
      for (const secret of [SECRET_TITLE, SECRET_ADDRESS, SECRET_CLIENT, 'Chimio', 'req-1', 'off-1']) {
        expect(wire).not.toContain(secret);
      }
      expect(Object.keys(dto).sort()).toEqual(['days', 'published', 'timeZone', 'weeklyHours']);
      expect(Object.keys(dto.days[0]).sort()).toEqual(['date', 'slots']);
      expect(Object.keys(dto.days[1].slots[0]).sort()).toEqual(['endAtUtc', 'startAtUtc']);
      // And the read that feeds it is the lean one.
      expect(events.findForOwner).not.toHaveBeenCalled();
    });
  });
});
