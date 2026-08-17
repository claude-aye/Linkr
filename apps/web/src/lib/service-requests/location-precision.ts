import type { components } from '@linkr/api-client';

/**
 * Provenance of a service request's coordinate (Phase F).
 *
 * Derived from the GENERATED schema, never written as a local literal: the copy
 * below must stay attached to the contract, so that any change to the backend
 * enum breaks the build here rather than drifting silently. The same union
 * appears on `ProviderServiceRequestItemDto`; one alias serves both surfaces.
 */
export type ServiceLocationPrecision =
  components['schemas']['ServiceRequestResponseDto']['serviceLocationPrecision'];

/**
 * ⚠️ `GEOCODED` RENDERS NOTHING, ON PURPOSE — the silence IS the feature.
 *
 * A badge on every request would be noise; the mention is an EXCEPTION MARKER,
 * so its absence is what tells the reader the location is precise. Do not "fix"
 * this by adding a reassuring green line for GEOCODED.
 *
 * Two audiences, two vocabularies — deliberately not one shared sentence:
 *   • the client knows what they typed, so we remind them without dramatising;
 *   • the provider is going to physically travel, so the address is what they
 *     must act on.
 *
 * NEVER promise a distance or show a coordinate here. The provider DTO is
 * geo-safe (`PROVIDER_SELECT_COLUMNS` selects no geometry): that side learns
 * THAT the position is degraded and never receives the point itself.
 *
 * Note also that `GEOCODED` means the coordinate CAME FROM a geocoded address,
 * not that it is metrically exact (a city-level geocode is still GEOCODED —
 * tracked debt, CLAUDE.md §6). Hence no copy anywhere claims "exact position".
 */
const CLIENT_NOTICES: Record<ServiceLocationPrecision, string | null> = {
  GEOCODED: null,
  SEARCH_AREA:
    'Position approximative : nous avons enregistré le secteur où vous avez cherché. L’adresse que vous avez saisie a été transmise au prestataire.',
  UNKNOWN:
    'Aucune position n’a été enregistrée pour cette demande. Seule l’adresse que vous avez saisie a été transmise au prestataire.',
};

const PROVIDER_NOTICES: Record<ServiceLocationPrecision, string | null> = {
  GEOCODED: null,
  SEARCH_AREA:
    'Position approximative : elle indique le secteur où le client a cherché, pas le lieu du service. Fiez-vous à l’adresse.',
  UNKNOWN:
    'Aucune position n’est enregistrée pour cette demande. Fiez-vous à l’adresse.',
};

/**
 * Shared look for the mention, so the four call sites cannot drift apart.
 *
 * Amber for BOTH degraded values — a family already used by `STATUS_BADGES`, no
 * new colour introduced. Deliberately not amber/zinc-by-value: zinc is the
 * repo's inert tone, and UNKNOWN is the WORSE of the two states, so painting it
 * zinc would make the more degraded case the quieter one. The two states are
 * told apart by their words, not by their colour.
 */
export const LOCATION_PRECISION_NOTICE_CLASS =
  'text-xs text-amber-700 dark:text-amber-400';

/** Client-facing mention; `null` on GEOCODED (render nothing). */
export function clientLocationPrecisionNotice(
  precision: ServiceLocationPrecision,
): string | null {
  return CLIENT_NOTICES[precision];
}

/** Provider-facing mention; `null` on GEOCODED (render nothing). */
export function providerLocationPrecisionNotice(
  precision: ServiceLocationPrecision,
): string | null {
  return PROVIDER_NOTICES[precision];
}
