/**
 * Where a provider is, as far as everyone but the provider is concerned: the
 * CENTRE OF A FIXED GRID CELL, never the base itself. CLAUDE.md §13.1, entry 22.
 *
 * ⚠️ NOTHING THAT ANSWERS A SEARCH MAY READ THE EXACT BASE. Every answer
 * discovery gives — whether a provider appears, how far it says they are, and
 * in which order — is a function of the point it was computed from. Computed
 * from the exact base, each of them is an oracle: three distances trilaterate
 * the base; the edge of a coarsened distance step sits at a known exact
 * distance from it; the edge of the service radius too. Computed from the cell
 * centre, they can only ever reveal the cell, which the response already shows.
 * So `service_base_location` is read in exactly ONE place below,
 * {@link PROVIDER_CELL_CENTRE_SQL}, and every reader goes through it.
 *
 * ⚠️ DO NOT « REFINE » THESE VALUES LATER. The 0.005° × 0.0073° cell, the 100 m
 * and 500 m steps and the 100 m floor are the privacy property itself. A
 * smaller cell is the leak coming back one decimal at a time.
 *
 * The accepted cost: the service circle is drawn around the cell centre, so it
 * is shifted by at most half the cell's diagonal (≈ 390 m) from the true base.
 * A client right at the edge may be shown — or not — a provider that a
 * metre-exact circle would have decided the other way.
 *
 * ⚠️ THIS IS THE ONLY SOURCE. The rule lives in SQL because matching, sorting
 * and pagination are SQL; a TypeScript copy would be a second rule free to
 * drift. `src/database/probes/discovery-privacy.probe.ts` evaluates these
 * exact fragments against Postgres.
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
 * Never 0. « 0 m » would say « the search point is in the provider's cell, at
 * its centre » more sharply than the cell itself does.
 */
export const DISCOVERY_DISTANCE_FLOOR_M = 100;

/** Grid cell height, in degrees of latitude (≈ 555 m). */
export const DISCOVERY_GRID_LAT_DEG = '0.005' as const;
/** Grid cell width, in degrees of longitude (≈ 555 m at 46.8° N). */
export const DISCOVERY_GRID_LNG_DEG = '0.0073' as const;

/** The candidate provider's exact base, as degrees. Read ONLY by the cell. */
export const BASE_LAT_FROM_PROVIDER =
  'ST_Y(sp.service_base_location::geometry)' as const;
export const BASE_LNG_FROM_PROVIDER =
  'ST_X(sp.service_base_location::geometry)' as const;
/** Bound parameters, for the probe that evaluates the fragment on literals. */
export const BASE_LAT_FROM_PARAM = '$1::double precision' as const;
export const BASE_LNG_FROM_PARAM = '$2::double precision' as const;

export type BaseLatExpr =
  | typeof BASE_LAT_FROM_PROVIDER
  | typeof BASE_LAT_FROM_PARAM;
export type BaseLngExpr =
  | typeof BASE_LNG_FROM_PROVIDER
  | typeof BASE_LNG_FROM_PARAM;

/**
 * Centre of the fixed grid cell holding the coordinate, in degrees.
 * Deterministic — the same base gives the same cell on every request, so
 * repeating a search averages nothing out (random noise would). `FLOOR` handles
 * negative longitudes correctly (cell [-71.2772, -71.2699) for -71.2746).
 * NULL in → NULL out.
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

const PROVIDER_CELL = gridCentreSql(BASE_LAT_FROM_PROVIDER, BASE_LNG_FROM_PROVIDER);

/**
 * THE provider's position for every search answer: the centre of its cell, as
 * geography (so `ST_DWithin` / `ST_Distance` read metres, not degrees). Alias
 * contract: the candidate provider row is `sp`. This is the one expression in
 * the codebase that turns `sp.service_base_location` into something a search
 * may use — the non-regression spec fails if the base appears anywhere else in
 * a discovery query.
 */
export const PROVIDER_CELL_CENTRE_SQL =
  `ST_SetSRID(ST_MakePoint(${PROVIDER_CELL.lng}, ${PROVIDER_CELL.lat}), 4326)::geography`;

/** The discovery subquery's cell→search-point distance column. */
export const CELL_DISTANCE_FROM_SUBQUERY = 'e.cell_distance_m' as const;
/** A bound parameter, for the probe. */
export const CELL_DISTANCE_FROM_PARAM = '$1::double precision' as const;

export type CellDistanceExpr =
  | typeof CELL_DISTANCE_FROM_SUBQUERY
  | typeof CELL_DISTANCE_FROM_PARAM;

/**
 * Coarsened distance, in metres (integer): 100 m steps under 1 km, 500 m steps
 * from 1 km, never below 100. Applied to the CELL distance — the steps would
 * otherwise be a staircase of the exact distance, whose edges sit at known
 * distances from the base. Rounds half away from zero (numeric `ROUND`), so
 * 1 249 → 1 000 and 1 251 → 1 500 on every host.
 */
export function roundedDistanceSql(distance: CellDistanceExpr): string {
  return `GREATEST(
      ${DISCOVERY_DISTANCE_FLOOR_M},
      CASE
        WHEN ${distance} < ${DISCOVERY_DISTANCE_THRESHOLD_M}
          THEN ROUND((${distance})::numeric / ${DISCOVERY_DISTANCE_SMALL_STEP_M}) * ${DISCOVERY_DISTANCE_SMALL_STEP_M}
        ELSE ROUND((${distance})::numeric / ${DISCOVERY_DISTANCE_LARGE_STEP_M}) * ${DISCOVERY_DISTANCE_LARGE_STEP_M}
      END
    )::int`;
}
