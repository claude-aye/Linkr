'use client';

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { components } from '@linkr/api-client';

import { formatDateTime } from '@/lib/dates/format';
import { fromLocalInputValue, toLocalInputValue } from '@/lib/dates/local-input';
import {
  type GeocodeCandidate,
  geocodeAddress,
} from '@/lib/geocoding/geocode-address';
import {
  ADDRESS_MAX,
  type DeadlineChoice,
  FIELD_ORDER,
  MAX_QUOTES_DEADLINE_DAYS,
  MIN_QUOTES_DEADLINE_HOURS,
  MIN_WINDOW_START_HOURS,
  QUOTES_DEADLINE_BUFFER_HOURS,
  RELATIVE_DEADLINES,
  type RelativeDeadline,
  TITLE_MAX,
  type TenderErrors,
  type TenderField,
  assembleTender,
  defaultDeadline,
  hasAnyValidDeadline,
  isRelativeDeadlineAvailable,
  relativeDeadlineMs,
  startTooSoonMessage,
} from '@/lib/service-requests/tender-rules';

/**
 * « Publier un appel d'offres » — creation form for a `PROJECT_TENDER` (PR 1b).
 *
 * Posts to the BFF `POST /api/service-requests` (transparent relay), NOT a
 * Server Action — consistent with every other mutation in the app. The API is
 * the only judge (PR 1a); every rule the browser applies here is a MIRROR that
 * lives in `lib/service-requests/tender-rules.ts`, where it is tested. This
 * component only wires state to it.
 *
 * ⚠️ THE ADDRESS BLOCKS — calqué sur `create-provider-form.tsx`, PAS sur le
 * formulaire de réservation. `create-request-form.tsx` degrades (searched area,
 * then the Québec placeholder) because a blocked client is a lost client. A
 * tender has NO escape hatch: its point decides WHICH PROVIDERS receive it
 * (geographic fan-out), so a fallback would broadcast it to the wrong trades
 * people with nothing on screen to reveal it. The typed address must geocode
 * and the client must PICK a candidate — and the body always says `GEOCODED`.
 * No « Envoyer quand même », no `UNKNOWN`, no default point, no URL coords.
 *
 * `create-request-form.tsx` is NOT modified by this form, and neither of its two
 * debts is aggravated: its inline copy of the geocoding transport (this form
 * uses the shared `geocodeAddress`), and its local `toLocalInputValue` (this
 * form uses `lib/dates/local-input.ts`).
 */

type CreateServiceRequestBody = components['schemas']['CreateServiceRequestDto'];

export interface TenderCategoryOption {
  id: string;
  label: string;
}

/** Same union as the provider form — `resolved` is the only state that posts. */
type LocationState =
  | { kind: 'idle' }
  | { kind: 'geocoding' }
  | { kind: 'candidates'; candidates: GeocodeCandidate[] }
  | { kind: 'resolved'; label: string; lat: number; lng: number }
  | { kind: 'unresolved'; reason: 'no-match' | 'unavailable' };

const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';
const INVALID_MESSAGE =
  'Certaines informations saisies sont invalides. Veuillez vérifier votre saisie.';
const FIX_FIELDS_MESSAGE = 'Veuillez corriger les champs signalés.';

/**
 * Maps a relayed status to FROZEN French copy — by HTTP status ALONE, the body
 * is never parsed to pick a message (locked since 3.12b). No 409 branch: a
 * creation cannot conflict, and we never map a code that cannot occur.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      // The browser mirrors R1/R2/R4, so a 400 here is UNEXPECTED — and the
      // server cannot tell us which field, so the copy cannot either.
      return INVALID_MESSAGE;
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

// ---------------------------------------------------------------------------
// The clock — read through `useSyncExternalStore`, never at render.
//
// Which deadlines are offered and what the preview says depend on « now ».
// Reading `Date.now()` during render would make the server HTML and the first
// client render disagree (hydration mismatch — the defect family of §13.1 nº
// 17(d)). The server snapshot is `null`, hydration renders with it, and the
// real clock arrives right after. It also TICKS: a form left open for an hour
// keeps greying out the right options and previewing the right date.
// ---------------------------------------------------------------------------

const NOW_TICK_MS = 30 * 1000;
let nowSnapshot: number | null = null;
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null) {
    nowSnapshot = Date.now();
    nowTimer = setInterval(() => {
      nowSnapshot = Date.now();
      for (const l of nowListeners) l();
    }, NOW_TICK_MS);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer !== null) {
      clearInterval(nowTimer);
      nowTimer = null;
      // A stale value must not greet the next mount.
      nowSnapshot = null;
    }
  };
}

const getNowSnapshot = (): number | null => nowSnapshot;
const getServerNowSnapshot = (): number | null => null;

function useNow(): number | null {
  return useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
}

const MS_PER_HOUR = 60 * 60 * 1000;

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 aria-[invalid=true]:border-red-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800 dark:aria-[invalid=true]:border-red-700';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';
const fieldErrorClass = 'mt-1 text-xs font-medium text-red-700 dark:text-red-400';
const radioRowClass =
  'flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 dark:border-zinc-800 dark:text-zinc-100 dark:has-[:checked]:border-blue-700 dark:has-[:checked]:bg-blue-950';

/** The inline error of one field — its id is what `aria-describedby` points to. */
function FieldError({ field, errors }: { field: TenderField; errors: TenderErrors }) {
  const message = errors[field];
  if (!message) return null;
  return (
    <p id={`tender-${field}-error`} className={fieldErrorClass}>
      {message}
    </p>
  );
}

/** `aria-describedby` value: the hint always, the error when there is one. */
function describedBy(field: TenderField, errors: TenderErrors, hintId?: string): string | undefined {
  const ids = [hintId, errors[field] ? `tender-${field}-error` : undefined].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function CreateTenderForm({ categories }: { categories: TenderCategoryOption[] }) {
  const router = useRouter();
  const now = useNow();

  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [locationState, setLocationState] = useState<LocationState>({ kind: 'idle' });
  const [hasWindow, setHasWindow] = useState(false);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  // The deadline FOLLOWS its default until the client picks one explicitly.
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice | null>('7d');
  const [customDeadline, setCustomDeadline] = useState('');
  const [budget, setBudget] = useState('');

  const [errors, setErrors] = useState<TenderErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [pending, setPending] = useState(false);

  const addressBlockRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const deadlineFieldsetRef = useRef<HTMLFieldSetElement>(null);

  const geocoding = locationState.kind === 'geocoding';
  const locationKind = locationState.kind;

  /** Same as the provider form: bring the outcome above the mobile keyboard. */
  useEffect(() => {
    if (locationKind !== 'candidates' && locationKind !== 'unresolved') return;
    addressBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [locationKind]);

  // --- Derived deadline state (never an effect: derived at render) ----------

  const windowStartMs = hasWindow ? fromLocalInputValue(windowStart) : null;
  const fallback = now === null ? null : defaultDeadline(now, windowStartMs);

  // Before the clock arrives (server render, hydration) the default is 7 days —
  // exactly what an empty, flexible form defaults to once it has.
  const effectiveChoice: DeadlineChoice | null = deadlineTouched
    ? deadlineChoice
    : fallback === null
      ? '7d'
      : fallback.choice;
  const effectiveCustom =
    !deadlineTouched && fallback?.choice === 'custom'
      ? toLocalInputValue(new Date(fallback.deadlineMs))
      : customDeadline;

  const anyValidDeadline = now === null || hasAnyValidDeadline(now, windowStartMs);

  let previewMs: number | null = null;
  if (now !== null && effectiveChoice !== null) {
    previewMs =
      effectiveChoice === 'custom'
        ? fromLocalInputValue(effectiveCustom)
        : relativeDeadlineMs(effectiveChoice, now);
  }

  function isOptionDisabled(value: RelativeDeadline): boolean {
    if (now === null) return false;
    return !isRelativeDeadlineAvailable(value, now, windowStartMs);
  }

  // Courtesy bounds for the native pickers — the real checks run at submit.
  const customMin = now === null ? undefined : toLocalInputValue(new Date(now + MIN_QUOTES_DEADLINE_HOURS * MS_PER_HOUR));
  const customMaxMs =
    now === null
      ? null
      : Math.min(
          now + MAX_QUOTES_DEADLINE_DAYS * 24 * MS_PER_HOUR,
          windowStartMs === null ? Infinity : windowStartMs - QUOTES_DEADLINE_BUFFER_HOURS * MS_PER_HOUR,
        );
  const customMax = customMaxMs === null ? undefined : toLocalInputValue(new Date(customMaxMs));
  const windowStartMin =
    now === null ? undefined : toLocalInputValue(new Date(now + MIN_WINDOW_START_HOURS * MS_PER_HOUR));

  // --- Handlers --------------------------------------------------------------

  function clearError(field: TenderField) {
    if (errors[field] === undefined) return;
    setErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function chooseDeadline(value: DeadlineChoice) {
    clearError('deadline');
    if (value === 'custom' && !effectiveCustom && previewMs !== null) {
      // Opening the custom field pre-fills it with the date the client was
      // looking at, instead of an empty picker.
      setCustomDeadline(toLocalInputValue(new Date(previewMs)));
    } else if (value === 'custom' && !deadlineTouched) {
      setCustomDeadline(effectiveCustom);
    }
    setDeadlineChoice(value);
    setDeadlineTouched(true);
  }

  function handleCustomDeadlineChange(value: string) {
    clearError('deadline');
    setCustomDeadline(value);
    setDeadlineChoice('custom');
    setDeadlineTouched(true);
  }

  /**
   * A new window start can make the option the client picked impossible. Then
   * the deadline goes back to FOLLOWING the default rather than leaving a
   * checked radio greyed out under the cursor.
   */
  function handleWindowStartChange(value: string) {
    clearError('windowStart');
    // The deadline is judged against the start: a verdict on the old start is
    // stale the moment the start moves.
    clearError('deadline');
    setWindowStart(value);
    const startMs = fromLocalInputValue(value);
    if (
      deadlineTouched &&
      deadlineChoice !== null &&
      deadlineChoice !== 'custom' &&
      now !== null &&
      !isRelativeDeadlineAvailable(deadlineChoice, now, startMs)
    ) {
      setDeadlineTouched(false);
    }
  }

  function handleHasWindowChange(next: boolean) {
    setHasWindow(next);
    clearError('windowStart');
    clearError('windowEnd');
    clearError('deadline');
  }

  function handleAddressChange(value: string) {
    clearError('address');
    setAddress(value);
    // Editing the address drops any resolution: no stale coordinate survives.
    if (locationState.kind !== 'idle') setLocationState({ kind: 'idle' });
  }

  async function runGeocode(value: string) {
    setFormError(null);
    setLocationState({ kind: 'geocoding' });
    const outcome = await geocodeAddress(value);
    setLocationState(
      outcome.kind === 'candidates'
        ? { kind: 'candidates', candidates: outcome.candidates }
        : { kind: 'unresolved', reason: outcome.kind },
    );
  }

  function chooseCandidate(candidate: GeocodeCandidate) {
    clearError('address');
    setLocationState({
      kind: 'resolved',
      label: candidate.label,
      lat: candidate.lat,
      lng: candidate.lng,
    });
  }

  function chooseNone() {
    setLocationState({ kind: 'unresolved', reason: 'no-match' });
  }

  function correctAddress() {
    setLocationState({ kind: 'idle' });
    addressInputRef.current?.focus();
  }

  function retryGeocode() {
    if (pending || geocoding) return;
    void runGeocode(address.trim());
  }

  function focusField(field: TenderField) {
    if (field === 'deadline') {
      const target =
        deadlineFieldsetRef.current?.querySelector<HTMLInputElement>('input:checked:not(:disabled)') ??
        deadlineFieldsetRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)');
      target?.focus();
      return;
    }
    document.getElementById(`tender-${field}`)?.focus();
  }

  function rejectWith(nextErrors: TenderErrors) {
    setErrors(nextErrors);
    setFormError(FIX_FIELDS_MESSAGE);
    setErrorNonce((n) => n + 1);
    const first = FIELD_ORDER.find((field) => nextErrors[field] !== undefined);
    if (first) focusField(first);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || geocoding) return;

    // ⚠️ `Date.now()` HERE, at submit — the relative deadlines are computed from
    // the moment the client publishes, never from the moment the page rendered.
    const result = assembleTender(
      {
        categoryId,
        title,
        description,
        address,
        location:
          locationState.kind === 'resolved'
            ? { lat: locationState.lat, lng: locationState.lng }
            : null,
        hasWindow,
        windowStartMs: fromLocalInputValue(windowStart),
        windowEndMs: fromLocalInputValue(windowEnd),
        deadlineChoice: effectiveChoice,
        customDeadlineMs: fromLocalInputValue(effectiveCustom),
        budget,
      },
      Date.now(),
    );

    if (result.kind === 'invalid') {
      rejectWith(result.errors);
      return;
    }

    setErrors({});
    setFormError(null);

    if (result.kind === 'needs-location') {
      // The list is already on screen: re-geocoding would only reset it.
      if (locationState.kind === 'candidates') {
        rejectWith({ address: 'Choisissez l’adresse exacte dans la liste ci-dessous.' });
        return;
      }
      // Intercept THIS submit: geocode, let the client pick. There is no other
      // branch — without a coordinate the client has SEEN and PICKED, nothing
      // is posted.
      await runGeocode(address.trim());
      return;
    }

    const payload: CreateServiceRequestBody = {
      ...result.body,
      // The generated type degrades GeoJSON to `Record<string, never>` (JSONB
      // quirk, CLAUDE.md §6) — cast the real Point through `unknown`.
      serviceLocation:
        result.body.serviceLocation as unknown as CreateServiceRequestBody['serviceLocation'],
    };

    setPending(true);
    let response: Response;
    try {
      response = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setFormError(UNAVAILABLE_MESSAGE);
      setErrorNonce((n) => n + 1);
      setPending(false);
      return;
    }

    if (!response.ok) {
      if (response.status === 400) {
        // Detail for whoever debugs — NEVER used to choose the on-screen copy.
        try {
          console.error('POST /api/service-requests (tender) → 400', await response.json());
        } catch {
          console.error('POST /api/service-requests (tender) → 400 (unreadable body)');
        }
      }
      setFormError(messageForStatus(response.status));
      setErrorNonce((n) => n + 1);
      setPending(false);
      return;
    }

    // 201 — back to the list, which says it worked. `pending` stays true: the
    // navigation is under way, and a second click would publish a duplicate.
    router.push('/requests?publie=appel-offres');
    router.refresh();
  }

  const busy = pending || geocoding;

  return (
    <section className="w-full max-w-xl">
      <header className="mb-6">
        {/* Alone on its line, so the « inline » exception of WCAG 2.5.8 does not
            apply: the target itself must be tall enough. */}
        <Link
          href="/requests"
          className="inline-flex min-h-11 items-center text-sm font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          ← Mes demandes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Publier un appel d’offres
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Décrivez vos travaux : les prestataires qui couvrent votre secteur pourront vous
          envoyer un devis.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        method="post"
        noValidate
        className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* --- Métier ----------------------------------------------------- */}
        <div>
          <label htmlFor="tender-category" className={labelClass}>
            Métier
          </label>
          <select
            id="tender-category"
            value={categoryId}
            onChange={(event) => {
              clearError('category');
              setCategoryId(event.target.value);
            }}
            className={fieldClass}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describedBy('category', errors)}
          >
            <option value="">Choisir un métier</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <FieldError field="category" errors={errors} />
        </div>

        {/* --- Titre, description ----------------------------------------- */}
        <div>
          <label htmlFor="tender-title" className={labelClass}>
            Titre
          </label>
          <input
            id="tender-title"
            type="text"
            maxLength={TITLE_MAX}
            value={title}
            onChange={(event) => {
              clearError('title');
              setTitle(event.target.value);
            }}
            className={fieldClass}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy('title', errors)}
          />
          <FieldError field="title" errors={errors} />
        </div>

        <div>
          <label htmlFor="tender-description" className={labelClass}>
            Description des travaux
          </label>
          <textarea
            id="tender-description"
            rows={5}
            value={description}
            onChange={(event) => {
              clearError('description');
              setDescription(event.target.value);
            }}
            className={fieldClass}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy('description', errors)}
          />
          <FieldError field="description" errors={errors} />
        </div>

        {/* --- Adresse — bloquante --------------------------------------- */}
        <div ref={addressBlockRef} className="scroll-mt-6">
          <label htmlFor="tender-address" className={labelClass}>
            Adresse des travaux
          </label>
          <input
            id="tender-address"
            ref={addressInputRef}
            type="text"
            maxLength={ADDRESS_MAX}
            value={address}
            onChange={(event) => handleAddressChange(event.target.value)}
            className={fieldClass}
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={describedBy('address', errors, 'tender-address-hint')}
          />
          <p id="tender-address-hint" className={hintClass}>
            Nous la localisons pour prévenir les prestataires qui couvrent ce secteur.
          </p>
          <FieldError field="address" errors={errors} />

          {/* ONE live region for every geocoding outcome, present even empty —
              a region inserted together with its content is often not announced. */}
          <div aria-live="polite">
            {locationState.kind === 'candidates' && (
              <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Choisissez l’adresse exacte&nbsp;:
                </p>
                <ul className="mt-3 space-y-2">
                  {locationState.candidates.map((candidate, index) => (
                    <li key={`${candidate.lat},${candidate.lng},${index}`}>
                      <button
                        type="button"
                        onClick={() => chooseCandidate(candidate)}
                        className="block min-h-11 w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {candidate.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={chooseNone}
                  className="mt-3 min-h-11 text-sm font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  Aucune de ces adresses
                </button>
              </div>
            )}

            {/* NO « envoyer quand même », by design: reword or retry. */}
            {locationState.kind === 'unresolved' && (
              <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  {locationState.reason === 'no-match'
                    ? 'Nous n’avons pas pu localiser cette adresse. Reformulez-la avec le numéro et la rue, une intersection, ou un code postal. Un appel d’offres ne peut pas être publié sans adresse localisée.'
                    : 'La localisation d’adresse est momentanément indisponible. Veuillez réessayer dans quelques instants.'}
                </p>
                <div className="mt-3">
                  {locationState.reason === 'no-match' ? (
                    <button
                      type="button"
                      onClick={correctAddress}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
                    >
                      Corriger l’adresse
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryGeocode}
                      disabled={busy}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
                    >
                      Réessayer
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {locationState.kind === 'resolved' && (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              Localisé&nbsp;: {locationState.label}
            </p>
          )}
        </div>

        {/* --- Fenêtre de démarrage (R2) ------------------------------------ */}
        <fieldset>
          <legend className={labelClass}>Quand les travaux doivent-ils commencer&nbsp;?</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className={radioRowClass}>
              <input
                type="radio"
                name="tender-window-mode"
                value="flexible"
                checked={!hasWindow}
                onChange={() => handleHasWindowChange(false)}
              />
              Mes dates sont flexibles
            </label>
            <label className={radioRowClass}>
              <input
                type="radio"
                name="tender-window-mode"
                value="window"
                checked={hasWindow}
                onChange={() => handleHasWindowChange(true)}
              />
              J’ai une fenêtre de démarrage
            </label>
          </div>

          {hasWindow && (
            <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tender-windowStart" className={labelClass}>
                    Début des travaux souhaité entre le
                  </label>
                  <input
                    id="tender-windowStart"
                    type="datetime-local"
                    min={windowStartMin}
                    value={windowStart}
                    onChange={(event) => handleWindowStartChange(event.target.value)}
                    className={fieldClass}
                    aria-invalid={errors.windowStart ? true : undefined}
                    aria-describedby={describedBy('windowStart', errors, 'tender-window-hint')}
                  />
                  <FieldError field="windowStart" errors={errors} />
                </div>
                <div>
                  <label htmlFor="tender-windowEnd" className={labelClass}>
                    et le<span className="sr-only"> (au plus tard)</span>
                  </label>
                  <input
                    id="tender-windowEnd"
                    type="datetime-local"
                    min={windowStart || windowStartMin}
                    value={windowEnd}
                    onChange={(event) => {
                      clearError('windowEnd');
                      setWindowEnd(event.target.value);
                    }}
                    className={fieldClass}
                    aria-invalid={errors.windowEnd ? true : undefined}
                    aria-describedby={describedBy('windowEnd', errors, 'tender-window-hint')}
                  />
                  <FieldError field="windowEnd" errors={errors} />
                </div>
              </div>
              <p id="tender-window-hint" className={hintClass}>
                Au plus tôt dans {MIN_WINDOW_START_HOURS} heures, heure du Québec.
              </p>
            </div>
          )}
        </fieldset>

        {/* --- Date limite des devis (R1) ------------------------------------ */}
        <fieldset ref={deadlineFieldsetRef}>
          <legend className={labelClass}>Date limite des devis</legend>
          <p id="tender-deadline-hint" className={hintClass}>
            Après cette date, vous ne recevrez plus de devis.
          </p>

          {!anyValidDeadline && (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Aucune date limite n’est possible avec ce début de fenêtre. {startTooSoonMessage()}
            </p>
          )}

          <div className="mt-2 space-y-2">
            {RELATIVE_DEADLINES.map((option) => {
              const disabled = !anyValidDeadline || isOptionDisabled(option.value);
              return (
                <label key={option.value} className={radioRowClass}>
                  <input
                    type="radio"
                    name="tender-deadline"
                    value={option.value}
                    checked={effectiveChoice === option.value}
                    disabled={disabled}
                    onChange={() => chooseDeadline(option.value)}
                    aria-describedby={describedBy('deadline', errors, 'tender-deadline-hint')}
                  />
                  <span>
                    {option.label}
                    {/* The reason travels ON the label: a disabled option is
                        announced with its own text. */}
                    {disabled && anyValidDeadline && (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {' '}
                        — trop proche du début des travaux
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
            <label className={radioRowClass}>
              <input
                type="radio"
                name="tender-deadline"
                value="custom"
                checked={effectiveChoice === 'custom'}
                disabled={!anyValidDeadline}
                onChange={() => chooseDeadline('custom')}
                aria-describedby={describedBy('deadline', errors, 'tender-deadline-hint')}
              />
              Date personnalisée
            </label>
          </div>

          {effectiveChoice === 'custom' && anyValidDeadline && (
            <div className="mt-3">
              <label htmlFor="tender-deadline" className={labelClass}>
                Date et heure limites
              </label>
              <input
                id="tender-deadline"
                type="datetime-local"
                min={customMin}
                max={customMax}
                value={effectiveCustom}
                onChange={(event) => handleCustomDeadlineChange(event.target.value)}
                className={fieldClass}
                aria-invalid={errors.deadline ? true : undefined}
                aria-describedby={describedBy('deadline', errors, 'tender-deadline-hint')}
              />
            </div>
          )}

          {previewMs !== null && anyValidDeadline && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              Date limite&nbsp;: {formatDateTime(new Date(previewMs).toISOString())} (heure du
              Québec)
            </p>
          )}
          <FieldError field="deadline" errors={errors} />
        </fieldset>

        {/* --- Budget indicatif (R4) ----------------------------------------- */}
        <div>
          <label htmlFor="tender-budget" className={labelClass}>
            Budget indicatif
          </label>
          <div className="relative">
            <input
              id="tender-budget"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={budget}
              onChange={(event) => {
                clearError('budget');
                setBudget(event.target.value);
              }}
              className={`${fieldClass} pr-14`}
              aria-invalid={errors.budget ? true : undefined}
              aria-describedby={describedBy('budget', errors, 'tender-budget-hint')}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-3 mt-1 flex items-center text-sm text-zinc-500 dark:text-zinc-400"
            >
              $ CA
            </span>
          </div>
          <p id="tender-budget-hint" className={hintClass}>
            Facultatif. Aide les prestataires à décider s’ils chiffrent.
          </p>
          <FieldError field="budget" errors={errors} />
        </div>

        {formError && (
          <p
            key={errorNonce}
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {geocoding ? 'Localisation…' : pending ? 'Publication…' : 'Publier l’appel d’offres'}
        </button>
      </form>
    </section>
  );
}
