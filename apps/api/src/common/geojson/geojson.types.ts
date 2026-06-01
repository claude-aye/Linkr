/**
 * Minimal GeoJSON types used across the API.
 * ⚠️ Positions are [longitude, latitude] — the GeoJSON standard order.
 */
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: Array<Array<[number, number]>>;
}
