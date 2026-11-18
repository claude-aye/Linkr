'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState, useTransition } from 'react';

import {
  WEEKDAY_DISPLAY_ORDER,
  WEEKDAY_LABELS,
  WEEKLY_HOURS_MAX_RANGES_PER_DAY,
  type WeeklyRange,
  minutesLabel,
  rangesOfWeekday,
  suggestRange,
  timeOptions,
  weeklyHoursError,
  weeklyHoursErrorMessage,
} from '@/lib/calendar/calendar-rules';
import { EMAIL_NOT_VERIFIED_MESSAGE, isEmailNotVerified } from '@/lib/email-verification/states';

import {
  errorClass,
  ghostButtonClass,
  hintClass,
  primaryButtonClass,
  selectClass,
} from './styles';

/**
 * Editor of the published weekly opening hours.
 *
 * The schedule is saved AS A WHOLE (`PUT …/weekly-hours` replaces it): the
 * state here is the full list of ranges, edited locally, sent on « Enregistrer ».
 * The same rules as the API run before sending (`weeklyHoursError`), so a 422
 * is unexpected; messages for the rest are chosen by HTTP status alone.
 *
 * Times are quarter-hours from two `<select>`s — never a free time field, whose
 * value the API would refuse off the grid. They are WALL TIME in the calendar's
 * zone, stated under the title: nothing here depends on the browser's clock.
 */

const START_OPTIONS = timeOptions(false);
const END_OPTIONS = timeOptions(true).slice(1);

/** The five working days, 9 h to 17 h — one click for the most common schedule. */
const OFFICE_HOURS: WeeklyRange[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

function sameSchedule(a: readonly WeeklyRange[], b: readonly WeeklyRange[]): boolean {
  const key = (ranges: readonly WeeklyRange[]) =>
    [...ranges]
      .sort((x, y) => x.weekday - y.weekday || x.startMinute - y.startMinute)
      .map((r) => `${r.weekday}:${r.startMinute}-${r.endMinute}`)
      .join('|');
  return key(a) === key(b);
}

export function WeeklyHoursEditor({
  initial,
  timeZoneLabel,
}: {
  initial: WeeklyRange[];
  timeZoneLabel: string;
}) {
  const router = useRouter();
  const [ranges, setRanges] = useState<WeeklyRange[]>(initial);
  // What the server holds, as far as this screen knows: the baseline of « modifié ».
  const [saved, setSaved] = useState<WeeklyRange[]>(initial);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const baseId = useId();

  const busy = saving || refreshing;
  const dirty = !sameSchedule(ranges, saved);

  function update(next: WeeklyRange[]) {
    setRanges(next);
    setError(null);
    setAnnouncement('');
  }

  function setRange(target: WeeklyRange, patch: Partial<WeeklyRange>) {
    update(ranges.map((r) => (r === target ? { ...r, ...patch } : r)));
  }

  function addRange(weekday: number) {
    const suggestion = suggestRange(rangesOfWeekday(ranges, weekday), weekday);
    if (suggestion) update([...ranges, suggestion]);
  }

  function removeRange(target: WeeklyRange) {
    update(ranges.filter((r) => r !== target));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const problem = weeklyHoursError(ranges);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    setAnnouncement('');

    let response: Response;
    try {
      response = await fetch('/api/service-providers/me/calendar/weekly-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyHours: ranges }),
      });
    } catch {
      setSaving(false);
      setError(weeklyHoursErrorMessage(0));
      return;
    }

    if (!response.ok) {
      const notVerified = await isEmailNotVerified(response);
      setSaving(false);
      setError(notVerified ? EMAIL_NOT_VERIFIED_MESSAGE : weeklyHoursErrorMessage(response.status));
      return;
    }

    // The API answers the schedule as STORED (sorted, touching ranges merged):
    // show that, not what was typed.
    let stored: WeeklyRange[] = ranges;
    try {
      const payload = (await response.json()) as { weeklyHours?: WeeklyRange[] };
      if (Array.isArray(payload.weeklyHours)) stored = payload.weeklyHours;
    } catch {
      // Keep the local list: the save succeeded, only the echo is unreadable.
    }
    setRanges(stored);
    setSaved(stored);
    setSaving(false);
    setAnnouncement(
      stored.length === 0
        ? 'Vos disponibilités ne sont plus publiées.'
        : 'Disponibilités enregistrées. Elles sont visibles sur votre profil.',
    );
    // The grid above shades the opening hours: read the page again.
    startRefresh(() => router.refresh());
  }

  return (
    <form method="post" onSubmit={save} noValidate className="space-y-4">
      <p className={hintClass}>
        Indiquez les heures où vous prenez des rendez-vous. Elles s’affichent sur votre profil et
        guident les clients au moment de réserver. Heures locales : {timeZoneLabel}.
      </p>

      <ul className="divide-y divide-edge rounded-2xl border border-edge bg-surface">
        {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
          const day = rangesOfWeekday(ranges, weekday);
          const canAdd = day.length < WEEKLY_HOURS_MAX_RANGES_PER_DAY;
          return (
            <li key={weekday} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <span className="text-sm font-medium text-text sm:w-24 sm:shrink-0 sm:pt-2.5">
                {WEEKDAY_LABELS[weekday]}
              </span>

              <div className="min-w-0 flex-1 space-y-2">
                {day.map((range, index) => {
                  const startId = `${baseId}-${weekday}-${index}-start`;
                  const endId = `${baseId}-${weekday}-${index}-end`;
                  return (
                    // Keyed by POSITION, not by value: a key built from the start
                    // time would remount the `<select>` on every change and
                    // throw the keyboard focus away.
                    <div key={index} className="flex items-center gap-2">
                      <label htmlFor={startId} className="sr-only">
                        {WEEKDAY_LABELS[weekday]}, plage {index + 1}, début
                      </label>
                      <select
                        id={startId}
                        value={range.startMinute}
                        disabled={busy}
                        onChange={(event) =>
                          setRange(range, { startMinute: Number(event.target.value) })
                        }
                        className={selectClass}
                      >
                        {START_OPTIONS.map((minute) => (
                          <option key={minute} value={minute}>
                            {minutesLabel(minute)}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" className="text-text-muted">
                        –
                      </span>
                      <label htmlFor={endId} className="sr-only">
                        {WEEKDAY_LABELS[weekday]}, plage {index + 1}, fin
                      </label>
                      <select
                        id={endId}
                        value={range.endMinute}
                        disabled={busy}
                        onChange={(event) =>
                          setRange(range, { endMinute: Number(event.target.value) })
                        }
                        className={selectClass}
                      >
                        {END_OPTIONS.map((minute) => (
                          <option key={minute} value={minute}>
                            {minutesLabel(minute)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeRange(range)}
                        aria-label={`Retirer la plage ${index + 1} du ${WEEKDAY_LABELS[weekday].toLowerCase()}`}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl text-text-muted transition hover:bg-text/5 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className="size-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.75}
                          strokeLinecap="round"
                        >
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
                <div className="flex items-center gap-3">
                  {day.length === 0 && <span className="text-sm text-text-muted">Fermé</span>}
                  {canAdd && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => addRange(weekday)}
                      className="inline-flex min-h-11 items-center rounded-2xl px-2 text-sm font-medium text-accent transition hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span aria-hidden="true">+&nbsp;</span>
                      {day.length === 0 ? 'Ajouter des heures' : 'Ajouter une plage'}
                      <span className="sr-only"> le {WEEKDAY_LABELS[weekday].toLowerCase()}</span>
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !dirty} className={primaryButtonClass}>
          {saving ? 'Enregistrement…' : 'Enregistrer mes disponibilités'}
        </button>
        {ranges.length === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => update(OFFICE_HOURS)}
            className={ghostButtonClass}
          >
            Préremplir : lundi au vendredi, 9 h à 17 h
          </button>
        )}
        {dirty && !busy && (
          <span className="text-xs text-text-muted">Modifications non enregistrées.</span>
        )}
      </div>

      {/* Present even when empty: a live region inserted together with its
          content is often not announced. */}
      <p aria-live="polite" className="min-h-5 text-sm text-emerald-800">
        {announcement}
      </p>
    </form>
  );
}
