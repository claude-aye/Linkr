/**
 * Where a service request's coordinate came from.
 *
 * The values name the coordinate's PROVENANCE, not its metric accuracy —
 * `GEOCODED` does not mean *exact*. Nominatim asked for "Laval, Quebec"
 * answers with a city centroid: geocoded, yet kilometres away from the actual
 * service address. Capturing true granularity would mean persisting the
 * `class`/`type`/`addresstype` of the Nominatim response, which is stored
 * nowhere (tracked as debt in CLAUDE.md §6).
 */
export enum ServiceRequestLocationPrecision {
  /** The client typed an address, it was geocoded, and they picked a candidate. */
  GEOCODED = 'GEOCODED',
  /** Fallback: the coordinates of the area the client was searching in. */
  SEARCH_AREA = 'SEARCH_AREA',
  /** Last resort (fixed Quebec placeholder), or simply never stated. */
  UNKNOWN = 'UNKNOWN',
}
