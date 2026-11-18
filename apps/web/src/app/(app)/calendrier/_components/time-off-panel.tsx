'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useRef, useState, useTransition } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  MINUTES_PER_DAY,
  TIME_OFF_LABEL_MAX,
  TIME_OFF_MAX_UPCOMING,
  type TimeOffField,
  assembleTimeOff,
  isDateKey,
  minutesLabel,
  timeOffCreateErrorMessage,
  timeOffDeleteErrorMessage,
  timeOptions,
  zonedTimeToUtcMs,
} from '@/lib/calendar/calendar-rules';
import { EMAIL_NOT_VERIFIED_MESSAGE, isEmailNotVerified } from '@/lib/email-verification/states';

import {
  dangerButtonClass,
  errorClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  selectClass,
} from './styles';

/**
 * Blocked periods: add one, list the upcoming ones, remove one.
 *
 * ⚠️ A DATE AND A TIME `<select>`, NEVER `datetime-local`. A `datetime-local`
 * value is wall time in the BROWSER'S zone (the D0b debt of the booking form,
 * §13.1 nº 17e). Here the two parts are turned into an instant in the
 * CALENDAR'S zone (`zonedTimeToUtcMs`), so « le 24 décembre, toute la journée »
 * blocks the provider's 24 December wherever the browser happens to be.
 *
 * Every label of the list arrives formatted from the server; `today` too (it
 * is the calendar's today, not the browser's).
 */

export interface TimeOffView {
  id: string;
  /** « du 24 déc. 2026 au 2 janv. 2027 », « 18 nov. 2026, 13 h 00 – 15 h 00 ». */
  whenLabel: string;
  label: string | null;
  /** True while the period is under way. */
  ongoing: boolean;
}

const TIME_OPTIONS = timeOptions(true);

export function TimeOffPanel({
  items,
  timeZone,
  today,
}: {
  items: TimeOffView[];
  timeZone: string;
  today: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startMinute, setStartMinute] = useState(9 * 60);
  const [endMinute, setEndMinute] = useState(17 * 60);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<TimeOffField | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const [pendingDelete, setPendingDelete] = useState<TimeOffView | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const ids = {
    start: `${baseId}-start`,
    end: `${baseId}-end`,
    allDay: `${baseId}-all-day`,
    startTime: `${baseId}-start-time`,
    endTime: `${baseId}-end-time`,
    label: `${baseId}-label`,
    error: `${baseId}-error`,
  };

  const busy = saving || refreshing;
  const full = items.length >= TIME_OFF_MAX_UPCOMING;

  function reject(field: TimeOffField, message: string) {
    setError(message);
    setErrorField(field);
    (field === 'start' ? startRef : field === 'end' ? endRef : labelRef).current?.focus();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || full) return;
    setAnnouncement('');

    // An empty end date means « the same day »: the common one-day case needs
    // only one field.
    const lastDate = endDate || startDate;
    const startMs = isDateKey(startDate)
      ? zonedTimeToUtcMs(startDate, allDay ? 0 : startMinute, timeZone)
      : null;
    const endMs = isDateKey(lastDate)
      ? zonedTimeToUtcMs(lastDate, allDay ? MINUTES_PER_DAY : endMinute, timeZone)
      : null;

    const assembled = assembleTimeOff({ startMs, endMs, label }, Date.now());
    if (!assembled.ok) {
      reject(assembled.field, assembled.message);
      return;
    }

    setSaving(true);
    setError(null);
    setErrorField(null);

    let response: Response;
    try {
      response = await fetch('/api/service-providers/me/calendar/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assembled.body),
      });
    } catch {
      setSaving(false);
      setError(timeOffCreateErrorMessage(0));
      return;
    }

    if (!response.ok) {
      const notVerified = await isEmailNotVerified(response);
      setSaving(false);
      setError(notVerified ? EMAIL_NOT_VERIFIED_MESSAGE : timeOffCreateErrorMessage(response.status));
      return;
    }

    startRefresh(() => {
      router.refresh();
      setSaving(false);
      setStartDate('');
      setEndDate('');
      setLabel('');
      setAnnouncement('Indisponibilité ajoutée.');
    });
  }

  async function remove(item: TimeOffView) {
    setListError(null);
    let response: Response;
    try {
      response = await fetch(`/api/service-providers/me/calendar/time-off/${item.id}`, {
        method: 'DELETE',
      });
    } catch {
      throw new Error(timeOffDeleteErrorMessage(0));
    }
    if (response.status === 404) {
      // Already gone (another tab): the list is stale, read it again.
      setListError(timeOffDeleteErrorMessage(404));
      startRefresh(() => router.refresh());
      return;
    }
    if (!response.ok) throw new Error(timeOffDeleteErrorMessage(response.status));
    startRefresh(() => {
      router.refresh();
      setAnnouncement('Indisponibilité supprimée.');
    });
  }

  const invalid = (field: TimeOffField) => (errorField === field ? true : undefined);
  const describedBy = (field: TimeOffField) => (errorField === field ? ids.error : undefined);

  return (
    <div className="space-y-5">
      <p className={hintClass}>
        Vacances, congé, rendez-vous personnel : pendant une indisponibilité, aucun créneau n’est
        proposé aux clients. Votre note reste privée : elle n’apparaît ni aux clients ni dans les calendriers synchronisés.
      </p>

      <form method="post" onSubmit={add} noValidate className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.start} className={labelClass}>
              Du
            </label>
            <input
              id={ids.start}
              ref={startRef}
              type="date"
              min={today}
              value={startDate}
              disabled={busy || full}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (errorField === 'start') setErrorField(null);
              }}
              aria-invalid={invalid('start')}
              aria-describedby={describedBy('start')}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor={ids.end} className={labelClass}>
              Au <span className="font-normal">(facultatif : même jour)</span>
            </label>
            <input
              id={ids.end}
              ref={endRef}
              type="date"
              min={startDate || today}
              value={endDate}
              disabled={busy || full}
              onChange={(event) => {
                setEndDate(event.target.value);
                if (errorField === 'end') setErrorField(null);
              }}
              aria-invalid={invalid('end')}
              aria-describedby={describedBy('end')}
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>

        <label htmlFor={ids.allDay} className="flex min-h-11 items-center gap-3 text-sm text-text">
          <input
            id={ids.allDay}
            type="checkbox"
            checked={allDay}
            disabled={busy || full}
            onChange={(event) => setAllDay(event.target.checked)}
            className="size-5 accent-accent"
          />
          Journées entières
        </label>

        {!allDay && (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 sm:flex-none">
              <label htmlFor={ids.startTime} className={labelClass}>
                De
              </label>
              <select
                id={ids.startTime}
                value={startMinute}
                disabled={busy || full}
                onChange={(event) => setStartMinute(Number(event.target.value))}
                className={`mt-1 w-full ${selectClass}`}
              >
                {TIME_OPTIONS.slice(0, -1).map((minute) => (
                  <option key={minute} value={minute}>
                    {minutesLabel(minute)}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <label htmlFor={ids.endTime} className={labelClass}>
                À
              </label>
              <select
                id={ids.endTime}
                value={endMinute}
                disabled={busy || full}
                onChange={(event) => setEndMinute(Number(event.target.value))}
                className={`mt-1 w-full ${selectClass}`}
              >
                {TIME_OPTIONS.slice(1).map((minute) => (
                  <option key={minute} value={minute}>
                    {minutesLabel(minute)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor={ids.label} className={labelClass}>
            Note privée <span className="font-normal">(facultative)</span>
          </label>
          <input
            id={ids.label}
            ref={labelRef}
            type="text"
            value={label}
            maxLength={TIME_OFF_LABEL_MAX}
            disabled={busy || full}
            onChange={(event) => {
              setLabel(event.target.value);
              if (errorField === 'label') setErrorField(null);
            }}
            placeholder="Vacances, formation…"
            aria-invalid={invalid('label')}
            aria-describedby={describedBy('label')}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        {error && (
          <p id={ids.error} role="alert" className={errorClass}>
            {error}
          </p>
        )}
        {full && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Vous avez atteint {TIME_OFF_MAX_UPCOMING} périodes à venir. Supprimez-en une pour en
            ajouter une autre.
          </p>
        )}

        <button type="submit" disabled={busy || full} className={primaryButtonClass}>
          {saving ? 'Ajout…' : 'Bloquer cette période'}
        </button>
      </form>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {listError && (
        <p role="alert" className={errorClass}>
          {listError}
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge p-4 text-center text-sm text-text-muted">
          Aucune indisponibilité à venir.
        </p>
      ) : (
        <ul className="divide-y divide-edge rounded-2xl border border-edge bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text first-letter:uppercase">
                  {item.whenLabel}
                </p>
                <p className="break-words text-xs text-text-muted">
                  {item.ongoing ? 'En cours' : 'À venir'}
                  {item.label ? ` · ${item.label}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(item)}
                className={`${dangerButtonClass} shrink-0`}
              >
                Supprimer<span className="sr-only"> : {item.whenLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Supprimer cette indisponibilité ?"
        confirmLabel="Supprimer"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
        }}
      >
        <p className="text-sm text-text-muted">
          <span className="first-letter:uppercase">{pendingDelete?.whenLabel}</span>. Les créneaux de
          cette période redeviendront disponibles pour les clients.
        </p>
      </ConfirmDialog>
    </div>
  );
}
