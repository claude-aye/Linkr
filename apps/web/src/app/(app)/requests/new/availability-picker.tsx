'use client';

import { useId, useState } from 'react';

/**
 * The provider's published availability, offered as start times to pick.
 *
 * ⚠️ IT NEVER BLOCKS, AND NEVER REPLACES THE TWO DATE FIELDS. Availability is
 * indicative (the provider confirms every request by accepting it), and this
 * form's rule is to never stand in the client's way (§13.1 nº 4): picking a
 * time only FILLS the two fields below, which stay editable. A client may still
 * ask for a moment outside these hours.
 *
 * Every label arrives formatted from the server, in the PROVIDER'S time zone.
 * What is handed back on a pick is a pair of INSTANTS (ISO strings), so the
 * chosen moment is right whatever zone the browser is in — which typing into a
 * `datetime-local` field does not guarantee (D0b debt, §13.1 nº 17e).
 */

export interface AvailabilityTime {
  startIso: string;
  endIso: string;
  /** « 9 h 00 ». */
  label: string;
}

export interface AvailabilityDayOption {
  date: string;
  /** « mar. 17 nov. ». */
  label: string;
  /** « mardi 17 novembre ». */
  longLabel: string;
  times: AvailabilityTime[];
}

export interface AvailabilityPickerProps {
  providerName: string;
  /** Days in order, days without any time included (shown disabled). */
  days: AvailabilityDayOption[];
  /** « heure de l’Est ». */
  zoneLabel: string;
  /** The start currently in the form, to mark the matching time as chosen. */
  selectedStartMs: number | null;
  onPick: (startIso: string, endIso: string) => void;
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function AvailabilityPicker({
  providerName,
  days,
  zoneLabel,
  selectedStartMs,
  onPick,
}: AvailabilityPickerProps) {
  const firstOpen = days.find((day) => day.times.length > 0)?.date ?? null;
  const [openDate, setOpenDate] = useState<string | null>(firstOpen);
  const titleId = useId();
  const timesId = useId();

  const openDay = days.find((day) => day.date === openDate) ?? null;

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-3 rounded-2xl border border-edge bg-surface p-4"
    >
      <div>
        <h2 id={titleId} className="text-sm font-semibold text-text">
          Disponibilités de {providerName}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Choisissez un moment pour remplir les champs ci-dessous, ou saisissez-les vous-même.
          Disponibilités indicatives ({zoneLabel}) : le prestataire confirme en acceptant votre
          demande.
        </p>
      </div>

      {firstOpen === null ? (
        <p className="text-sm text-text-muted">
          Aucun créneau libre dans les prochains jours. Vous pouvez tout de même proposer un moment
          ci-dessous.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Jours">
            {days.map((day) => {
              const empty = day.times.length === 0;
              const isOpen = day.date === openDate;
              return (
                <li key={day.date}>
                  <button
                    type="button"
                    disabled={empty}
                    aria-pressed={isOpen}
                    aria-controls={timesId}
                    onClick={() => setOpenDate(day.date)}
                    className={`min-h-11 rounded-2xl border px-3 text-sm font-medium transition motion-reduce:transition-none first-letter:uppercase disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50 ${
                      isOpen
                        ? 'border-accent bg-accent text-on-accent'
                        : 'border-edge text-text-muted hover:bg-text/5 hover:text-text'
                    } ${focusRing}`}
                  >
                    {day.label}
                    {empty && <span className="sr-only"> (aucun créneau)</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div id={timesId}>
            {openDay && (
              <ul
                className="flex flex-wrap gap-2"
                aria-label={`Heures de début, ${openDay.longLabel}`}
              >
                {openDay.times.map((time) => {
                  const chosen = selectedStartMs === Date.parse(time.startIso);
                  return (
                    <li key={time.startIso}>
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => onPick(time.startIso, time.endIso)}
                        className={`min-h-11 min-w-20 rounded-2xl border px-3 text-sm font-medium transition motion-reduce:transition-none ${
                          chosen
                            ? 'border-accent bg-accent text-on-accent'
                            : 'border-accent/40 text-accent hover:bg-accent/10'
                        } ${focusRing}`}
                      >
                        {time.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
