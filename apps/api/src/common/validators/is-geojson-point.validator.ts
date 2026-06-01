import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validates a GeoJSON Point: { type: "Point", coordinates: [lng, lat] }.
 *
 * ⚠️ GeoJSON ORDER IS [longitude, latitude] — the reverse of the intuitive
 * "lat, lng". This is the #1 source of geo bugs. lng ∈ [-180,180], lat ∈ [-90,90].
 */
export function isGeoJSONPoint(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== 'Point') return false;
  if (!Array.isArray(v.coordinates) || v.coordinates.length !== 2) return false;
  const [lng, lat] = v.coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;
  return true;
}

export function IsGeoJSONPoint(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGeoJSONPoint',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a GeoJSON Point { type: "Point", coordinates: [lng, lat] } with lng∈[-180,180], lat∈[-90,90]`,
        ...options,
      },
      validator: {
        validate: (value: unknown): boolean => isGeoJSONPoint(value),
      },
    });
  };
}
