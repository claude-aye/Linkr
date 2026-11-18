'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { MIN_BLOCK_MINUTES, minutesLabel, type DayBlock } from '@/lib/calendar/calendar-rules';

/**
 * The calendar itself: the week grid, the month grid, the phone agenda, and
 * the details sheet of one entry.
 *
 * ⚠️ EVERY STRING ARRIVES RESOLVED FROM THE SERVER (`page.tsx`): labels, times,
 * dates, status wording. This island formats NOTHING — no `Intl`, no date
 * arithmetic, no « now ». Two reasons: the server and the browser can ship
 * different ICU data (a hydration mismatch waiting to happen), and the calendar
 * is drawn in the CALENDAR'S time zone, which the browser's clock knows nothing
 * about. All this component holds is which entry is open.
 *
 * The details sheet is a native `<dialog>` (`showModal()`): focus trap, inert
 * background and Escape come from the platform.
 */

export type EntryTone = 'confirmed' | 'pending' | 'done' | 'off';

export interface EntryView {
  id: string;
  tone: EntryTone;
  /** Short line drawn inside a block or a chip. */
  title: string;
  /** « 10 h 00 – 11 h 00 », « Toute la journée ». */
  timeLabel: string;
  /** Full sentence for the sheet: « mardi 17 novembre, 10 h 00 – 11 h 00 ». */
  whenLabel: string;
  /** Read by a screen reader on the block. */
  ariaLabel: string;
  statusLabel: string;
  /** Rows of the sheet, in order. Only the ones that apply. */
  details: Array<{ term: string; value: string }>;
  /** Optional note under the rows (pending request, blocked period…). */
  note: string | null;
  link: { href: string; label: string } | null;
}

export interface BoardDay {
  date: string;
  weekdayShort: string;
  dayNumber: string;
  /** « lundi 16 novembre ». */
  longLabel: string;
  isToday: boolean;
  inMonth: boolean;
  /** Link to the week of this day (month view). */
  weekHref: string;
  /** Opening ranges of the weekday — the lighter bands of the grid. */
  open: Array<{ startMinute: number; endMinute: number }>;
  allDayIds: string[];
  blocks: DayBlock[];
  /** Every entry of the day in reading order (agenda and month chips). */
  entryIds: string[];
}

export interface CalendarBoardProps {
  view: 'semaine' | 'mois';
  days: BoardDay[];
  /** Vertical span of the week grid, whole hours. */
  span: { startMinute: number; endMinute: number };
  entries: Record<string, EntryView>;
  /** Where « now » is, when it is inside the shown week. */
  nowLine: { date: string; minute: number } | null;
}

const HOUR_REM = 3.25;

const TONE_BLOCK: Record<EntryTone, string> = {
  confirmed: 'bg-accent text-on-accent shadow-sm hover:bg-accent/90',
  pending:
    'border border-dashed border-accent bg-bg text-accent hover:bg-accent/10',
  done: 'bg-text/10 text-text-muted hover:bg-text/15',
  off: 'border border-edge bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.05)_6px_12px)] text-text-muted hover:bg-text/5',
};

const TONE_DOT: Record<EntryTone, string> = {
  confirmed: 'bg-accent',
  pending: 'border border-accent bg-bg',
  done: 'bg-text/30',
  off: 'bg-text/20',
};

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function CalendarBoard({ view, days, span, entries, nowLine }: CalendarBoardProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  function open(id: string, element: HTMLElement) {
    opener.current = element;
    setOpenId(id);
  }

  function close() {
    setOpenId(null);
    // The sheet was modal: hand the focus back to what opened it.
    opener.current?.focus();
  }

  const openEntry = openId ? (entries[openId] ?? null) : null;

  return (
    <>
      {view === 'semaine' ? (
        <>
          <WeekGrid days={days} span={span} entries={entries} nowLine={nowLine} onOpen={open} />
          <Agenda days={days} entries={entries} onOpen={open} />
        </>
      ) : (
        <MonthGrid days={days} entries={entries} onOpen={open} />
      )}
      <EntrySheet entry={openEntry} onClose={close} />
    </>
  );
}

type OpenHandler = (id: string, element: HTMLElement) => void;

// ── Week grid (md and up) ───────────────────────────────────────────────────

function WeekGrid({
  days,
  span,
  entries,
  nowLine,
  onOpen,
}: {
  days: BoardDay[];
  span: { startMinute: number; endMinute: number };
  entries: Record<string, EntryView>;
  nowLine: { date: string; minute: number } | null;
  onOpen: OpenHandler;
}) {
  const total = span.endMinute - span.startMinute;
  const hours: number[] = [];
  for (let m = span.startMinute; m < span.endMinute; m += 60) hours.push(m);
  const height = `${(total / 60) * HOUR_REM}rem`;
  const top = (minute: number) => `${((minute - span.startMinute) / total) * 100}%`;
  const hasAllDay = days.some((day) => day.allDayIds.length > 0);

  return (
    <div className="hidden overflow-hidden rounded-2xl border border-edge bg-surface md:block">
      {/* Day headers */}
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-edge">
        <div aria-hidden="true" />
        {days.map((day) => (
          <div
            key={day.date}
            className="flex flex-col items-center gap-0.5 border-l border-edge px-1 py-2 text-center"
          >
            <span className="text-xs font-medium text-text-muted">{day.weekdayShort}</span>
            <span
              className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${
                day.isToday ? 'bg-accent text-on-accent' : 'text-text'
              }`}
            >
              <span aria-hidden="true">{day.dayNumber}</span>
              <span className="sr-only">
                {day.longLabel}
                {day.isToday ? ' (aujourd’hui)' : ''}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Day-long entries */}
      {hasAllDay && (
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-edge">
          <div className="px-1 py-2 text-right text-[0.6875rem] leading-tight text-text-muted">
            Journée
          </div>
          {days.map((day) => (
            <div key={day.date} className="flex flex-col gap-1 border-l border-edge p-1">
              {day.allDayIds.map((id) => {
                const entry = entries[id];
                if (!entry) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={(event) => onOpen(id, event.currentTarget)}
                    aria-label={entry.ariaLabel}
                    className={`min-h-8 truncate rounded-lg px-2 text-left text-xs font-medium transition motion-reduce:transition-none ${TONE_BLOCK[entry.tone]} ${focusRing}`}
                  >
                    {entry.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Hours */}
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <div className="relative" style={{ height }} aria-hidden="true">
          {hours.map((minute) => (
            <span
              key={minute}
              className="absolute right-2 -translate-y-1/2 text-[0.6875rem] text-text-muted first:translate-y-0.5"
              style={{ top: top(minute) }}
            >
              {minutesLabel(minute)}
            </span>
          ))}
        </div>

        {days.map((day) => (
          <div
            key={day.date}
            className="relative border-l border-edge bg-text/[0.035]"
            style={{ height }}
          >
            {/* Opening hours: the lighter bands. Outside them the column keeps
                the tinted background — closed, at a glance. */}
            {day.open.map((range) => (
              <div
                key={`${range.startMinute}-${range.endMinute}`}
                aria-hidden="true"
                className="absolute inset-x-0 bg-surface"
                style={{
                  top: top(Math.max(range.startMinute, span.startMinute)),
                  height: `${((Math.min(range.endMinute, span.endMinute) - Math.max(range.startMinute, span.startMinute)) / total) * 100}%`,
                }}
              />
            ))}
            {hours.slice(1).map((minute) => (
              <div
                key={minute}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-edge/60"
                style={{ top: top(minute) }}
              />
            ))}

            {day.blocks.map((block) => {
              const entry = entries[block.id];
              if (!entry) return null;
              const start = Math.max(block.startMinute, span.startMinute);
              const end = Math.min(
                Math.max(block.endMinute, block.startMinute + MIN_BLOCK_MINUTES),
                span.endMinute,
              );
              if (end <= start) return null;
              const width = 100 / block.columns;
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={(event) => onOpen(block.id, event.currentTarget)}
                  aria-label={entry.ariaLabel}
                  className={`absolute z-10 flex flex-col overflow-hidden rounded-lg px-1.5 py-1 text-left transition motion-reduce:transition-none ${TONE_BLOCK[entry.tone]} ${focusRing}`}
                  style={{
                    top: top(start),
                    height: `calc(${((end - start) / total) * 100}% - 2px)`,
                    left: `calc(${block.column * width}% + 2px)`,
                    width: `calc(${width}% - 4px)`,
                  }}
                >
                  <span className="truncate text-xs font-semibold leading-tight">
                    {entry.title}
                  </span>
                  <span className="truncate text-[0.6875rem] leading-tight opacity-90">
                    {entry.timeLabel}
                  </span>
                </button>
              );
            })}

            {nowLine && nowLine.date === day.date && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                style={{ top: top(nowLine.minute) }}
              >
                <span className="-ml-1 size-2 rounded-full bg-red-600" />
                <span className="h-px flex-1 bg-red-600" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agenda (phones) ─────────────────────────────────────────────────────────

function Agenda({
  days,
  entries,
  onOpen,
}: {
  days: BoardDay[];
  entries: Record<string, EntryView>;
  onOpen: OpenHandler;
}) {
  return (
    <ol className="space-y-3 md:hidden">
      {days.map((day) => (
        <li key={day.date} className="rounded-2xl border border-edge bg-surface p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            <span className="first-letter:uppercase">{day.longLabel}</span>
            {day.isToday && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-on-accent">
                Aujourd’hui
              </span>
            )}
          </h3>
          {day.entryIds.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">Rien de prévu.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {day.entryIds.map((id) => {
                const entry = entries[id];
                if (!entry) return null;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={(event) => onOpen(id, event.currentTarget)}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-2xl border border-edge px-3 py-2 text-left transition hover:bg-text/5 motion-reduce:transition-none ${focusRing}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`size-2.5 shrink-0 rounded-full ${TONE_DOT[entry.tone]}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">
                          {entry.title}
                        </span>
                        <span className="block text-xs text-text-muted">
                          {entry.timeLabel} · {entry.statusLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

// ── Month grid ──────────────────────────────────────────────────────────────

const MONTH_CHIPS = 3;

function MonthGrid({
  days,
  entries,
  onOpen,
}: {
  days: BoardDay[];
  entries: Record<string, EntryView>;
  onOpen: OpenHandler;
}) {
  const header = days.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
      <div className="grid grid-cols-7 border-b border-edge">
        {header.map((day) => (
          <div
            key={day.date}
            className="px-1 py-2 text-center text-xs font-medium text-text-muted"
          >
            {day.weekdayShort}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const shown = day.entryIds.slice(0, MONTH_CHIPS);
          const hidden = day.entryIds.length - shown.length;
          return (
            <div
              key={day.date}
              className={`flex min-h-16 flex-col gap-1 border-edge p-1 md:min-h-28 ${
                index % 7 === 0 ? '' : 'border-l'
              } ${index >= 7 ? 'border-t' : ''} ${day.inMonth ? '' : 'bg-text/[0.035]'}`}
            >
              <Link
                href={day.weekHref}
                className={`flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition hover:bg-text/10 motion-reduce:transition-none md:w-11 md:rounded-full ${
                  day.isToday
                    ? 'bg-accent text-on-accent hover:bg-accent/90'
                    : day.inMonth
                      ? 'text-text'
                      : 'text-text-muted'
                } ${focusRing}`}
              >
                <span aria-hidden="true">{day.dayNumber}</span>
                <span className="sr-only">
                  {day.longLabel}
                  {day.isToday ? ' (aujourd’hui)' : ''}
                  {day.entryIds.length > 0
                    ? `, ${day.entryIds.length} ${day.entryIds.length > 1 ? 'éléments' : 'élément'}`
                    : ''}
                  . Voir la semaine.
                </span>
              </Link>

              {/* Phones: dots only — a chip would not fit a 48 px cell. The
                  day number above opens the week, where everything is listed. */}
              {day.entryIds.length > 0 && (
                <div aria-hidden="true" className="flex justify-center gap-1 md:hidden">
                  {day.entryIds.slice(0, 4).map((id) => (
                    <span
                      key={id}
                      className={`size-1.5 rounded-full ${TONE_DOT[entries[id]?.tone ?? 'done']}`}
                    />
                  ))}
                </div>
              )}

              <ul className="hidden flex-col gap-1 md:flex">
                {shown.map((id) => {
                  const entry = entries[id];
                  if (!entry) return null;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={(event) => onOpen(id, event.currentTarget)}
                        aria-label={entry.ariaLabel}
                        className={`block min-h-6 w-full truncate rounded-md px-1.5 text-left text-[0.6875rem] font-medium leading-6 transition motion-reduce:transition-none ${TONE_BLOCK[entry.tone]} ${focusRing}`}
                      >
                        {entry.title}
                      </button>
                    </li>
                  );
                })}
                {hidden > 0 && (
                  <li className="px-1.5 text-[0.6875rem] text-text-muted">
                    + {hidden} {hidden > 1 ? 'autres' : 'autre'}
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Details sheet ───────────────────────────────────────────────────────────

const TONE_BADGE: Record<EntryTone, string> = {
  confirmed: 'bg-accent text-on-accent',
  pending: 'border border-accent text-accent',
  done: 'bg-text/10 text-text-muted',
  off: 'bg-text/10 text-text-muted',
};

function EntrySheet({ entry, onClose }: { entry: EntryView | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // `entry` is the single source of truth; showModal()/close() are imperative
  // and throw or no-op depending on `open`, so each call is guarded.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (entry && !dialog.open) dialog.showModal();
    if (!entry && dialog.open) dialog.close();
  }, [entry]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Escape and a backdrop click both end here.
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-[92vw] max-w-md rounded-2xl border border-edge bg-bg p-0 text-text shadow-xl backdrop:bg-black/40"
    >
      {entry && (
        <div className="space-y-4 p-6">
          <div className="space-y-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_BADGE[entry.tone]}`}
            >
              {entry.statusLabel}
            </span>
            <h2 id={titleId} className="text-lg font-semibold text-text">
              {entry.title}
            </h2>
            <p className="text-sm text-text-muted first-letter:uppercase">{entry.whenLabel}</p>
          </div>

          {entry.details.length > 0 && (
            <dl className="space-y-2 text-sm">
              {entry.details.map((row) => (
                <div key={row.term}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    {row.term}
                  </dt>
                  <dd className="mt-0.5 break-words text-text">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {entry.note && <p className="text-sm text-text-muted">{entry.note}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={`min-h-11 rounded-2xl border border-edge px-4 text-sm font-medium text-text-muted transition hover:bg-text/5 ${focusRing}`}
            >
              Fermer
            </button>
            {entry.link && (
              <Link
                href={entry.link.href}
                className={`inline-flex min-h-11 items-center rounded-2xl bg-accent px-4 text-sm font-medium text-on-accent shadow-sm transition hover:bg-accent/90 ${focusRing}`}
              >
                {entry.link.label}
              </Link>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
