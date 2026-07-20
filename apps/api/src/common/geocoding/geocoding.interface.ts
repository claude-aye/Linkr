/** Injection token for the active geocoding adapter. */
export const GEOCODING_SERVICE = 'GEOCODING_SERVICE';

/**
 * A single geocoding candidate. `lat`/`lng` are WGS84 decimal degrees — the
 * exact shape `GET /service-providers/discover` already consumes from the URL
 * (`?lat=&lng=`), so a candidate can feed discovery with zero transformation.
 */
export interface GeocodeCandidate {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Port for forward geocoding (address text → coordinate candidates). Adapters:
 * NominatimGeocodingAdapter (OpenStreetMap). Replaceable behind this seam
 * (Mapbox / Google would be a new adapter, never a rewrite).
 */
export interface IGeocodingService {
  /** Returns up to `limit` candidates for `query`; empty array when none match. */
  geocode(query: string, limit: number): Promise<GeocodeCandidate[]>;
}
