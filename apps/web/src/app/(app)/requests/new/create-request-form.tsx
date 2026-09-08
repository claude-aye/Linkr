'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { components } from '@linkr/api-client';
import { formatDateTimeRange } from '@/lib/dates/format';

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
 * In-form geocoding (Phase 3.14c-2, now the SOLE path): EVERY submit is
 * INTERCEPTED once to geocode the entered `serviceAddress` via the BFF
 * `GET /api/geocode` relay, disambiguate the candidates, and POST the chosen
 * point — whichever door the client came through. The typed address is the only
 * source of the service location. The coordinate carried by the URL describes
 * where the client LOOKED FOR a provider, not where the service will take
 * place: two different data, and the form asks for the second one. It is now a
 * last-resort fallback only (see `submitAnyway`).
 *
 * That GET is the one read the « BFF = mutations » rule now admits — a
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
  | { kind: 'resolved'; label: string; lat: number; lng: number }
  /**
   * Geocoding produced no coordinate the client has SEEN and accepted.
   * `no-match` — the service answered but placed nothing (address truncated,
   * typo), or the client rejected every candidate. `unavailable` — a technical
   * failure: non-2xx (including an expired session's relayed 401), network
   * error, unreadable payload. The reason drives the left-hand action only;
   * « Envoyer quand même » is offered either way, so the submit is never a
   * dead end.
   */
  | { kind: 'unresolved'; reason: 'no-match' | 'unavailable' };

/**
 * Fixed Québec City point, GeoJSON order [lng, lat] (lng negative). It is the
 * BOTTOM rung of an explicit degradation ladder:
 *
 *   geocoded typed address  ›  searched area (URL coords)  ›  this placeholder
 *
 * Every submit geocodes the typed address first; only « Envoyer quand même »
 * degrades, and it prefers the searched area whenever the URL carries one.
 *
 * INVARIANT: exactly ONE call site can reach it — the « Envoyer quand même »
 * handler. Every path that used to reach it silently (zero candidates,
 * geocoding failure, « Aucune de ces adresses ») stops on the `unresolved`
 * panel first. No coordinate is submitted that the client has not seen and
 * accepted; the submit is still never blocked. (`service_location` is NOT NULL;
 * the nullable migration is a separate, tracked PR.)
 */
const QUEBEC_SERVICE_LOCATION = { type: 'Point', coordinates: [-71.21, 46.81] };

/**
 * D5c — the same floor the API enforces (`MIN_LEAD_TIME_HOURS`). Mirrored, not
 * imported: `apps/web` does not depend on `apps/api`. If one moves, both move.
 */
const MIN_LEAD_TIME_HOURS = 2;
/** D5b — window length pre-filled when the client only picks a start. */
const DEFAULT_WINDOW_HOURS = 2;
/**
 * D5d — largeur MAXIMALE de la fenêtre souhaitée.
 *
 * ⚠️ CE PLAFOND EXISTE À CAUSE DE LA RÈGLE DE RÉSOLUTION D8, pas par goût de la
 * contrainte. À l'acceptation, l'API retient le DÉBUT de la fenêtre et
 * `desired_end_at_utc` ne décide plus rien. Une plage d'un mois — observée au
 * smoke de la PR 2, le sélecteur natif rend le défilement du mois trop facile —
 * n'est donc pas une disponibilité large : c'est un « quand vous voulez » que le
 * système écrase silencieusement en retenant le premier instant. Mieux vaut
 * refuser franchement que d'accepter une donnée qu'on trahit ensuite.
 *
 * Au-delà d'une journée, une fenêtre cesse d'exprimer la souplesse du client sur
 * une journée de travail. ⚠️ Contrôle CLIENT UNIQUEMENT pour l'instant : l'API ne
 * vérifie que `fin > début`. Le miroir côté service part avec la PR 3, en même
 * temps que le passage des bornes à obligatoire.
 */
const MAX_WINDOW_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * `datetime-local` speaks WALL TIME with no zone — « YYYY-MM-DDTHH:mm », read
 * in the BROWSER's zone. Built from LOCAL parts on purpose: `toISOString()`
 * would shift the value by the UTC offset and pre-fill the wrong hour.
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
   * Coordinates of the AREA the client searched a provider in, threaded through
   * the URL (voie Ⓐ, Phase 3.14c-1). They do NOT describe where the service will
   * take place — the typed address does — and are used ONLY as a last-resort
   * fallback, behind « Envoyer quand même », when geocoding that address
   * produced nothing the client accepted. Undefined when the client arrived
   * through a shared profile link (no search upstream).
   *
   * The URL parameters keep their `lat`/`lng` names; only this props boundary is
   * renamed, so the sense is impossible to mistake at the point of use.
   */
  searchLat?: string;
  searchLng?: string;
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
  searchLat,
  searchLng,
}: CreateRequestFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  // Wall-clock strings straight from the two inputs — converted to instants
  // only at submit (see `readDesiredWindow`), never stored as Dates.
  const [desiredStart, setDesiredStart] = useState('');
  const [desiredEnd, setDesiredEnd] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>({ kind: 'idle' });

  /** Scroll anchor for the « address field + announced region » block. */
  const addressBlockRef = useRef<HTMLDivElement>(null);
  /** Focus target of « Corriger l’adresse » — the only focus move we make. */
  const addressInputRef = useRef<HTMLInputElement>(null);
  /** The two window inputs — see the `min` effect below for why refs. */
  const desiredStartRef = useRef<HTMLInputElement>(null);
  const desiredEndRef = useRef<HTMLInputElement>(null);

  /**
   * The `min` floor is written to the DOM after mount, NOT rendered.
   *
   * Two reasons, and the second is measured. (1) « maintenant + 2 h » in the
   * browser's wall time cannot be rendered on the server: Node runs in UTC and
   * the browser in Toronto, so the server HTML and the first client render
   * would disagree — a hydration mismatch, the same class of defect that made
   * the A-2 login notice never appear. (2) The obvious fix, `useState` + a
   * `setState` in this effect, is REFUSED by `react-hooks/set-state-in-effect`
   * (verified by running the lint on a probe, not assumed). Writing the
   * attribute directly is the escape hatch that rule's own message names —
   * « manually updating the DOM ».
   *
   * It is a COURTESY: it narrows the mobile picker, and nothing more. A client
   * can still type an earlier hour, and the real gates are the check in
   * `handleSubmit` and, behind it, the API.
   */
  useEffect(() => {
    const floor = toLocalInputValue(new Date(Date.now() + MIN_LEAD_TIME_HOURS * MS_PER_HOUR));
    if (desiredStartRef.current) desiredStartRef.current.min = floor;
    if (desiredEndRef.current) desiredEndRef.current.min = floor;
  }, []);

  /**
   * The window as instants, or null when either bound is missing/unparseable.
   * ⚠️ `new Date('').toISOString()` THROWS — every path to the payload goes
   * through here so an unusable bound becomes a message, never a blank screen.
   */
  function readDesiredWindow(): {
    startIso: string;
    endIso: string;
    startMs: number;
    endMs: number;
  } | null {
    const start = new Date(desiredStart);
    const end = new Date(desiredEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      startMs: start.getTime(),
      endMs: end.getTime(),
    };
  }

  /**
   * D5b — moving the start pulls the end along, but ONLY when the end is empty
   * or would now sit before it. An end the client chose, and that stays valid,
   * is never overwritten.
   */
  function handleDesiredStartChange(value: string) {
    setDesiredStart(value);
    const start = new Date(value);
    if (!value || Number.isNaN(start.getTime())) return;
    const end = desiredEnd ? new Date(desiredEnd) : null;
    const endUnusable = !end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime();
    if (endUnusable) {
      setDesiredEnd(toLocalInputValue(new Date(start.getTime() + DEFAULT_WINDOW_HOURS * MS_PER_HOUR)));
    }
  }

  const priceLabel = formatMoney(priceAmount, priceCurrency);
  const geocoding = locationState.kind === 'geocoding';
  const locationKind = locationState.kind;

  /**
   * Search coordinates carried by the URL — props, so stable for this render.
   *
   * Hoisted to component scope so the fallback panel's promise and the payload
   * `submitAnyway` actually sends are read from the SAME two values. Computing
   * them twice would let the panel announce « the area you searched » while the
   * submit stored UNKNOWN — the panel would then lie about the very thing this
   * phase exists to make honest.
   */
  const searchLatNum = parseCoord(searchLat);
  const searchLngNum = parseCoord(searchLng);
  const hasSearchCoords = searchLatNum !== null && searchLngNum !== null;

  /**
   * Perceptibility, the mobile half of the fix: the candidate list is born
   * UNDER the virtual keyboard — the client sees nothing happen, retries, and
   * truncates the address further. Bring the whole block into view instead.
   *
   * `block: 'start'` and NOT 'center': with the keyboard open the layout
   * viewport does not shrink, so "centre" lands behind the keyboard. At the
   * start, the field rises toward the top and the panel sits right under it —
   * both above the keyboard, the typed address visible next to the outcome.
   *
   * In an effect, never inline in the handler: the panel must be committed to
   * the DOM before we can scroll to it.
   */
  useEffect(() => {
    if (locationKind !== 'candidates' && locationKind !== 'unresolved') return;
    addressBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [locationKind]);

  /**
   * The terminal action for EVERY path: assemble the payload with the resolved
   * `serviceLocation` and POST to the BFF. Reuses the frozen status mapping. It
   * deliberately does NOT touch `locationState` — the caller owns that (a failed
   * POST from `resolved` keeps the confirmation for a cheap retry).
   */
  async function postRequest(
    serviceLocation: { type: string; coordinates: number[] },
    // REQUIRED second parameter, typed from the GENERATED union — never a local
    // literal, so any change to the backend enum breaks here. Required on
    // purpose: a caller that forgot to state the provenance would not compile,
    // which makes the omission structurally impossible rather than merely
    // discouraged. The provenance is therefore always decided ADJACENT to the
    // coordinate it describes, never defaulted at this single assembly site —
    // a constant set here and overwritten in the fallbacks would let a
    // forgotten branch CLAIM precision it does not have, which is exactly the
    // lie this phase removes.
    serviceLocationPrecision: NonNullable<
      CreateServiceRequestBody['serviceLocationPrecision']
    >,
    // REQUIRED third parameter, same motive as the precision above: a caller
    // that forgot the window would NOT COMPILE. It is passed rather than read
    // from state so the value that travels is the one `handleSubmit` actually
    // validated, and so a future third caller cannot post a dateless booking.
    desiredWindow: { startIso: string; endIso: string },
  ) {
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
      // Travels with the coordinate above; no cast needed (clean string union).
      serviceLocationPrecision,
      // D0b — heure murale saisie, convertie dans le fuseau du NAVIGATEUR.
      // Correct pour un client au Québec ; décalé pour un client qui réserve
      // depuis un autre fuseau. Dette assumée et documentée (CLAUDE.md §13.1) :
      // l'alternative — de l'arithmétique de fuseaux écrite à la main dans une
      // application SANS banc de test — est plus risquée que la dette. Le
      // stockage reste UTC.
      desiredStartAtUtc: desiredWindow.startIso,
      desiredEndAtUtc: desiredWindow.endIso,
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

  /**
   * Geocodes `address` through the BFF relay and lands on exactly one of three
   * states: `candidates` (≥ 1 hit), `unresolved`/'no-match' (the service
   * answered with an empty list), `unresolved`/'unavailable' (technical
   * failure). It NEVER posts — the client always gets to see the outcome.
   *
   * Shared by the intercepted submit and by « Réessayer », so both produce the
   * same states from the same address.
   */
  async function runGeocode(address: string) {
    setError(null);
    setLocationState({ kind: 'geocoding' });

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      if (!res.ok) {
        // Includes the expired session's 401, relayed as JSON: a failure of
        // OURS, never a statement about the address the client typed.
        setLocationState({ kind: 'unresolved', reason: 'unavailable' });
        return;
      }
      const body = (await res.json()) as GeocodeResult;
      const candidates = body?.candidates;
      if (!Array.isArray(candidates)) {
        // Well-formed HTTP, malformed payload → technical failure too.
        setLocationState({ kind: 'unresolved', reason: 'unavailable' });
        return;
      }
      setLocationState(
        candidates.length > 0
          ? { kind: 'candidates', candidates }
          : { kind: 'unresolved', reason: 'no-match' },
      );
    } catch {
      // Network error, or a body that is not readable JSON.
      setLocationState({ kind: 'unresolved', reason: 'unavailable' });
    }
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

    // The window is checked HERE, in the light block, so it runs BEFORE the
    // geocoding interception below. Validating it after would make the client
    // pick an address out of the candidate list and only THEN be told the date
    // is refused — the second half of a submit rejected for the first half.
    if (!desiredStart || !desiredEnd) {
      setError('Veuillez indiquer la période souhaitée : un début et une fin.');
      return;
    }
    const desiredWindow = readDesiredWindow();
    if (!desiredWindow) {
      setError('La période souhaitée est invalide.');
      return;
    }
    if (desiredWindow.endMs <= desiredWindow.startMs) {
      setError('La fin de la période doit être postérieure au début.');
      return;
    }
    if (desiredWindow.startMs < Date.now() + MIN_LEAD_TIME_HOURS * MS_PER_HOUR) {
      setError(
        `Le début souhaité doit être dans au moins ${MIN_LEAD_TIME_HOURS} heures.`,
      );
      return;
    }
    if (desiredWindow.endMs - desiredWindow.startMs > MAX_WINDOW_HOURS * MS_PER_HOUR) {
      setError(
        `La période souhaitée ne peut pas dépasser ${MAX_WINDOW_HOURS} heures.`,
      );
      return;
    }

    // Branch 1 — a candidate was already resolved in-form: POST its coordinates.
    // GeoJSON order [lng, lat]: LONGITUDE FIRST (inverting would send the request
    // to the wrong hemisphere; at Québec, lng is negative, lat positive).
    if (locationState.kind === 'resolved') {
      await postRequest(
        {
          type: 'Point',
          coordinates: [locationState.lng, locationState.lat],
        },
        // Stated where the coordinate is built: this point comes from the
        // address the client typed, geocoded, and picked from the candidates.
        'GEOCODED',
        desiredWindow,
      );
      return;
    }

    // Branch 2 — DEFAULT, and the only other one: geocode the entered address,
    // intercepting THIS submit. The URL coordinates are deliberately NOT
    // consulted here — they locate the client's SEARCH, not the service, so
    // taking them would silently discard the address the form just required.
    // Both doors (search result, shared link) now behave identically, and every
    // outcome is shown to the client (candidate list, or the `unresolved`
    // panel); none of them posts.
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

  /**
   * « Aucune de ces adresses » — the client rejects every candidate. It no
   * longer submits on the spot: it lands on the same panel a failed geocoding
   * produces, where sending anyway costs one more, deliberate tap.
   */
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
    void runGeocode(serviceAddress.trim());
  }

  /**
   * THE one and only door to a degraded location, reachable solely by an
   * explicit gesture on a panel the client has read. `type="button"` + onClick:
   * it must NEVER re-enter the submit handler, which would re-geocode instead
   * of posting. Same `pending` guard as the main button (anti double-click).
   *
   * It degrades ONE rung at a time: the searched area (URL coordinates) when
   * the client came from a search — a coarse but real neighbourhood — and only
   * the Québec placeholder when there is nothing else, i.e. on a shared link.
   * The panel's copy stays the same for both: distinguishing them would buy a
   * conditional of copy for a marginal gain, and the honesty of the wording is
   * the `location_is_approximate` debt, tracked separately.
   *
   * `locationState` is deliberately left on `unresolved`: a POST that fails
   * (401, 409…) keeps the panel in place for a cheap retry, exactly as a failed
   * POST from `resolved` keeps its confirmation line.
   */
  function submitAnyway() {
    if (pending || geocoding) return;

    // ⚠️ NE PAS y dupliquer la validation de la période — ce n'est pas un trou.
    // Ce bouton n'est atteignable que depuis le panneau `unresolved`, que SEUL
    // `handleSubmit` produit, et qui vient donc APRÈS la validation. Les deux
    // états n'ont pas pu changer entre-temps (le panneau est rendu à partir des
    // mêmes valeurs). On relit la fenêtre plutôt que de la refaire valider ; le
    // `null` ci-dessous est inatteignable par construction, et il vaut mieux un
    // message qu'un écran blanc si un jour un autre appelant apparaît.
    const desiredWindow = readDesiredWindow();
    if (!desiredWindow) {
      setError('La période souhaitée est invalide.');
      return;
    }

    // Same [lng, lat] order as every other branch — longitude first.
    // The existing coordinate fork is ENRICHED, not rewritten: each arm now
    // yields the PAIR (point + where it came from), so the provenance cannot be
    // separated from the point it describes.
    const { location, precision } =
      searchLatNum !== null && searchLngNum !== null
        ? {
            location: { type: 'Point', coordinates: [searchLngNum, searchLatNum] },
            precision: 'SEARCH_AREA' as const,
          }
        : { location: QUEBEC_SERVICE_LOCATION, precision: 'UNKNOWN' as const };
    void postRequest(location, precision, desiredWindow);
  }

  /**
   * Editing the address invalidates any pending resolution: the candidate list,
   * the confirmation line AND the `unresolved` panel disappear together with
   * their coordinates — no stale coordinate, and no stale verdict about an
   * address that no longer exists, survives an edit. Rule unchanged; the new
   * state simply falls under the existing « anything but idle → idle ».
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
            {/* Le dernier écran où le client relit ce qu'il vient d'envoyer —
                un récapitulatif de réservation sans sa date se remarque. */}
            <Row label="Période souhaitée">
              {formatDateTimeRange(desiredStart, desiredEnd)}
            </Row>
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

        {/* The address field and its announced region share ONE scroll anchor:
            on mobile they have to clear the virtual keyboard together, or the
            client sees neither what was typed nor what came back. */}
        <div ref={addressBlockRef} className="scroll-mt-6">
          <label htmlFor="serviceAddress" className={labelClass}>
            Adresse du service
          </label>
          <input
            id="serviceAddress"
            name="serviceAddress"
            ref={addressInputRef}
            type="text"
            required
            maxLength={ADDRESS_MAX}
            value={serviceAddress}
            onChange={(e) => handleAddressChange(e.target.value)}
            className={fieldClass}
          />

          {/* ONE live region for BOTH outcomes — never two. It stays in the DOM
              even when empty: a live region inserted at the same time as its
              content is very often not announced at all. `polite`, and no focus
              stealing — focus only moves on « Corriger l’adresse ». */}
          <div aria-live="polite">
            {/* Candidate list (state `candidates`) — the client disambiguates.
                Each option is `type="button"` (default in a <form> is submit). */}
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

            {/* Unresolved (state `unresolved`) — the geocoding produced nothing
                the client has accepted. Left action depends on the reason; the
                right one is the single, explicit door to the placeholder. */}
            {locationState.kind === 'unresolved' && (
              <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
                {/* CAUSE — why geocoding failed. The former shared tail
                    « …sans localisation précise » is GONE on purpose: it covered
                    both fallbacks with one vague phrase, which was the whole
                    debt. Adding the truth beside the vagueness would not have
                    replaced it. */}
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  {locationState.reason === 'no-match'
                    ? 'Nous n’avons pas pu localiser cette adresse. Vérifiez qu’elle est complète.'
                    : 'La localisation d’adresse est momentanément indisponible. Vous pouvez réessayer.'}
                </p>
                {/* CONSEQUENCE — what will actually be recorded if they send
                    anyway. Keyed on a DIFFERENT axis than the cause above
                    (coordinates available or not), because that, not the reason
                    for the failure, is what decides the stored provenance. Read
                    from `hasSearchCoords`, the same value `submitAnyway` uses,
                    so this cannot promise one thing and store another. */}
                <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
                  {hasSearchCoords
                    ? 'Nous enregistrerons le secteur où vous avez cherché. L’adresse que vous avez saisie reste affichée au prestataire.'
                    : 'Nous ne pourrons enregistrer aucune position. Seule l’adresse que vous avez saisie sera transmise au prestataire.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
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
                  <button
                    type="button"
                    onClick={submitAnyway}
                    disabled={pending || geocoding}
                    className="text-sm font-medium text-amber-800 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300"
                  >
                    Envoyer quand même
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Confirmation line (state `resolved`) — sober, coordinates held. */}
        {locationState.kind === 'resolved' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            Localisé&nbsp;: {locationState.label}
          </p>
        )}

        {/* D2/D5a — la période souhaitée. Les deux champs sont requis ICI (le
            client ne réserve pas « un jour »), alors que l'API les garde
            facultatifs : la contrainte serveur arrive avec la PR qui corrige
            aussi le seeder. `required` est doublé par le contrôle JS, parce que
            le formulaire porte `noValidate`. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="desiredStart" className={labelClass}>
              Début souhaité
            </label>
            <input
              id="desiredStart"
              name="desiredStart"
              ref={desiredStartRef}
              type="datetime-local"
              required
              value={desiredStart}
              onChange={(e) => handleDesiredStartChange(e.target.value)}
              aria-describedby="desiredStart-hint"
              className={fieldClass}
            />
            <p
              id="desiredStart-hint"
              className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
            >
              Dans au moins {MIN_LEAD_TIME_HOURS} heures.
            </p>
          </div>

          <div>
            <label htmlFor="desiredEnd" className={labelClass}>
              Fin souhaitée
            </label>
            <input
              id="desiredEnd"
              name="desiredEnd"
              ref={desiredEndRef}
              type="datetime-local"
              required
              value={desiredEnd}
              onChange={(e) => setDesiredEnd(e.target.value)}
              aria-describedby="desiredEnd-hint"
              className={fieldClass}
            />
            <p
              id="desiredEnd-hint"
              className="mt-1 text-xs text-zinc-500 dark:text-zinc-400"
            >
              La marge que vous laissez au prestataire.
            </p>
          </div>
        </div>

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
