'use client';

import { type FormEvent, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  UNAVAILABLE_MESSAGE,
  durationToFields,
  formatDuration,
  formatServicePrice,
  normalizeDescription,
  parseDuration,
  parsePrice,
  serviceMessageForStatus,
} from '@/lib/provider-services/service-rules';
import type { ProviderService } from '@/lib/providers/types';

/**
 * One service the provider offers, under its trade in « Mes métiers »: what it
 * shows, plus three actions —
 *   - « Modifier » unfolds an inline form: price, duration, description. The
 *     trade and the catalogue item are NOT editable (locked: delete and re-add
 *     instead). The 5 $ floor applies to the edited price as on creation;
 *   - « Désactiver » / « Réactiver » — one direct click, no dialog: the toggle
 *     is reversible and touches no money (same friction rule as « Démarrer »);
 *   - « Supprimer » — confirmed through `ConfirmDialog` (soft delete server-side).
 *
 * Non-FLAT services can exist (seed, direct API calls). They are shown as they
 * are and never converted: the model is not editable here, and on a QUOTE_ONLY
 * service the price field is absent — the API would 400 a price on it.
 *
 * Every parse and message lives in `lib/provider-services/service-rules.ts`.
 * Mapping by HTTP status ALONE (lock 3.12b). `router.refresh()` after each
 * success: the Server Component is the source of truth.
 */

export interface ServiceRowProps {
  providerId: string;
  service: Pick<
    ProviderService,
    | 'id'
    | 'serviceItemId'
    | 'pricingModel'
    | 'priceAmount'
    | 'priceCurrency'
    | 'estimatedDurationMinutes'
    | 'descriptionOverride'
    | 'isActive'
  >;
  /** Catalogue item name, resolved server-side — « — » when it cannot be joined. */
  label: string;
}

type Field = 'price' | 'duration';
type FieldErrors = Partial<Record<Field, string>>;

const inputClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 aria-[invalid=true]:border-red-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800 dark:aria-[invalid=true]:border-red-700';
const fieldClass = `mt-1 ${inputClass}`;
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';
const fieldErrorClass = 'mt-1 text-xs font-medium text-red-700 dark:text-red-400';
const secondaryButtonClass =
  'min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const dangerButtonClass =
  'min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950';
const primaryButtonClass =
  'min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60';

/** Price as a field value: 40 → « 40 », 40.5 → « 40,50 » (Québec comma). */
function priceToField(amount: number | null): string {
  if (amount === null) return '';
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace('.', ',');
}

export function ServiceRow({ providerId, service, label }: ServiceRowProps) {
  const router = useRouter();
  const idBase = useId();
  const fieldId = (field: Field) => `${idBase}-${field}`;
  const errorId = (field: Field) => `${idBase}-${field}-error`;

  const hasPrice = service.pricingModel !== 'QUOTE_ONLY';
  const duration = formatDuration(service.estimatedDurationMinutes);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ price: '', hours: '', minutes: '', description: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The refresh lands a beat after the PATCH. Running it in a transition keeps
  // the OLD screen (form open, button busy) until the NEW data is there —
  // otherwise « Service modifié » would sit above the stale values for a moment.
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;

  const url = `/api/service-providers/${providerId}/services/${service.id}`;

  function startEditing() {
    const fields = durationToFields(service.estimatedDurationMinutes);
    setDraft({
      price: priceToField(service.priceAmount),
      hours: fields.hours,
      minutes: fields.minutes,
      description: service.descriptionOverride ?? '',
    });
    setErrors({});
    setError(null);
    setEditing(true);
  }

  function update(key: keyof typeof draft, field: Field | null, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (field) {
      setErrors((e) => {
        if (!e[field]) return e;
        const next = { ...e };
        delete next[field];
        return next;
      });
    }
  }

  function describedBy(field: Field, hint?: string): string | undefined {
    const ids = [hint, errors[field] ? errorId(field) : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      setError(UNAVAILABLE_MESSAGE);
      return false;
    }
    if (!response.ok) {
      setError(serviceMessageForStatus(response.status));
      return false;
    }
    return true;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const nextErrors: FieldErrors = {};
    const price = hasPrice ? parsePrice(draft.price) : null;
    if (price && price.kind === 'invalid') nextErrors.price = price.message;
    const parsedDuration = parseDuration(draft.hours, draft.minutes);
    if (parsedDuration.kind === 'invalid') nextErrors.duration = parsedDuration.message;

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setError('Veuillez corriger les champs signalés.');
      const first = (['price', 'duration'] as const).find((f) => nextErrors[f]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }

    // Empty duration / description CLEAR the column: sent as `null`, never
    // omitted (that would keep the old value) and never as 0 or ''.
    const body: Record<string, unknown> = {
      estimatedDurationMinutes: parsedDuration.kind === 'ok' ? parsedDuration.minutes : null,
      descriptionOverride: normalizeDescription(draft.description),
    };
    if (price && price.kind === 'ok') body.priceAmount = price.amount;

    setErrors({});
    setPending(true);
    const ok = await patch(body);
    setPending(false);
    if (!ok) return;

    startRefresh(() => {
      setEditing(false);
      setAnnouncement('Service modifié.');
      router.refresh();
    });
  }

  async function toggleActive() {
    if (busy) return;
    setError(null);
    setPending(true);
    const ok = await patch({ isActive: !service.isActive });
    setPending(false);
    if (!ok) return;
    startRefresh(() => {
      setAnnouncement(
        service.isActive
          ? 'Service désactivé. Il n’apparaît plus sur votre profil public.'
          : 'Service réactivé. Il apparaît de nouveau sur votre profil public.',
      );
      router.refresh();
    });
  }

  async function confirmDelete(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, { method: 'DELETE' });
    } catch {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    if (!response.ok) throw new Error(serviceMessageForStatus(response.status));
    router.refresh();
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Catalogue UUID on hover, same affordance as the trade rows. */}
          <p className="font-medium text-zinc-900 dark:text-zinc-50" title={service.serviceItemId}>
            {label}
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {formatServicePrice(service.priceAmount, service.priceCurrency, service.pricingModel)}
            {duration && <span className="text-zinc-500 dark:text-zinc-400"> · {duration}</span>}
          </p>
          {service.descriptionOverride && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {service.descriptionOverride}
            </p>
          )}
        </div>
        {!service.isActive && (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Désactivé
          </span>
        )}
      </div>
      {!service.isActive && (
        <p className={hintClass}>Ce service n’apparaît pas sur votre profil public.</p>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startEditing}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Modifier
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={busy}
            className={secondaryButtonClass}
          >
            {busy ? 'Enregistrement…' : service.isActive ? 'Désactiver' : 'Réactiver'}
          </button>
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
            className={dangerButtonClass}
          >
            Supprimer
          </button>
        </div>
      )}

      {editing && (
        <form
          method="post"
          onSubmit={save}
          noValidate
          className="mt-3 space-y-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950"
        >
          {hasPrice ? (
            <div>
              <label htmlFor={fieldId('price')} className={labelClass}>
                {service.pricingModel === 'HOURLY' ? 'Tarif horaire' : 'Prix'}
              </label>
              <div className="relative">
                <input
                  id={fieldId('price')}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.price}
                  onChange={(event) => update('price', 'price', event.target.value)}
                  disabled={busy}
                  className={`${fieldClass} pr-14`}
                  aria-invalid={errors.price ? true : undefined}
                  aria-describedby={describedBy('price', `${idBase}-price-hint`)}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-3 mt-1 flex items-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  $ CA
                </span>
              </div>
              <p id={`${idBase}-price-hint`} className={hintClass}>
                En dollars canadiens, d’au moins 5 $.
              </p>
              {errors.price && (
                <p id={errorId('price')} className={fieldErrorClass}>
                  {errors.price}
                </p>
              )}
            </div>
          ) : (
            <p className={hintClass}>Ce service est proposé sur devis : il n’a pas de prix.</p>
          )}

          <fieldset aria-describedby={describedBy('duration', `${idBase}-duration-hint`)}>
            <legend className={labelClass}>Durée estimée</legend>
            <div className="mt-1 flex gap-3">
              <div className="relative flex-1">
                <label htmlFor={fieldId('duration')} className="sr-only">
                  Heures
                </label>
                <input
                  id={fieldId('duration')}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.hours}
                  onChange={(event) => update('hours', 'duration', event.target.value)}
                  disabled={busy}
                  className={`${inputClass} pr-8`}
                  aria-invalid={errors.duration ? true : undefined}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  h
                </span>
              </div>
              <div className="relative flex-1">
                <label htmlFor={`${idBase}-minutes`} className="sr-only">
                  Minutes
                </label>
                <input
                  id={`${idBase}-minutes`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.minutes}
                  onChange={(event) => update('minutes', 'duration', event.target.value)}
                  disabled={busy}
                  className={`${inputClass} pr-12`}
                  aria-invalid={errors.duration ? true : undefined}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  min
                </span>
              </div>
            </div>
            <p id={`${idBase}-duration-hint`} className={hintClass}>
              Facultatif. Videz les deux champs pour retirer la durée.
            </p>
            {errors.duration && (
              <p id={errorId('duration')} className={fieldErrorClass}>
                {errors.duration}
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor={`${idBase}-description`} className={labelClass}>
              Description
            </label>
            <textarea
              id={`${idBase}-description`}
              rows={3}
              value={draft.description}
              onChange={(event) => update('description', null, event.target.value)}
              disabled={busy}
              className={fieldClass}
              aria-describedby={`${idBase}-description-hint`}
            />
            <p id={`${idBase}-description-hint`} className={hintClass}>
              Facultatif. Videz le champ pour retirer la description.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* Toggle errors surface here (the edit form shows its own above). */}
      {!editing && error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Supprimer ce service ?"
        confirmLabel="Supprimer le service"
        onConfirm={confirmDelete}
      >
        <p>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{label}</span> ne sera
          plus proposé sur votre profil public.
        </p>
        <p className="mt-2">
          Les demandes déjà reçues pour ce service ne sont pas touchées. Pour le proposer de
          nouveau, il faudra l’ajouter une seconde fois.
        </p>
      </ConfirmDialog>
    </li>
  );
}
