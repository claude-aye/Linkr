import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import {
  CALENDAR_DEFAULT_TIME_ZONE,
  MINUTES_PER_DAY,
  type CalendarView,
  type DateKey,
  type DayBlock,
  type TimedItem,
  WEEKDAY_SHORT_LABELS,
  addDays,
  calendarHref,
  dateKeyInZone,
  dayLongLabel,
  durationLabel,
  gridSpan,
  isSameMonth,
  isoWeekday,
  layoutDay,
  minuteOfDayInZone,
  parseAnchor,
  parseDateKey,
  parseView,
  periodLabel,
  periodWhenLabel,
  rangesOfWeekday,
  shiftAnchor,
  startOfMonth,
  timeLabel,
  viewDays,
  zoneGenericLabel,
  zonedTimeToUtcMs,
} from '@/lib/calendar/calendar-rules';
import { formatDate } from '@/lib/dates/format';
import { pickTranslation } from '@/lib/i18n/translations';

import {
  CalendarBoard,
  type BoardDay,
  type EntryTone,
  type EntryView,
} from './_components/calendar-board';
import { CalendarSyncPanel } from './_components/calendar-sync-panel';
import { cardClass } from './_components/styles';
import { TimeOffPanel, type TimeOffView } from './_components/time-off-panel';
import { WeeklyHoursEditor } from './_components/weekly-hours-editor';

/**
 * The provider's calendar — `/calendrier`.
 *
 * ⚠️ THE PATH IS QUASI-IMMUTABLE: every exported or subscribed `.ics` entry
 * links back to it (`URL:` and the description), and a calendar entry sitting
 * in someone's Outlook outlives any refactor. If it ever has to move, the old
 * path must keep redirecting.
 *
 * Server Component: ONE read (`GET /service-providers/me/calendar`) carries the
 * appointments, the blocked periods, the opening hours and the feed status.
 * The view and the period live in the URL (`?vue=`, `?date=`) — no client
 * store, so « précédent », a bookmark and a shared link all land where they
 * say. Mutations go through the BFF relays and end with `router.refresh()`.
 *
 * ⚠️ APPOINTMENTS ARE NOT STORED IN THE CALENDAR: the API derives them from the
 * service requests at read time, so this page cannot disagree with the Espace
 * pro. It follows that nothing is rescheduled from here — a booking's hour is
 * the one the client offered and the provider accepted.
 *
 * Everything is drawn in the CALENDAR'S time zone (the IANA name the API
 * returns), and every label is resolved HERE, on the server: the client island
 * only holds which entry is open.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Calendrier' };

type ProviderCalendar = components['schemas']['ProviderCalendarDto'];
type CalendarEvent = components['schemas']['CalendarEventDto'];
type TimeOff = components['schemas']['TimeOffDto'];

const MS_PER_DAY = 86_400_000;

/** Read once per render, outside the component (the render itself stays pure). */
function currentTimeMs(): number {
  return Date.now();
}

/**
 * Calendar wording of a request status — a LOCAL map, like the dashboard's and
 * `/requests`'s (the shared status helper is a tracked debt, neither widened
 * nor paid here). The vocabulary differs on purpose: on a calendar an ASSIGNED
 * job reads « Confirmé ».
 */
const STATUS_VIEW: Record<CalendarEvent['status'], { label: string; tone: EntryTone }> = {
  DRAFT: { label: 'Brouillon', tone: 'done' },
  OPEN: { label: 'À confirmer', tone: 'pending' },
  ASSIGNED: { label: 'Confirmé', tone: 'confirmed' },
  IN_PROGRESS: { label: 'En cours', tone: 'confirmed' },
  COMPLETED: { label: 'Terminé', tone: 'done' },
  PAID: { label: 'Payé', tone: 'done' },
  EXPIRED: { label: 'Expirée', tone: 'done' },
  CANCELLED: { label: 'Annulée', tone: 'done' },
  REFUNDED: { label: 'Remboursée', tone: 'done' },
};

const ALL_DAY_LABEL = 'Toute la journée';

function tradeLine(event: CalendarEvent): string {
  const trade = pickTranslation(event.serviceCategoryNameTranslations);
  if (!event.serviceItemNameTranslations) return trade;
  return `${trade} · ${pickTranslation(event.serviceItemNameTranslations)}`;
}

function eventLink(event: CalendarEvent): EntryView['link'] {
  return event.kind === 'PENDING_REQUEST'
    ? { href: '/dashboard?onglet=en-attente', label: 'Répondre à la demande' }
    : { href: '/dashboard?onglet=jobs', label: 'Voir dans Mes jobs' };
}

/** The sheet and the block of one appointment — every string resolved here. */
function toEventEntry(event: CalendarEvent, timeZone: string): EntryView {
  const status = STATUS_VIEW[event.status];
  const details: EntryView['details'] = [
    { term: 'Service', value: tradeLine(event) },
    { term: 'Client', value: event.clientDisplayName },
    { term: 'Adresse', value: event.serviceAddress },
  ];

  let timeText = ALL_DAY_LABEL;
  let whenLabel = '';
  let note: string | null = null;

  if (event.timing === 'TIMED' && event.startAtUtc && event.endAtUtc) {
    const startMs = Date.parse(event.startAtUtc);
    const endMs = Date.parse(event.endAtUtc);
    timeText = `${timeLabel(startMs, timeZone)} – ${timeLabel(endMs, timeZone)}`;
    whenLabel = `${dayLongLabel(dateKeyInZone(startMs, timeZone))}, ${timeText}`;
    if (event.durationMinutes) {
      details.push({ term: 'Durée prévue', value: durationLabel(event.durationMinutes) });
    }
    // The window the client offered, when it says more than the block does.
    if (event.windowEndAtUtc && Date.parse(event.windowEndAtUtc) !== endMs) {
      details.push({
        term: 'Disponibilité du client',
        value: `jusqu’à ${timeLabel(Date.parse(event.windowEndAtUtc), timeZone)}`,
      });
    }
    if (event.kind === 'PENDING_REQUEST') {
      note =
        'Cette demande attend votre réponse. En attendant, ce créneau n’est plus proposé aux autres clients ; sans réponse de votre part, la demande expire au plus tard à l’heure demandée.';
    }
  } else if (event.timing === 'ALL_DAY' && event.date) {
    whenLabel = `${dayLongLabel(event.date)}, date proposée dans votre devis`;
    if (event.durationMinutes) {
      details.push({ term: 'Durée annoncée', value: durationLabel(event.durationMinutes) });
    }
    note =
      'Votre devis propose une date, pas une heure : ce rendez-vous ne retire aucun créneau de vos disponibilités. Ajoutez une indisponibilité si vous voulez bloquer la journée.';
  } else {
    whenLabel = 'Date à convenir';
    note = 'Rien ne date encore ce travail : il n’apparaît pas dans la grille.';
  }

  return {
    id: event.id,
    tone: status.tone,
    title: event.title,
    timeLabel: timeText,
    whenLabel,
    ariaLabel: `${event.title}, ${whenLabel}, ${status.label}`,
    statusLabel: status.label,
    details,
    note,
    link: eventLink(event),
  };
}

const timeOffEntryId = (id: string) => `off:${id}`;

function toTimeOffEntry(period: TimeOff, timeZone: string): EntryView {
  const startMs = Date.parse(period.startsAtUtc);
  const endMs = Date.parse(period.endsAtUtc);
  const whenLabel = periodWhenLabel(startMs, endMs, timeZone);
  const sameDay =
    dateKeyInZone(startMs, timeZone) === dateKeyInZone(endMs - 1, timeZone);
  const title = period.label ?? 'Indisponible';
  return {
    id: timeOffEntryId(period.id),
    tone: 'off',
    title,
    timeLabel: sameDay
      ? `${timeLabel(startMs, timeZone)} – ${timeLabel(endMs, timeZone)}`
      : 'Indisponible',
    whenLabel,
    ariaLabel: `Indisponibilité : ${title}, ${whenLabel}`,
    statusLabel: 'Indisponible',
    details: [],
    note:
      'Aucun créneau n’est proposé aux clients pendant cette période. Vous pouvez la supprimer dans la section « Indisponibilités », plus bas.',
    link: null,
  };
}

function toTimeOffView(period: TimeOff, timeZone: string, nowMs: number): TimeOffView {
  const startMs = Date.parse(period.startsAtUtc);
  return {
    id: period.id,
    whenLabel: periodWhenLabel(startMs, Date.parse(period.endsAtUtc), timeZone),
    label: period.label,
    ongoing: startMs <= nowMs,
  };
}

/** « heure de l’Est (America/Toronto) » — what the hours on this page are expressed in. */
function timeZoneLabel(timeZone: string, nowMs: number): string {
  const name = zoneGenericLabel(timeZone, nowMs);
  return name === timeZone ? timeZone : `${name} (${timeZone})`;
}

interface Board {
  days: BoardDay[];
  span: { startMinute: number; endMinute: number };
  entries: Record<string, EntryView>;
  nowLine: { date: string; minute: number } | null;
  confirmedCount: number;
  pendingCount: number;
}

/** Lays the read out on the days of the view. Pure given its inputs. */
function buildBoard(
  calendar: ProviderCalendar,
  view: CalendarView,
  anchor: DateKey,
  today: DateKey,
  nowMs: number,
): Board {
  const timeZone = calendar.timeZone;
  const dates = viewDays(view, anchor);
  const entries: Record<string, EntryView> = {};

  const timedEvents: TimedItem[] = [];
  const allDayByDate = new Map<DateKey, string[]>();
  let confirmedCount = 0;
  let pendingCount = 0;

  for (const event of calendar.events) {
    entries[event.id] = toEventEntry(event, timeZone);
    if (event.timing === 'TIMED' && event.startAtUtc && event.endAtUtc) {
      timedEvents.push({
        id: event.id,
        startMs: Date.parse(event.startAtUtc),
        endMs: Date.parse(event.endAtUtc),
      });
    } else if (event.timing === 'ALL_DAY' && event.date) {
      allDayByDate.set(event.date, [...(allDayByDate.get(event.date) ?? []), event.id]);
    }
  }

  const timeOffItems: TimedItem[] = calendar.timeOff.map((period) => {
    const entry = toTimeOffEntry(period, timeZone);
    entries[entry.id] = entry;
    return {
      id: entry.id,
      startMs: Date.parse(period.startsAtUtc),
      endMs: Date.parse(period.endsAtUtc),
    };
  });

  const spanInputs: Array<{ startMinute: number; endMinute: number }> = [];
  const visibleEventIds = new Set<string>();

  const days: BoardDay[] = dates.map((date) => {
    const parsed = parseDateKey(date);
    const weekday = isoWeekday(date);
    const open = rangesOfWeekday(calendar.weeklyHours, weekday).map((range) => ({
      startMinute: range.startMinute,
      endMinute: range.endMinute,
    }));

    // A blocked period covering the WHOLE day goes to the « Journée » row: as
    // a full-height block it would bury every appointment of the column.
    const offBlocks = layoutDay(timeOffItems, date, timeZone);
    const wholeDayOff = new Set(
      offBlocks
        .filter((b) => b.startMinute === 0 && b.endMinute === MINUTES_PER_DAY)
        .map((b) => b.id),
    );
    const partialOff = timeOffItems.filter(
      (item) => !wholeDayOff.has(item.id) && offBlocks.some((b) => b.id === item.id),
    );

    const blocks: DayBlock[] = layoutDay([...timedEvents, ...partialOff], date, timeZone);
    const allDayIds = [...wholeDayOff, ...(allDayByDate.get(date) ?? [])];

    for (const block of blocks) spanInputs.push(block);
    spanInputs.push(...open);
    for (const id of [...allDayIds, ...blocks.map((b) => b.id)]) visibleEventIds.add(id);

    return {
      date,
      weekdayShort: WEEKDAY_SHORT_LABELS[weekday],
      dayNumber: String(parsed?.day ?? ''),
      longLabel: dayLongLabel(date),
      isToday: date === today,
      inMonth: view === 'semaine' ? true : isSameMonth(date, anchor),
      weekHref: calendarHref('semaine', date),
      open,
      allDayIds,
      blocks,
      entryIds: [...allDayIds, ...blocks.map((b) => b.id)],
    };
  });

  for (const event of calendar.events) {
    if (!visibleEventIds.has(event.id)) continue;
    if (event.kind === 'PENDING_REQUEST') pendingCount += 1;
    else if (event.status === 'ASSIGNED' || event.status === 'IN_PROGRESS') confirmedCount += 1;
  }

  const span = gridSpan(spanInputs);
  const nowMinute = minuteOfDayInZone(nowMs, timeZone);
  const nowLine =
    view === 'semaine' &&
    dates.includes(today) &&
    nowMinute >= span.startMinute &&
    nowMinute <= span.endMinute
      ? { date: today, minute: nowMinute }
      : null;

  return { days, span, entries, nowLine, confirmedCount, pendingCount };
}

function StateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-8 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <div className="mt-2 text-sm text-text-muted">{children}</div>
    </div>
  );
}

const navLinkClass =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border border-edge px-3 text-sm font-medium text-text-muted transition hover:bg-text/5 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  // `searchParams` is a Promise in Next 16 — awaited below.
  searchParams: Promise<{ vue?: string; date?: string }>;
}) {
  // Session gate — `redirect` throws, so it stays outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { vue, date } = await searchParams;
  const view = parseView(vue);
  const nowMs = currentTimeMs();

  // The window is computed BEFORE the read, hence in the default zone; it is
  // padded by a day on each side so a calendar kept in another zone still gets
  // every entry of the days shown. The layout below uses the zone the API says.
  const provisionalToday = dateKeyInZone(nowMs, CALENDAR_DEFAULT_TIME_ZONE);
  const anchor = parseAnchor(date, provisionalToday);
  const dates = viewDays(view, anchor);
  const fromMs = zonedTimeToUtcMs(dates[0], 0, CALENDAR_DEFAULT_TIME_ZONE) - MS_PER_DAY;
  const toMs =
    zonedTimeToUtcMs(addDays(dates[dates.length - 1], 1), 0, CALENDAR_DEFAULT_TIME_ZONE) +
    MS_PER_DAY;

  const client = await getServerApiClient();
  let calendar: ProviderCalendar | null = null;
  let notPro = false;

  try {
    const { data, error, response } = await client.GET('/service-providers/me/calendar', {
      params: {
        query: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      },
    });
    if (response.status === 404) {
      // No provider profile: this 404 IS the detection, no extra request.
      notPro = true;
    } else if (!error && response.ok && data) {
      calendar = data;
    }
  } catch {
    calendar = null;
  }

  if (notPro) {
    return (
      <main className="flex flex-1 justify-center bg-bg p-6">
        <section className="w-full max-w-3xl">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-text">Calendrier</h1>
          <StateCard title="Le calendrier est réservé aux prestataires">
            <p>Créez votre profil pour gérer vos disponibilités et vos rendez-vous.</p>
            <div className="mt-6">
              <Link
                href="/providers/new"
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-sm transition hover:bg-accent/90"
              >
                Devenir prestataire
              </Link>
            </div>
          </StateCard>
        </section>
      </main>
    );
  }

  if (!calendar) {
    return (
      <main className="flex flex-1 justify-center bg-bg p-6">
        <section className="w-full max-w-3xl">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-text">Calendrier</h1>
          <StateCard title="Chargement impossible">
            Votre calendrier n’a pas pu être récupéré. Veuillez réessayer plus tard.
          </StateCard>
        </section>
      </main>
    );
  }

  const timeZone = calendar.timeZone;
  const today = dateKeyInZone(nowMs, timeZone);
  const board = buildBoard(calendar, view, anchor, today, nowMs);
  const upcomingTimeOff = calendar.upcomingTimeOff.map((period) =>
    toTimeOffView(period, timeZone, nowMs),
  );
  const unscheduled = calendar.unscheduled.map((event) => ({
    id: event.id,
    title: event.title,
    line: `${tradeLine(event)} · ${event.clientDisplayName}`,
    status: STATUS_VIEW[event.status].label,
  }));
  const hasHours = calendar.weeklyHours.length > 0;

  // « Aujourd'hui » resets the period but keeps the view.
  const todayHref = calendarHref(view, null);
  const previousHref = calendarHref(view, shiftAnchor(view, anchor, -1));
  const nextHref = calendarHref(view, shiftAnchor(view, anchor, 1));
  // Switching view keeps the period in sight: the month of the shown week, or
  // the week of today / of the 1st of the shown month.
  const weekViewHref = calendarHref(
    'semaine',
    isSameMonth(today, anchor) ? today : startOfMonth(anchor),
  );
  const monthViewHref = calendarHref('mois', anchor);

  const summary = [
    plural(board.confirmedCount, 'rendez-vous confirmé', 'rendez-vous confirmés'),
    ...(board.pendingCount > 0
      ? [plural(board.pendingCount, 'demande à confirmer', 'demandes à confirmer')]
      : []),
  ].join(' · ');

  return (
    <main className="flex flex-1 justify-center bg-bg p-4 sm:p-6">
      <div className="w-full max-w-6xl space-y-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-text">Calendrier</h1>
              <p className="mt-1 text-sm text-text-muted">
                Vos rendez-vous, vos disponibilités et vos indisponibilités.
              </p>
            </div>
            <nav aria-label="Vue du calendrier" className="flex gap-1 rounded-2xl bg-text/5 p-1">
              {(
                [
                  ['semaine', 'Semaine', weekViewHref],
                  ['mois', 'Mois', monthViewHref],
                ] as const
              ).map(([slug, label, href]) => (
                <Link
                  key={slug}
                  href={href}
                  scroll={false}
                  aria-current={view === slug ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    view === slug
                      ? 'bg-accent text-on-accent shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href={todayHref} scroll={false} className={navLinkClass}>
              Aujourd’hui
            </Link>
            <Link
              href={previousHref}
              scroll={false}
              aria-label={view === 'semaine' ? 'Semaine précédente' : 'Mois précédent'}
              className={`${navLinkClass} min-w-11 px-0`}
            >
              <span aria-hidden="true">‹</span>
            </Link>
            <Link
              href={nextHref}
              scroll={false}
              aria-label={view === 'semaine' ? 'Semaine suivante' : 'Mois suivant'}
              className={`${navLinkClass} min-w-11 px-0`}
            >
              <span aria-hidden="true">›</span>
            </Link>
            <h2
              aria-live="polite"
              className="ml-1 text-lg font-semibold text-text first-letter:uppercase"
            >
              {periodLabel(view, anchor)}
            </h2>
            <p className="w-full text-sm text-text-muted sm:ml-auto sm:w-auto">{summary}</p>
          </div>
        </header>

        {!hasHours && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Vous n’avez pas encore publié vos disponibilités : les clients ne voient aucun créneau
            sur votre profil.{' '}
            <a href="#disponibilites" className="font-medium underline underline-offset-2">
              Indiquer mes heures
            </a>
          </p>
        )}

        <section aria-label={`Calendrier, ${periodLabel(view, anchor)}`} className="space-y-3">
          <CalendarBoard
            view={view}
            days={board.days}
            span={board.span}
            entries={board.entries}
            nowLine={board.nowLine}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
              Confirmé
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full border border-dashed border-accent"
              />
              À confirmer
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-text/30" />
              Terminé
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-text/15" />
              Indisponible
            </li>
            <li>Heures locales : {timeZoneLabel(timeZone, nowMs)}</li>
          </ul>
        </section>

        {unscheduled.length > 0 && (
          <section aria-labelledby="a-planifier-title" className="space-y-3">
            <h2 id="a-planifier-title" className="text-lg font-semibold text-text">
              À planifier ({unscheduled.length})
            </h2>
            <p className="text-sm text-text-muted">
              Ces jobs vous sont confiés, mais rien ne les date encore : ils n’apparaissent pas dans
              la grille.
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {unscheduled.map((job) => (
                <li key={job.id} className={cardClass}>
                  <p className="text-sm font-semibold text-text">{job.title}</p>
                  <p className="mt-1 text-sm text-text-muted">{job.line}</p>
                  <p className="mt-1 text-xs text-text-muted">{job.status}</p>
                  <Link
                    href="/dashboard?onglet=jobs"
                    className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
                  >
                    Voir dans Mes jobs →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          <section
            id="disponibilites"
            aria-labelledby="disponibilites-title"
            className="scroll-mt-6 space-y-3"
          >
            <h2 id="disponibilites-title" className="text-lg font-semibold text-text">
              Mes disponibilités
            </h2>
            <WeeklyHoursEditor
              initial={calendar.weeklyHours}
              timeZoneLabel={timeZoneLabel(timeZone, nowMs)}
            />
          </section>

          <div className="space-y-8">
            <section
              id="indisponibilites"
              aria-labelledby="indisponibilites-title"
              className="scroll-mt-6 space-y-3"
            >
              <h2 id="indisponibilites-title" className="text-lg font-semibold text-text">
                Indisponibilités
              </h2>
              <TimeOffPanel items={upcomingTimeOff} timeZone={timeZone} today={today} />
            </section>

            <section
              id="synchronisation"
              aria-labelledby="synchronisation-title"
              className="scroll-mt-6 space-y-3"
            >
              <h2 id="synchronisation-title" className="text-lg font-semibold text-text">
                Synchronisation
              </h2>
              <CalendarSyncPanel
                feedEnabled={calendar.feedEnabled}
                feedSinceLabel={
                  calendar.feedCreatedAtUtc ? formatDate(calendar.feedCreatedAtUtc) : null
                }
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
