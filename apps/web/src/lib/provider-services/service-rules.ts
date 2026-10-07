/**
 * « Mes services » (PR A) — every rule of the provider's service catalogue that
 * can be decided without a browser or a network: price and duration parsing,
 * display formatting, the FR copy for each HTTP status, and the assembly of
 * the bodies the two BFF relays forward.
 *
 * ⚠️ THIS MODULE IMPORTS NOTHING, on purpose. It is loaded as-is by
 * `node --test` (`web-tests.yml` installs no dependency), so it cannot reach
 * `@linkr/api-client`, `@/…`, nor even its sibling `tender-rules.ts`. The two
 * relays and the dashboard components import it; it imports no one.
 *
 * Locked product decisions it encodes (cf. CLAUDE.md §11 « Mes services — PR A »):
 *   - FLAT only. `pricingModel: 'FLAT'` and `priceCurrency: 'CAD'` are FROZEN
 *     here, in the create body — never read from the incoming request, never a
 *     field on screen. HOURLY is hidden because the booking form sends the
 *     hourly rate as the agreed price (deposit and balance computed on one
 *     hour); QUOTE_ONLY because, without a price, there is no « Demander ».
 *   - A price of AT LEAST 5 $, on creation AND on edit. The API only enforces
 *     `>= 0`; a zero budget 400s at booking, a 0 ¢ deposit is refused, and
 *     Stripe has a per-charge minimum. The relays apply the floor too: they are
 *     the only server-side point the web controls.
 *   - Duration optional, entered as hours + minutes, sent as whole minutes.
 *     Both fields empty → the key is OMITTED. No fallback on the catalogue's
 *     `typical_duration_minutes`: nothing on the API side reads it.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The floor. See the header: below it, booking or the deposit fails later. */
export const MIN_SERVICE_PRICE = 5;

/** Capacity of `professional_services.price_amount` — `decimal(10,2)`. */
export const MAX_SERVICE_PRICE = 99_999_999.99;

/** Capacity of the int4 duration column — not a business ceiling. */
export const MAX_DURATION_MINUTES = 2_147_483_647;

/** Frozen — the only model this slice exposes. */
export const SERVICE_PRICING_MODEL = 'FLAT';

/** Frozen — never a field, never read from the request. */
export const SERVICE_CURRENCY = 'CAD';

export const PRICE_BELOW_MINIMUM_MESSAGE = 'Le prix doit être d’au moins 5 $.';

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

export type PriceParse =
  | { kind: 'ok'; amount: number }
  | { kind: 'invalid'; message: string };

/**
 * REQUIRED. Accepts the comma as the Québec decimal separator and spaces
 * (non-breaking included) as thousands separators; two decimals at most — the
 * `decimal(10,2)` column would ROUND a third one rather than refuse it.
 *
 * ⚠️ TWIN of `parseBudget` in `lib/service-requests/tender-rules.ts` (same
 * regex, same normalisation). It cannot be imported from here (this module
 * imports nothing, see the header), so the two must be kept in step by hand:
 * a separator accepted by one and refused by the other would read as a bug.
 * They differ ON PURPOSE in what follows the parse — a budget is optional and
 * only has to be positive, a service price is required and has a 5 $ floor.
 */
export function parsePrice(raw: string): PriceParse {
  const compact = raw.replace(/[\s  ]/g, '');
  if (compact === '') return { kind: 'invalid', message: 'Veuillez indiquer un prix.' };
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(compact)) {
    return {
      kind: 'invalid',
      message: 'Le prix doit être un montant en dollars, avec deux décimales au plus.',
    };
  }
  const amount = Number(compact.replace(',', '.'));
  if (!Number.isFinite(amount)) {
    return {
      kind: 'invalid',
      message: 'Le prix doit être un montant en dollars, avec deux décimales au plus.',
    };
  }
  if (amount < MIN_SERVICE_PRICE) return { kind: 'invalid', message: PRICE_BELOW_MINIMUM_MESSAGE };
  if (amount > MAX_SERVICE_PRICE) {
    return { kind: 'invalid', message: 'Ce prix est trop élevé.' };
  }
  return { kind: 'ok', amount };
}

/** Whether a NUMBER is an acceptable price — the relays' version of the floor. */
export function isValidPriceAmount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_SERVICE_PRICE &&
    value <= MAX_SERVICE_PRICE &&
    // Two decimals at most. Checked on the shortest decimal rendering of the
    // number rather than on `value * 100`, whose float error grows with the
    // magnitude. Within [5, 1e8) `String()` never switches to exponent form.
    /^\d+(?:\.\d{1,2})?$/.test(String(value))
  );
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

export type DurationParse =
  | { kind: 'empty' }
  | { kind: 'ok'; minutes: number }
  | { kind: 'invalid'; message: string };

/**
 * Optional. Hours and minutes are two whole-number fields; an empty one counts
 * as 0 as long as the other is filled. BOTH empty → `empty`, and the caller
 * omits the key (creation) or clears the column (edit).
 *
 * An explicit « 0 h 0 min » is refused rather than read as « no duration »:
 * the person typed something, and quietly dropping it would surprise them.
 */
export function parseDuration(hoursRaw: string, minutesRaw: string): DurationParse {
  const h = hoursRaw.trim();
  const m = minutesRaw.trim();
  if (h === '' && m === '') return { kind: 'empty' };

  if ((h !== '' && !/^\d+$/.test(h)) || (m !== '' && !/^\d+$/.test(m))) {
    return {
      kind: 'invalid',
      message: 'La durée doit être indiquée en heures et en minutes entières.',
    };
  }

  const hours = h === '' ? 0 : Number(h);
  const minutes = m === '' ? 0 : Number(m);
  if (minutes > 59) {
    return { kind: 'invalid', message: 'Les minutes doivent être comprises entre 0 et 59.' };
  }

  const total = hours * 60 + minutes;
  if (total === 0) {
    return {
      kind: 'invalid',
      message: 'La durée doit être d’au moins une minute. Laissez les deux champs vides pour ne pas l’indiquer.',
    };
  }
  if (!Number.isSafeInteger(total) || total > MAX_DURATION_MINUTES) {
    return { kind: 'invalid', message: 'Cette durée est trop longue.' };
  }
  return { kind: 'ok', minutes: total };
}

/** Pre-fill for the edit form: 105 → { hours: '1', minutes: '45' }; null → both empty. */
export function durationToFields(minutes: number | null): { hours: string; minutes: string } {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) {
    return { hours: '', minutes: '' };
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { hours: h > 0 ? String(h) : '', minutes: m > 0 ? String(m) : '' };
}

/** Description: trimmed; empty → `null` (never `''`). */
export function normalizeDescription(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type ServicePricingModel = 'FLAT' | 'HOURLY' | 'QUOTE_ONLY';

/**
 * « 40,00 $ », « 40,00 $ / h », « Sur devis ». Non-FLAT services can exist
 * (seed, direct API calls) and are shown honestly rather than coerced.
 */
export function formatServicePrice(
  amount: number | null,
  currency: string,
  model: ServicePricingModel,
): string {
  if (model === 'QUOTE_ONLY' || amount === null) return 'Sur devis';
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amount);
  } catch {
    // Unknown ISO 4217 code — degrade to the raw pair rather than crash.
    formatted = `${amount} ${currency}`;
  }
  return model === 'HOURLY' ? `${formatted} / h` : formatted;
}

/** « 45 min », « 1 h », « 1 h 30 »; null → null (the line is then omitted). */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// HTTP status → FR copy (lock 3.12b: by status ALONE, the body is never read)
// ---------------------------------------------------------------------------

export const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';

/**
 * One table for create / edit / toggle / delete. The statuses the API can
 * actually send (`ProviderServicesService`):
 *   - 409 `ProviderServiceConflictException` — a non-deleted service already
 *     uses this catalogue item on this trade. `existsActive` counts DISABLED
 *     services too, hence the second sentence.
 *   - 422 `ServiceItemNotApprovedException` / `ServiceItemNotInCategoryException`
 *     — the status cannot tell them apart, and both mean the same thing to the
 *     provider: the item left the catalogue between render and submit.
 *   - 404 — trade claim, catalogue item or service gone.
 */
export function serviceMessageForStatus(status: number): string {
  switch (status) {
    case 409:
      return 'Ce service est déjà offert pour ce métier. S’il est désactivé, réactivez-le dans la liste.';
    case 422:
      return 'Ce service n’est plus offert dans le catalogue. Veuillez actualiser la page.';
    case 404:
      return 'Ce service ou ce métier n’existe plus. Veuillez actualiser la page.';
    case 403:
      return 'Vous n’êtes pas autorisé à modifier ce profil prestataire.';
    case 400:
      return 'Certaines informations sont invalides. Veuillez vérifier votre saisie.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

// ---------------------------------------------------------------------------
// Relay bodies — assembled FIELD BY FIELD, never spread
// ---------------------------------------------------------------------------
//
// The API runs `ValidationPipe({ forbidNonWhitelisted: true })`: one stray key
// slipped in by a caller would 400 the whole request. More importantly, the
// frozen fields (model, currency) must not be steerable from the browser.
// Anything not named below is DROPPED, never forwarded.

export interface CreateServiceBody {
  serviceItemId: string;
  pricingModel: 'FLAT';
  priceAmount: number;
  priceCurrency: 'CAD';
  estimatedDurationMinutes?: number;
  descriptionOverride?: string;
}

/**
 * The PATCH body. `null` is meaningful for duration and description: it CLEARS
 * the column (`@IsOptional` lets it through, the repository writes it).
 * `priceAmount` is NEVER `null` — on a FLAT/HOURLY service the API would 400
 * it, and nothing on screen offers to remove a price.
 */
export interface UpdateServiceBody {
  priceAmount?: number;
  estimatedDurationMinutes?: number | null;
  descriptionOverride?: string | null;
  isActive?: boolean;
}

export type Assembly<T> = { ok: true; body: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDurationMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_DURATION_MINUTES
  );
}

/** Body of `POST /api/service-providers/{p}/categories/{psc}/services`. */
export function assembleCreateServiceBody(incoming: unknown): Assembly<CreateServiceBody> {
  if (!isRecord(incoming)) return { ok: false };
  const { serviceItemId, priceAmount, estimatedDurationMinutes, descriptionOverride } = incoming;

  if (typeof serviceItemId !== 'string' || serviceItemId === '') return { ok: false };
  if (!isValidPriceAmount(priceAmount)) return { ok: false };

  const body: CreateServiceBody = {
    serviceItemId,
    pricingModel: SERVICE_PRICING_MODEL,
    priceAmount,
    priceCurrency: SERVICE_CURRENCY,
  };

  if (estimatedDurationMinutes !== undefined && estimatedDurationMinutes !== null) {
    if (!isDurationMinutes(estimatedDurationMinutes)) return { ok: false };
    body.estimatedDurationMinutes = estimatedDurationMinutes;
  }

  if (descriptionOverride !== undefined && descriptionOverride !== null) {
    if (typeof descriptionOverride !== 'string') return { ok: false };
    const description = normalizeDescription(descriptionOverride);
    // On creation an empty description is simply absent.
    if (description !== null) body.descriptionOverride = description;
  }

  return { ok: true, body };
}

/** Body of `PATCH /api/service-providers/{p}/services/{id}`. */
export function assembleUpdateServiceBody(incoming: unknown): Assembly<UpdateServiceBody> {
  if (!isRecord(incoming)) return { ok: false };
  const body: UpdateServiceBody = {};

  if ('priceAmount' in incoming) {
    // `null` included: never forwarded (see `UpdateServiceBody`).
    if (!isValidPriceAmount(incoming.priceAmount)) return { ok: false };
    body.priceAmount = incoming.priceAmount;
  }

  if ('estimatedDurationMinutes' in incoming) {
    const value = incoming.estimatedDurationMinutes;
    if (value === null) body.estimatedDurationMinutes = null;
    else if (isDurationMinutes(value)) body.estimatedDurationMinutes = value;
    else return { ok: false };
  }

  if ('descriptionOverride' in incoming) {
    const value = incoming.descriptionOverride;
    if (value === null) body.descriptionOverride = null;
    // A blanked description is sent as `null`, never `''`.
    else if (typeof value === 'string') body.descriptionOverride = normalizeDescription(value);
    else return { ok: false };
  }

  if ('isActive' in incoming) {
    if (typeof incoming.isActive !== 'boolean') return { ok: false };
    body.isActive = incoming.isActive;
  }

  // An empty PATCH is not a request anyone meant to send.
  if (Object.keys(body).length === 0) return { ok: false };
  return { ok: true, body };
}

// ---------------------------------------------------------------------------
// Catalogue selection
// ---------------------------------------------------------------------------

/**
 * The add form only offers catalogue items NOT YET offered on this trade.
 * « Offered » = any NON-DELETED service, disabled ones included: that is what
 * the API's `existsActive` checks, so re-adding a disabled item would 409 —
 * the provider is meant to reactivate it instead.
 */
export function itemsNotYetOffered<T extends { id: string }>(
  catalogueItems: readonly T[],
  servicesOnTrade: readonly { serviceItemId: string }[],
): T[] {
  const taken = new Set(servicesOnTrade.map((service) => service.serviceItemId));
  return catalogueItems.filter((item) => !taken.has(item.id));
}
