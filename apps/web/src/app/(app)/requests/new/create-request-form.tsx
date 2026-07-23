'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import type { components } from '@linkr/api-client';

/**
 * Client service-request creation form (Phase 3.13-3-front) — the piece that
 * CLOSES the client transactional loop: a human creates a real OPEN request,
 * no SQL, no PowerShell.
 *
 * MINIMAL client island: only the three entered fields (title / description /
 * serviceAddress) are interactive. Everything else — requestType, the targeted
 * provider, the service/category ids, the amount/currency and the service
 * location — is DERIVED or CONSTANT (props from the Server Component's re-read),
 * never entered nor URL-borne. The price NEVER travels through the URL because
 * `estimatedAmount` is free-form on the backend (a tampered URL could book at
 * $1); the parent page re-reads the API to derive it.
 *
 * Posts to the BFF `POST /api/service-requests` (transparent relay, 3.13-3a),
 * NOT a Server Action — consistent with every other mutation in the app.
 *
 * In-form geocoding (Phase 3.14c-2): on the direct-profile edge (no URL coords),
 * the submit is INTERCEPTED once to geocode the entered `serviceAddress` via the
 * BFF `GET /api/geocode` relay, disambiguate the candidates, and POST the chosen
 * point. That GET is the one read the « BFF = mutations » rule now admits — a
 * `router.push` cannot carry it without destroying the half-filled form (see the
 * admissibility test in CLAUDE.md §Frontend). The POST is still NOT a Server
 * Action; the geocoding read is a GET relay, same cookie mechanism.
 */

type CreateServiceRequestBody = components['schemas']['CreateServiceRequestDto'];
/** Candidate + envelope come from the GENERATED contract — no hand-written mirror. */
type GeocodeCandidate = components['schemas']['GeocodeCandidateDto'];
type GeocodeResult = components['schemas']['GeocodeResultDto'];

/**
 * In-form location resolution as ONE discriminated union (not three booleans —
 * `isGeocoding` + `candidates` + `selectedCandidate` would allow impossible
 * combinations like « geocoding AND resolved »). Only reachable when the happy
 * path (URL coords) is absent.
 */
type LocationState =
  | { kind: 'idle' }
  | { kind: 'geocoding' }
  | { kind: 'candidates'; candidates: GeocodeCandidate[] }
  | { kind: 'resolved'; label: string; lat: number; lng: number };

/**
 * Fixed Québec City point, GeoJSON order [lng, lat] (lng negative). It is the
 * LAST-RESORT fallback only: the happy path (search → booking) threads the real
 * searched coordinate through the URL (3.14c-1), and on the direct-profile edge
 * the submit now geocodes the entered address in-form (3.14c-2). This placeholder
 * survives ONLY when geocoding yields nothing usable (no candidate, « Aucune de
 * ces adresses », network/502) — and it NEVER blocks the submit. (`service_location`
 * is NOT NULL; the nullable migration is a separate, tracked PR.)
 */
const QUEBEC_SERVICE_LOCATION = { type: 'Point', coordinates: [-71.21, 46.81] };

const TITLE_MAX = 200;
const ADDRESS_MAX = 500;

/** Parses a coord param; null when absent, empty, or non-finite. */
function parseCoord(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Frozen FR fallback for a BFF 502, a network failure, and any unmapped code. */
const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';

/**
 * Maps a relayed BFF/API status to FROZEN French copy. Decision is locked (same
 * convention as the dashboard actions): mapping is by HTTP status ALONE — the
 * response body is never parsed to pick a message. Vouvoiement throughout.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Certains champs sont invalides. Veuillez les vérifier.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 409:
      return "Cette demande n'est plus disponible.";
    default:
      // 502 (BFF transport failure) and anything else fall through to the
      // generic "unavailable" bucket — we never map a code that cannot occur.
      return UNAVAILABLE_MESSAGE;
  }
}

/** fr-CA currency formatting; degrades to the raw pair on an unknown ISO code. */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="font-medium text-zinc-800 sm:text-right dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';

export interface CreateRequestFormProps {
  /** Targeted provider id (from the URL) — DIRECT_BOOKING recipient. */
  providerId: string;
  /** Resolved provider name (already falls back to « ce prestataire »). */
  businessName: string;
  /** Derived from the server re-read — never entered, never URL-borne. */
  serviceItemId: string;
  serviceCategoryId: string;
  tradeLabel: string;
  serviceLabel: string;
  priceAmount: number;
  priceCurrency: string;
  /**
   * Searched coordinate threaded through the URL (voie Ⓐ, Phase 3.14c-1);
   * the GeoJSON Point is assembled as [lng, lat] at submit. Undefined on the
   * direct-profile edge (no search) → the submit geocodes the entered address
   * in-form (3.14c-2), and only if THAT yields nothing does it fall back to the
   * placeholder — never blocking the submit.
   */
  lat?: string;
  lng?: string;
}

export function CreateRequestForm({
  providerId,
  businessName,
  serviceItemId,
  serviceCategoryId,
  tradeLabel,
  serviceLabel,
  priceAmount,
  priceCurrency,
  lat,
  lng,
}: CreateRequestFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>({ kind: 'idle' });

  const priceLabel = formatMoney(priceAmount, priceCurrency);
  const geocoding = locationState.kind === 'geocoding';

  /**
   * The terminal action for EVERY path: assemble the payload with the resolved
   * `serviceLocation` and POST to the BFF. Reuses the frozen status mapping. It
   * deliberately does NOT touch `locationState` — the caller owns that (a failed
   * POST from `resolved` keeps the confirmation for a cheap retry).
   */
  async function postRequest(serviceLocation: { type: string; coordinates: number[] }) {
    // Derived/constant fields are assembled HERE, never entered nor URL-borne.
    const payload: CreateServiceRequestBody = {
      requestType: 'DIRECT_BOOKING',
      requestedServiceProviderId: providerId,
      serviceCategoryId,
      serviceItemId,
      title: title.trim(),
      description: description.trim(),
      serviceAddress: serviceAddress.trim(),
      estimatedAmount: priceAmount,
      estimatedCurrency: priceCurrency,
      // The generated type degrades GeoJSON to `Record<string, never>` (JSONB
      // quirk, CLAUDE.md §6) — cast the real Point through `unknown`. The cast
      // stays for ALL branches (URL coords, resolved candidate, placeholder).
      serviceLocation:
        serviceLocation as unknown as CreateServiceRequestBody['serviceLocation'],
    };

    setPending(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Network/transport failure → the generic "unavailable" bucket.
      setError(UNAVAILABLE_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      // Status-only mapping (locked). The user can correct and re-submit.
      setError(messageForStatus(response.status));
      setPending(false);
      return;
    }

    // 201 — the request was created OPEN and targeted at the provider. Swap the
    // form for an in-place confirmation (no redirect, no router.refresh).
    setSubmitted(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || geocoding) return;

    // Light client validation — the API is the real judge; this only spares an
    // obviously-doomed round-trip. No network call on failure.
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedAddress = serviceAddress.trim();
    if (!trimmedTitle || !trimmedDescription || !trimmedAddress) {
      setError('Veuillez remplir tous les champs.');
      return;
    }
    if (trimmedTitle.length > TITLE_MAX || trimmedAddress.length > ADDRESS_MAX) {
      setError('Certains champs dépassent la longueur autorisée.');
      return;
    }

    // Branch 1 — HAPPY PATH: the real searched coordinate arrived through the URL
    // (voie Ⓐ, 3.14c-1). NEVER intercepted — one click, direct POST, unchanged.
    // GeoJSON order [lng, lat]: LONGITUDE FIRST (inverting would send the request
    // to the wrong hemisphere; at Québec, lng is negative, lat positive).
    const latNum = parseCoord(lat);
    const lngNum = parseCoord(lng);
    if (latNum !== null && lngNum !== null) {
      await postRequest({ type: 'Point', coordinates: [lngNum, latNum] });
      return;
    }

    // Branch 2 — a candidate was already resolved in-form: POST its coordinates,
    // same [lng, lat] order.
    if (locationState.kind === 'resolved') {
      await postRequest({
        type: 'Point',
        coordinates: [locationState.lng, locationState.lat],
      });
      return;
    }

    // Branch 3 — no URL coords, nothing resolved yet: geocode the entered address,
    // intercepting THIS submit. Any failure (non-ok, network, malformed, or zero
    // candidates) falls through to a placeholder POST — the submit is NEVER
    // blocked (decision 5). Geocoding failures produce NO error message.
    setError(null);
    setLocationState({ kind: 'geocoding' });
    let candidates: GeocodeCandidate[] = [];
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmedAddress)}`);
      if (res.ok) {
        const body = (await res.json()) as GeocodeResult;
        candidates = Array.isArray(body?.candidates) ? body.candidates : [];
      }
    } catch {
      // Network/parse failure → leave candidates empty → placeholder POST below.
    }

    if (candidates.length > 0) {
      // Stop the submission and let the client disambiguate. No POST.
      setLocationState({ kind: 'candidates', candidates });
      return;
    }

    // Zero candidates or any failure → submit with the placeholder, never
    // stranded. Reset to `idle` first so the button leaves the geocoding state.
    setLocationState({ kind: 'idle' });
    await postRequest(QUEBEC_SERVICE_LOCATION);
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

  /** Explicit escape hatch — submit immediately with the placeholder. */
  function chooseNone() {
    setLocationState({ kind: 'idle' });
    void postRequest(QUEBEC_SERVICE_LOCATION);
  }

  /**
   * Editing the address invalidates any pending resolution: the candidate list
   * AND the confirmation line disappear together with their coordinates — no
   * stale coordinate ever survives an address change.
   */
  function handleAddressChange(value: string) {
    setServiceAddress(value);
    if (locationState.kind !== 'idle') setLocationState({ kind: 'idle' });
  }

  if (submitted) {
    return (
      <section className="w-full max-w-xl">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 shadow-sm dark:border-emerald-900 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Demande envoyée
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Votre demande a été envoyée à {businessName}.
          </p>

          <dl className="mt-6 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <Row label="Service">
              {tradeLabel} · {serviceLabel}
            </Row>
            <Row label="Montant estimé">{priceLabel}</Row>
            <Row label="Adresse">{serviceAddress.trim()}</Row>
          </dl>

          {/* Primary → « Mes demandes » (the request now lives there); the
              existing « Retour à l’accueil » is kept as a secondary link. */}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/requests"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"
            >
              Voir mes demandes
            </Link>
            <Link
              href="/"
              className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              ← Retour à l’accueil
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Demande à {businessName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {tradeLabel} · {serviceLabel}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* Read-only context — NOT inputs. The price is derived server-side. */}
        <dl className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Row label="Service">
            {tradeLabel} · {serviceLabel}
          </Row>
          <Row label="Montant estimé">{priceLabel}</Row>
        </dl>

        <div>
          <label htmlFor="title" className={labelClass}>
            Titre
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="serviceAddress" className={labelClass}>
            Adresse du service
          </label>
          <input
            id="serviceAddress"
            name="serviceAddress"
            type="text"
            required
            maxLength={ADDRESS_MAX}
            value={serviceAddress}
            onChange={(e) => handleAddressChange(e.target.value)}
            className={fieldClass}
          />
        </div>

        {/* Candidate list (state `candidates`) — the client disambiguates. Each
            option is `type="button"` (the default in a <form> is submit). */}
        {locationState.kind === 'candidates' && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
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

        {/* Confirmation line (state `resolved`) — sober, coordinates held. */}
        {locationState.kind === 'resolved' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Localisé&nbsp;: {locationState.label}
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || geocoding}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {geocoding ? 'Localisation…' : pending ? 'Envoi…' : 'Envoyer la demande'}
        </button>
      </form>
    </section>
  );
}
