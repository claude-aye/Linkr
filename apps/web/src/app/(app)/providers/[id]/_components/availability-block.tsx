import type { components } from '@linkr/api-client';

import {
  dayMediumLabel,
  isoWeekday,
  rangesOfWeekday,
  slotLabels,
  weeklyHoursSummary,
  zoneGenericLabel,
} from '@/lib/calendar/calendar-rules';

/**
 * « Disponibilités » on a provider's profile — a Server Component, no
 * `'use client'`: it shows, it does not book (the « Demander » buttons of the
 * services above do, and the booking form offers these same times to pick).
 *
 * The data is consumed NATIVELY from the generated schema (no mirror, no
 * cast): every property of `ProviderAvailabilityDto` is annotated with a
 * concrete type.
 *
 * ⚠️ FREE TIME ONLY. The API serves the published hours and what is left of
 * them — never why an hour is taken. This block adds nothing to that: a day
 * with opening hours and no slot left reads « Complet », a day without opening
 * hours « Fermé », and that is all there is to say.
 *
 * ⚠️ INDICATIVE, AND SAID SO. A slot shown here is not a reservation: the
 * provider confirms every request by accepting it. The note under the list
 * states it rather than letting the list promise more than the product does.
 */

type Availability = components['schemas']['ProviderAvailabilityDto'];

/** Days listed under « Prochains créneaux ». */
const DAYS_SHOWN = 7;

function currentTimeMs(): number {
  return Date.now();
}

export function AvailabilityBlock({ availability }: { availability: Availability }) {
  const { timeZone, weeklyHours } = availability;
  const days = availability.days.slice(0, DAYS_SHOWN);
  const zone = zoneGenericLabel(timeZone, currentTimeMs());

  return (
    <section aria-labelledby="availability-title" className="mt-10">
      <h2 id="availability-title" className="mb-3 text-lg font-semibold text-text">
        Disponibilités
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-edge bg-surface p-5">
          <h3 className="text-sm font-semibold text-text">Heures habituelles</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            {weeklyHoursSummary(weeklyHours).map((row) => (
              <div key={row.weekday} className="flex justify-between gap-4">
                <dt className="text-text-muted">{row.label}</dt>
                <dd className={row.hours ? 'text-right text-text' : 'text-text-muted'}>
                  {row.hours ?? 'Fermé'}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-2xl border border-edge bg-surface p-5">
          <h3 className="text-sm font-semibold text-text">Prochains créneaux libres</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {days.map((day) => {
              const labels = slotLabels(day, timeZone);
              const opens = rangesOfWeekday(weeklyHours, isoWeekday(day.date)).length > 0;
              return (
                <li key={day.date} className="flex gap-3">
                  <span className="w-24 shrink-0 text-text-muted first-letter:uppercase">
                    {dayMediumLabel(day.date)}
                  </span>
                  {labels.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {labels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-accent/40 px-2 py-0.5 text-xs font-medium text-accent"
                        >
                          {label}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-text-muted">{opens ? 'Complet' : 'Fermé'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Disponibilités indicatives ({zone}) : le prestataire confirme chaque demande en
        l’acceptant. Choisissez un service ci-dessus pour proposer un moment.
      </p>
    </section>
  );
}
