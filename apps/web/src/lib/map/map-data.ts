/**
 * Pure helpers for the `/recherche` results map (R2b).
 *
 * ⚠️ THIS MODULE IMPORTS NOTHING, BY CONTRACT: `node --test` loads it as is (the
 * `web-tests` job installs nothing), and the map island imports it. Types are
 * declared here structurally rather than imported from the generated client.
 *
 * Privacy (CLAUDE.md §13.1 nº 22): the only provider position this module ever
 * sees is `approximateLocation`, the centre of the provider's grid cell, which
 * the API already serves. Nothing here may accept, derive or display a base.
 */

/** The fields of a discovered provider the map reads. Nothing else. */
export interface MappableProvider {
  id: string;
  approximateLocation: { lat: number; lng: number } | null;
}

export interface ProviderPointFeature {
  type: 'Feature';
  id: string;
  properties: { id: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface ProviderFeatureCollection {
  type: 'FeatureCollection';
  features: ProviderPointFeature[];
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One GeoJSON point per provider that HAS an approximate location.
 *
 * ⚠️ GeoJSON is `[longitude, latitude]` — longitude FIRST. Swapping them would
 * put Quebec in Antarctica.
 *
 * A provider with `approximateLocation: null` (or a non-finite coordinate) is
 * left OUT of the map, never placed at a default point: it stays in the list,
 * which is the primary way to reach every result.
 *
 * Providers of the same grid cell share the exact same coordinate on purpose
 * (they are clustered by the map, never spread apart).
 */
export function buildProviderFeatureCollection(
  providers: readonly MappableProvider[],
): ProviderFeatureCollection {
  const features: ProviderPointFeature[] = [];
  for (const provider of providers) {
    const location = provider.approximateLocation;
    if (!location || !isFiniteCoordinate(location.lat) || !isFiniteCoordinate(location.lng)) {
      continue;
    }
    features.push({
      type: 'Feature',
      id: provider.id,
      properties: { id: provider.id },
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Why the map is replaced by the « Carte indisponible » frame, or null. */
export type MapFallbackReason = 'missing-key' | 'no-webgl' | 'load-error';

/**
 * Decides before loading anything. A missing key never loads `maplibre-gl` at
 * all (no chunk, no request); no WebGL means the library could not draw.
 * `load-error` is raised later, by the map itself.
 */
export function mapFallbackReason(
  key: string | undefined | null,
  hasWebGL: boolean,
): MapFallbackReason | null {
  if (typeof key !== 'string' || key.trim() === '') return 'missing-key';
  if (!hasWebGL) return 'no-webgl';
  return null;
}

export const MAPTILER_HOST = 'api.maptiler.com';

/**
 * Adds the MapTiler key to a request URL at runtime — the versioned style file
 * NEVER contains it. Only `https://api.maptiler.com/…` URLs receive the key;
 * any other URL is returned untouched, so the key can never leak to another
 * host. A URL that already carries a `key` parameter keeps its own.
 */
export function withMapTilerKey(url: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'https:' || parsed.host !== MAPTILER_HOST) return url;
  if (parsed.searchParams.has('key')) return url;
  // `{fontstack}`/`{range}` and `{z}/{x}/{y}` placeholders must survive: append
  // the parameter as text instead of re-serialising the URL (which would
  // percent-encode the braces).
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}key=${encodeURIComponent(key)}`;
}

export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Bounds enclosing the searched point and every mapped provider, or null when
 * there is nothing finite to frame. Used once, to frame the first view.
 */
export function boundsFor(
  points: ReadonlyArray<readonly [number, number]>,
): LngLatBounds | null {
  let bounds: LngLatBounds | null = null;
  for (const [lng, lat] of points) {
    if (!isFiniteCoordinate(lng) || !isFiniteCoordinate(lat)) continue;
    if (!bounds) {
      bounds = { west: lng, south: lat, east: lng, north: lat };
      continue;
    }
    bounds.west = Math.min(bounds.west, lng);
    bounds.east = Math.max(bounds.east, lng);
    bounds.south = Math.min(bounds.south, lat);
    bounds.north = Math.max(bounds.north, lat);
  }
  return bounds;
}

/** DOM id of a result card, shared by the list and the map. */
export function resultElementId(providerId: string): string {
  return `resultat-${providerId}`;
}
