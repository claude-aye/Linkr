'use client';

import { type FormEvent, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  UNAVAILABLE_MESSAGE,
  parseDuration,
  parsePrice,
  serviceMessageForStatus,
} from '@/lib/provider-services/service-rules';

/**
 * « Ajouter un service » — the web door to
 * `POST /service-providers/{providerId}/categories/{pscId}/services`, one form
 * per eligible trade, folded by default.
 *
 * Posts to the BFF relay, NOT a Server Action — consistent with every other
 * mutation. Same classes and same `aria-live` motif as `add-category-form.tsx`.
 *
 * Catalogue only: the provider picks an APPROVED item of THIS trade (the page
 * passes only the ones not yet offered — disabled services included, since the
 * API's `existsActive` counts them). No free text, no suggestion: the optional
 * description is where details go. Fixed price only, in CAD, at least 5 $; no
 * model or currency field exists on screen. Every parse and every message lives
 * in `lib/provider-services/service-rules.ts`, tested under `node --test`.
 */

export interface ServiceItemOption {
  id: string;
  /** Already resolved server-side via `pickTranslation`. */
  label: string;
}

export interface AddServiceFormProps {
  providerId: string;
  /** The trade CLAIM (junction row) id, i.e. the `{pscId}` of the route. */
  pscId: string;
  /** Trade name, for the button's accessible name when several are on screen. */
  tradeLabel: string;
  /** Approved catalogue items of this trade NOT yet offered, ordered. */
  options: ServiceItemOption[];
}

type Field = 'item' | 'price' | 'duration';
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY_DRAFT = { itemId: '', price: '', hours: '', minutes: '', description: '' };

const inputClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 aria-[invalid=true]:border-red-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800 dark:aria-[invalid=true]:border-red-700';
/** Same classes as `add-category-form.tsx`; the margin is split off so the
 *  two side-by-side duration inputs can drop it. */
const fieldClass = `mt-1 ${inputClass}`;
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';
const fieldErrorClass = 'mt-1 text-xs font-medium text-red-700 dark:text-red-400';
const secondaryButtonClass =
  'min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
const primaryButtonClass =
  'min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60';

export function AddServiceForm({ providerId, pscId, tradeLabel, options }: AddServiceFormProps) {
  const router = useRouter();
  const idBase = useId();
  const formId = `${idBase}-form`;
  const fieldId = (field: Field) => `${idBase}-${field}`;
  const errorId = (field: Field) => `${idBase}-${field}-error`;

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The catalogue item just added. The confirmation is DERIVED from it rather
  // than held as a flag: it shows only while that item is absent from the menu,
  // i.e. still offered. Delete the service and the item returns to the menu —
  // the confirmation then disappears instead of sitting above an empty list.
  const [addedItemId, setAddedItemId] = useState<string | null>(null);
  const succeeded =
    addedItemId !== null && !options.some((option) => option.id === addedItemId);
  // The refresh lands a beat after the POST: run the fold in a transition so
  // the form stays busy until the new row and the shrunken menu are there.
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;

  function update(key: keyof typeof EMPTY_DRAFT, field: Field | null, value: string) {
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

  function toggle() {
    setExpanded((v) => !v);
    setError(null);
    setAddedItemId(null);
  }

  function describedBy(field: Field, hint?: string): string | undefined {
    const ids = [hint, errors[field] ? errorId(field) : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setAddedItemId(null);

    const nextErrors: FieldErrors = {};
    if (!draft.itemId) nextErrors.item = 'Veuillez choisir un service.';
    const price = parsePrice(draft.price);
    if (price.kind === 'invalid') nextErrors.price = price.message;
    const duration = parseDuration(draft.hours, draft.minutes);
    if (duration.kind === 'invalid') nextErrors.duration = duration.message;

    if (Object.keys(nextErrors).length > 0 || price.kind !== 'ok') {
      setErrors(nextErrors);
      setError('Veuillez corriger les champs signalés.');
      const first = (['item', 'price', 'duration'] as const).find((f) => nextErrors[f]);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }

    setErrors({});
    setPending(true);

    // Duration and description are OMITTED when empty — never sent as 0 or ''.
    const body: Record<string, unknown> = {
      serviceItemId: draft.itemId,
      priceAmount: price.amount,
    };
    if (duration.kind === 'ok') body.estimatedDurationMinutes = duration.minutes;
    if (draft.description.trim() !== '') body.descriptionOverride = draft.description.trim();

    let response: Response;
    try {
      response = await fetch(
        `/api/service-providers/${providerId}/categories/${pscId}/services`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch {
      setError(UNAVAILABLE_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(serviceMessageForStatus(response.status));
      setPending(false);
      return;
    }

    // Created (201). The Server Component is the source of truth: re-read so
    // the new row (and the shrunken menu) come from the database. This island
    // survives the refresh — same trade, same position — so reset it here.
    setPending(false);
    startRefresh(() => {
      setDraft(EMPTY_DRAFT);
      setExpanded(false);
      setAddedItemId(draft.itemId);
      router.refresh();
    });
  }

  return (
    <div className="mt-3">
      {/* Live region present in the DOM even when empty — one inserted at the
          same time as its content is very often not announced at all. It sits
          OUTSIDE the folded form so the confirmation survives the fold. */}
      <div aria-live="polite">
        {succeeded && (
          <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Service ajouté. Il apparaît sur votre profil public avec le bouton
            « Demander ».
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={formId}
        aria-label={expanded ? undefined : `Ajouter un service en ${tradeLabel}`}
        className={expanded ? secondaryButtonClass : primaryButtonClass}
      >
        {expanded ? 'Fermer le formulaire' : 'Ajouter un service'}
      </button>

      {expanded && (
        <form
          id={formId}
          method="post"
          onSubmit={handleSubmit}
          noValidate
          className="mt-3 space-y-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-950"
        >
          <div>
            <label htmlFor={fieldId('item')} className={labelClass}>
              Service
            </label>
            <select
              id={fieldId('item')}
              value={draft.itemId}
              onChange={(event) => update('itemId', 'item', event.target.value)}
              disabled={busy}
              className={fieldClass}
              aria-invalid={errors.item ? true : undefined}
              aria-describedby={describedBy('item', `${idBase}-item-hint`)}
            >
              <option value="">Choisir un service</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p id={`${idBase}-item-hint`} className={hintClass}>
              Les services proposés viennent du catalogue de Linkr. Précisez les
              détails dans la description.
            </p>
            {errors.item && (
              <p id={errorId('item')} className={fieldErrorClass}>
                {errors.item}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('price')} className={labelClass}>
              Prix
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
              Prix fixe en dollars canadiens, d’au moins 5 $. Par exemple 40 ou 40,50.
            </p>
            {errors.price && (
              <p id={errorId('price')} className={fieldErrorClass}>
                {errors.price}
              </p>
            )}
          </div>

          <fieldset aria-describedby={describedBy('duration', `${idBase}-duration-hint`)}>
            <legend className={labelClass}>Durée estimée</legend>
            <div className="mt-1 flex gap-3">
              <div className="flex-1">
                <label htmlFor={fieldId('duration')} className="sr-only">
                  Heures
                </label>
                <div className="relative">
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
              </div>
              <div className="flex-1">
                <label htmlFor={`${idBase}-minutes`} className="sr-only">
                  Minutes
                </label>
                <div className="relative">
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
            </div>
            <p id={`${idBase}-duration-hint`} className={hintClass}>
              Facultatif. Laissez les deux champs vides pour ne pas l’indiquer.
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
              Facultatif. Ce que comprend votre prix, vos conditions.
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

          <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
            {busy ? 'Ajout…' : 'Ajouter ce service'}
          </button>
        </form>
      )}
    </div>
  );
}
