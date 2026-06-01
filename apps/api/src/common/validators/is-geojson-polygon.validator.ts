import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validates a GeoJSON Polygon: { type: "Polygon", coordinates: [ ring, ... ] }.
 *
 * ⚠️ GeoJSON ORDER IS [longitude, latitude] — the reverse of "lat, lng".
 *
 * Each ring is an array of [lng, lat] positions; a ring must be CLOSED
 * (first position === last position) and contain ≥ 4 positions. Every
 * coordinate must be within lng∈[-180,180], lat∈[-90,90].
 *
 * Note: this validates structural well-formedness only. Geometric validity
 * (self-intersection, etc.) is enforced at the DB layer via ST_IsValid.
 */
function isValidPosition(pos: unknown): pos is [number, number] {
  if (!Array.isArray(pos) || pos.length !== 2) return false;
  const [lng, lat] = pos;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function isClosedRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  if (!ring.every(isValidPosition)) return false;
  const first = ring[0] as [number, number];
  const last = ring[ring.length - 1] as [number, number];
  return first[0] === last[0] && first[1] === last[1];
}

export function isGeoJSONPolygon(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== 'Polygon') return false;
  if (!Array.isArray(v.coordinates) || v.coordinates.length === 0) return false;
  return v.coordinates.every(isClosedRing);
}

export function IsGeoJSONPolygon(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGeoJSONPolygon',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a GeoJSON Polygon with closed rings of ≥4 [lng, lat] positions within valid bounds`,
        ...options,
      },
      validator: {
        validate: (value: unknown): boolean => isGeoJSONPolygon(value),
      },
    });
  };
}
