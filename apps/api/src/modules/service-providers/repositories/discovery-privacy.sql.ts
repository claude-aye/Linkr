/**
 * What `discover` is allowed to say about WHERE a provider is — the coarsened
 * distance and the grid cell of their base. CLAUDE.md §13.1, entry 22.
 *
 * ⚠️ THE EXACT DISTANCE NEVER LEAVES THE QUERY. An exact base→client distance,
 * read from three search points, places the provider's base — usually their
 * home — by trilateration. So the exact value exists only inside the discovery
 * subquery; the projection, the ORDER BY and therefore the DTO only ever see the
 * coarsened value built here. Not in a record, not in a log line.
 *
 * ⚠️ DO NOT « REFINE » THESE VALUES LATER. Every step below (100 m, 500 m, the
 * 100 m floor, the 0.005° × 0.0073° cell) is the privacy property itself. A
 * finer tier or a smaller cell is not a UX improvement, it is the leak coming
 * back one decimal at a time.
 *
 * ⚠️ THIS IS THE ONLY SOURCE. Rounding lives in SQL because the ORDER BY needs
 * it (pagination is in SQL); a TypeScript copy for the DTO would be a second
 * rule free to drift from the one that sorts. The probe
 * `src/database/probes/discovery-privacy.probe.ts` evaluates these exact
 * fragments against Postgres.
 *
 * Like `eligibility.sql.ts`, every argument is a compile-time LITERAL union —
 * a plain `string` (any request value) does not compile.
 */

/** Below this distance the step is {@link DISCOVERY_DISTANCE_SMALL_STEP_M}. */
export const DISCOVERY_DISTANCE_THRESHOLD_M = 1000;
/** Step under 1 km: 100 m. */
export const DISCOVERY_DISTANCE_SMALL_STEP_M = 100;
/** Step from 1 km: 500 m. */
export const DISCOVERY_DISTANCE_LARGE_STEP_M = 500;
/**
 * Never 0. « 0 m » would say « the search point IS the base »: one search on
 * an address confirms it is the provider's.
 */
export const DISCOVERY_DISTANCE_FLOOR_M = 100;

/** Grid cell height, in degrees of latitude (≈ 555 m). */
export const DISCOVERY_GRID_LAT_DEG = '0.005' as const;
/** Grid cell width, in degrees of longitude (≈ 555 m at 46.8° N). */
export const DISCOVERY_GRID_LNG_DEG = '0.0073' as const;

/** The discovery subquery's exact distance column — never projected out. */
export const EXACT_DISTANCE_FROM_SUBQUERY = 'e.exact_distance_m' as const;
/** A bound parameter, for the probe that evaluates the fragment on literals. */
export const EXACT_DISTANCE_FROM_PARAM = '$1::double precision' as const;

export type ExactDistanceExpr =
  | typeof EXACT_DISTANCE_FROM_SUBQUERY
  | typeof EXACT_DISTANCE_FROM_PARAM;

/** The discovery subquery's base coordinates (degrees). */
export const BASE_LAT_FROM_SUBQUERY = 'e.base_lat' as const;
export const BASE_LNG_FROM_SUBQUERY = 'e.base_lng' as const;
/** Bound parameters, for the probe. */
export const BASE_LAT_FROM_PARAM = '$1::double precision' as const;
export const BASE_LNG_FROM_PARAM = '$2::double precision' as const;

export type BaseLatExpr =
  | typeof BASE_LAT_FROM_SUBQUERY
  | typeof BASE_LAT_FROM_PARAM;
export type BaseLngExpr =
  | typeof BASE_LNG_FROM_SUBQUERY
  | typeof BASE_LNG_FROM_PARAM;

/**
 * Coarsened distance, in metres (integer): 100 m steps under 1 km, 500 m steps
 * from 1 km, never below 100. Rounds half away from zero (numeric `ROUND`, not
 * the platform-dependent double-precision one), so 1 249 → 1 000 and
 * 1 251 → 1 500 on every host.
 */
export function roundedDistanceSql(exact: ExactDistanceExpr): string {
  return `GREATEST(
      ${DISCOVERY_DISTANCE_FLOOR_M},
      CASE
        WHEN ${exact} < ${DISCOVERY_DISTANCE_THRESHOLD_M}
          THEN ROUND((${exact})::numeric / ${DISCOVERY_DISTANCE_SMALL_STEP_M}) * ${DISCOVERY_DISTANCE_SMALL_STEP_M}
        ELSE ROUND((${exact})::numeric / ${DISCOVERY_DISTANCE_LARGE_STEP_M}) * ${DISCOVERY_DISTANCE_LARGE_STEP_M}
      END
    )::int`;
}

/**
 * Centre of the fixed grid cell holding the coordinate. Deterministic — the
 * same base gives the same cell on every request, so repeating a search
 * averages nothing out (random noise would). `FLOOR` handles negative
 * longitudes correctly (cell [-71.2772, -71.2699) for -71.2746). NULL in →
 * NULL out.
 */
export function gridCentreSql(
  lat: BaseLatExpr,
  lng: BaseLngExpr,
): { lat: string; lng: string } {
  return {
    lat: `((FLOOR((${lat})::numeric / ${DISCOVERY_GRID_LAT_DEG}) + 0.5) * ${DISCOVERY_GRID_LAT_DEG})::double precision`,
    lng: `((FLOOR((${lng})::numeric / ${DISCOVERY_GRID_LNG_DEG}) + 0.5) * ${DISCOVERY_GRID_LNG_DEG})::double precision`,
  };
}
