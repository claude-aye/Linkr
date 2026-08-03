'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  type GeocodeCandidate,
  geocodeAddress,
} from '@/lib/geocoding/geocode-address';

/**
 * « Devenir prestataire » form — the web door to `POST /service-providers`.
 *
 * Posts to the BFF `POST /api/service-providers` (which pins `providerType` and
 * builds the GeoJSON Point), NOT a Server Action — consistent with every other
 * mutation in the app. Three fields, and nothing else: `headline` and `bio` are
 * out of scope, `organizationId` is forbidden for an INDIVIDUAL provider, and
 * `user_id` is derived by the API from the JWT.
 *
 * ⚠️ THE RULE HERE IS THE OPPOSITE OF THE REQUEST FORM'S — do not « fix » the
 * inconsistency. `create-request-form.tsx` never blocks a submit: it degrades to
 * the searched area, then to the Québec placeholder, because a blocked client is
 * a lost client and someone is waiting on the other end.
 *
 * This form BLOCKS. A provider's base location is what decides WHICH CITY HE
 * APPEARS IN (`ST_DWithin` against `service_base_location`). A silent fallback
 * would publish him at the wrong place — invisible to his real neighbours, and
 * offered to clients 250 km away — with nothing on screen to reveal it. Nobody is
 * waiting, and he can simply try another wording. Hence: no fallback, no
 * placeholder, no « envoyer quand même ». The address must geocode, and the user
 * must have picked one of the returned candidates, or there is no submit.
 */

/** Mirror of `CreateServiceProviderDto`'s `@MaxLength(150)` on `businessName`. */
const BUSINESS_NAME_MAX = 150;
/**
 * UI hygiene only — NOT a DTO mirror. The typed address is never stored: it is
 * geocoded and thrown away, only the resolved Point is sent.
 */
const ADDRESS_MAX = 500;
/** Product default; the DTO only requires an integer ≥ 0. */
const DEFAULT_RADIUS_KM = 25;

/**
 * In-form location resolution as ONE discriminated union (same shape as the
 * request form's, minus every degradation state — there is nothing to degrade
 * to here). `resolved` is the ONLY state from which a submit can post.
 */
type LocationState =
  | { kind: 'idle' }
  | { kind: 'geocoding' }
  | { kind: 'candidates'; candidates: GeocodeCandidate[] }
  | { kind: 'resolved'; label: string; lat: number; lng: number }
  | { kind: 'unresolved'; reason: 'no-match' | 'unavailable' };

/** The 409 branch is the only one that offers a way out, hence the flag. */
type FormError = { text: string; withDashboardLink: boolean };

/** Frozen FR fallback for a BFF 502, a network failure, and any unmapped code. */
const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';

/**
 * Maps a relayed BFF/API status to FROZEN French copy. Mapping is by HTTP status
 * ALONE — the response body is never parsed to pick a message (convention locked
 * since 3.12b). Vouvoiement throughout.
 */
function errorForStatus(status: number): FormError {
  switch (status) {
    case 409:
      // `ProviderOwnerConflictException` — this user already has an active
      // provider. The one case that must say what to do about it.
      return {
        text: 'Vous avez déjà un profil prestataire.',
        withDashboardLink: true,
      };
    case 400:
      return {
        text: 'Certains champs sont invalides. Veuillez les vérifier.',
        withDashboardLink: false,
      };
    case 401:
      return {
        text: 'Votre session a expiré. Veuillez vous reconnecter.',
        withDashboardLink: false,
      };
    default:
      return { text: UNAVAILABLE_MESSAGE, withDashboardLink: false };
  }
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const hintClass = 'mt-1 text-xs text-zinc-500 dark:text-zinc-400';

export interface CreateProviderFormProps {
  /**
   * Suggested public name, resolved server-side from the session user. It is a
   * SUGGESTION: pre-filled so the profile is never born nameless, freely
   * editable, and clearable — `businessName` is optional on the DTO.
   */
  suggestedBusinessName: string;
}

export function CreateProviderForm({ suggestedBusinessName }: CreateProviderFormProps) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState(suggestedBusinessName);
  const [address, setAddress] = useState('');
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_KM));
  const [locationState, setLocationState] = useState<LocationState>({ kind: 'idle' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  /** Scroll anchor for the « address field + announced region » block. */
  const addressBlockRef = useRef<HTMLDivElement>(null);
  /** Focus target of « Corriger l'adresse » — the only focus move we make. */
  const addressInputRef = useRef<HTMLInputElement>(null);

  const geocoding = locationState.kind === 'geocoding';
  const locationKind = locationState.kind;

  /**
   * The candidate list is born UNDER the mobile virtual keyboard: the user sees
   * nothing happen, retries, and truncates the address further. Bring the whole
   * block into view instead.
   *
   * `block: 'start'` and NOT 'center': with the keyboard open the layout viewport
   * does not shrink, so "centre" lands behind the keyboard. At the start, the
   * field rises toward the top and the panel sits right under it — both above the
   * keyboard, the typed address visible next to the outcome.
   *
   * In an effect, never inline in the handler: the panel must be committed to the
   * DOM before we can scroll to it.
   */
  useEffect(() => {
    if (locationKind !== 'candidates' && locationKind !== 'unresolved') return;
    addressBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [locationKind]);

  /**
   * Geocodes `value` through the shared seam and lands on exactly one of three
   * states. It NEVER posts — the user always gets to see and accept the outcome.
   * Shared by the intercepted submit and by « Réessayer ».
   */
  async function runGeocode(value: string) {
    setError(null);
    setLocationState({ kind: 'geocoding' });

    const outcome = await geocodeAddress(value);
    setLocationState(
      outcome.kind === 'candidates'
        ? { kind: 'candidates', candidates: outcome.candidates }
        : { kind: 'unresolved', reason: outcome.kind },
    );
  }

  /** Posts the assembled profile. Only ever called from a `resolved` location. */
  async function postProvider(lat: number, lng: number, radiusKm: number) {
    setPending(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/service-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: businessName.trim(),
          // Two plain numbers: the BFF builds the [lng, lat] Point server-side.
          lat,
          lng,
          serviceRadiusKm: radiusKm,
        }),
      });
    } catch {
      setError({ text: UNAVAILABLE_MESSAGE, withDashboardLink: false });
      setPending(false);
      return;
    }

    if (!response.ok) {
      setError(errorForStatus(response.status));
      setPending(false);
      return;
    }

    // Created (201) and active immediately. Land on the dashboard, which now
    // resolves the fresh profile — same push + refresh as the sign-in/sign-up
    // pages. `pending` stays true: the navigation is under way, and re-enabling
    // the button would invite a second creation doomed to 409.
    router.push('/dashboard');
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || geocoding) return;

    // Light client validation — the API stays the real judge; this only spares an
    // obviously-doomed round-trip. No network call on failure.
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setError({
        text: 'Veuillez saisir votre adresse de base.',
        withDashboardLink: false,
      });
      return;
    }
    if (trimmedAddress.length > ADDRESS_MAX || businessName.trim().length > BUSINESS_NAME_MAX) {
      setError({
        text: 'Certains champs dépassent la longueur autorisée.',
        withDashboardLink: false,
      });
      return;
    }

    // `@IsInt() @Min(0)` on the DTO — mirrored so a decimal or a negative never
    // costs a round-trip. 0 is legitimate (coverage by named zones only).
    const radiusKm = Number(radius);
    if (!Number.isInteger(radiusKm) || radiusKm < 0) {
      setError({
        text: 'Le rayon de service doit être un nombre entier de kilomètres (0 ou plus).',
        withDashboardLink: false,
      });
      return;
    }

    // Branch 1 — a candidate was resolved in-form: post its coordinates.
    if (locationState.kind === 'resolved') {
      await postProvider(locationState.lat, locationState.lng, radiusKm);
      return;
    }

    // Branch 2 — DEFAULT, and the only other one: geocode the typed address,
    // intercepting THIS submit. There is no third branch: without a coordinate
    // the user has SEEN and PICKED, nothing is posted (see the header comment).
    await runGeocode(trimmedAddress);
  }

  /** Picking a candidate resolves the location — it does NOT submit. */
  function chooseCandidate(candidate: GeocodeCandidate) {
    setLocationState({
      kind: 'resolved',
      label: candidate.label,
      lat: candidate.lat,
      lng: candidate.lng,
    });
  }

  /** « Aucune de ces adresses » — nothing to fall back on, so: correct it. */
  function chooseNone() {
    setLocationState({ kind: 'unresolved', reason: 'no-match' });
  }

  /** `unresolved`/'no-match' → back to `idle`, focus on the address field. */
  function correctAddress() {
    setLocationState({ kind: 'idle' });
    addressInputRef.current?.focus();
  }

  /** `unresolved`/'unavailable' → re-run the geocoding on the SAME address. */
  function retryGeocode() {
    if (pending || geocoding) return;
    void runGeocode(address.trim());
  }

  /**
   * Editing the address invalidates any pending resolution: the candidate list,
   * the confirmation line AND the unresolved panel disappear together with their
   * coordinates. No stale coordinate, and no stale verdict about an address that
   * no longer exists, survives an edit.
   */
  function handleAddressChange(value: string) {
    setAddress(value);
    if (locationState.kind !== 'idle') setLocationState({ kind: 'idle' });
  }

  return (
    <section className="w-full max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Devenir prestataire
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Créez votre profil pour offrir vos services sur Linkr.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label htmlFor="businessName" className={labelClass}>
            Nom d’affichage
          </label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            maxLength={BUSINESS_NAME_MAX}
            value={businessName}
            onChange={(event) => setBusinessName(event.target.value)}
            className={fieldClass}
            aria-describedby="businessName-hint"
          />
          <p id="businessName-hint" className={hintClass}>
            Le nom que vos clients verront. Vous pouvez le modifier.
          </p>
        </div>

        {/* The address field and its announced region share ONE scroll anchor:
            on mobile they have to clear the virtual keyboard together, or the
            user sees neither what was typed nor what came back. */}
        <div ref={addressBlockRef} className="scroll-mt-6">
          <label htmlFor="baseAddress" className={labelClass}>
            Adresse de base
          </label>
          <input
            id="baseAddress"
            name="baseAddress"
            ref={addressInputRef}
            type="text"
            required
            maxLength={ADDRESS_MAX}
            value={address}
            onChange={(event) => handleAddressChange(event.target.value)}
            className={fieldClass}
            aria-describedby="baseAddress-hint"
          />
          <p id="baseAddress-hint" className={hintClass}>
            Le point à partir duquel votre rayon de service est calculé.
          </p>

          {/* ONE live region for BOTH outcomes — never two. It stays in the DOM
              even when empty: a live region inserted at the same time as its
              content is very often not announced at all. `polite`, and no focus
              stealing — focus only moves on « Corriger l’adresse ». */}
          <div aria-live="polite">
            {/* Candidate list — the user disambiguates. Each option is
                `type="button"` (the default inside a <form> is submit). */}
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
                        className="block w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {candidate.label}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={chooseNone}
                  className="mt-3 text-sm font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  Aucune de ces adresses
                </button>
              </div>
            )}

            {/* Unresolved — the geocoding produced no coordinate the user has
                accepted. NO « envoyer quand même » here, by design: the only
                ways out are to reword the address or to retry. The copy says
                what to do, because doing it is the only option. */}
            {locationState.kind === 'unresolved' && (
              <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  {locationState.reason === 'no-match'
                    ? 'Nous n’avons pas pu localiser cette adresse. Reformulez-la avec le numéro et la rue, une intersection, ou un code postal.'
                    : 'La localisation d’adresse est momentanément indisponible. Veuillez réessayer dans quelques instants.'}
                </p>
                <div className="mt-3">
                  {locationState.reason === 'no-match' ? (
                    <button
                      type="button"
                      onClick={correctAddress}
                      className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
                    >
                      Corriger l’adresse
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={retryGeocode}
                      disabled={pending || geocoding}
                      className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
                    >
                      Réessayer
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Confirmation line — sober, coordinates held. */}
        {locationState.kind === 'resolved' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Localisé&nbsp;: {locationState.label}
          </p>
        )}

        <div>
          <label htmlFor="serviceRadiusKm" className={labelClass}>
            Rayon de service (km)
          </label>
          <input
            id="serviceRadiusKm"
            name="serviceRadiusKm"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            required
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            className={fieldClass}
            aria-describedby="serviceRadiusKm-hint"
          />
          <p id="serviceRadiusKm-hint" className={hintClass}>
            La distance autour de votre adresse de base sur laquelle vous acceptez
            de vous déplacer.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error.text}
            {error.withDashboardLink && (
              <>
                {' '}
                <Link
                  href="/dashboard"
                  className="font-medium underline underline-offset-2"
                >
                  Voir mon tableau de bord.
                </Link>
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || geocoding}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {geocoding ? 'Localisation…' : pending ? 'Création…' : 'Créer mon profil'}
        </button>

        {/* Honest about what creating the profile does — and does NOT do. It is
            active at once (`is_active` is true API-side) but not yet
            discoverable, because discovery matches on a declared trade. No
            promise of a next step: declaring a trade has no interface yet. */}
        <p className={hintClass}>
          Votre profil sera actif dès sa création. Il n’apparaîtra pas encore dans
          les résultats de recherche&nbsp;: cela demande un métier déclaré.
        </p>
      </form>
    </section>
  );
}
