/**
 * How coarse a stored sector is: 2 decimal degrees.
 *
 * ⚠️ THIS NUMBER IS A PRIVACY DECISION, NOT A FORMATTING ONE. The searched point
 * must never be stored: one plumber searched at one address at one minute names a
 * person. At 2 decimals a cell is about 1.1 km north-south and about 0.76 km
 * east-west at Quebec's latitude — a neighbourhood, which is exactly the
 * granularity a recruitment map needs and the finest one that says nothing about
 * an individual.
 *
 * The database enforces the same figure independently: `demand_signals.sector_lat`
 * / `sector_lng` are `numeric(_,2)`, so the column itself cannot hold a finer
 * value. Change one and you must change the other, in the same migration.
 *
 * Nothing else in the codebase rounds coordinates — the URL, `/geocode` and
 * `discover` all carry them raw — so this is the seam where coarseness is
 * introduced, and the only one.
 */
export const SECTOR_DECIMAL_PLACES = 2;

const SECTOR_SCALE = 10 ** SECTOR_DECIMAL_PLACES;

/**
 * Snaps a WGS84 decimal degree to its sector cell.
 *
 * This is bucketing, not accounting: `Math.round` ties go toward +∞, which makes
 * a boundary coordinate land in the northern/eastern neighbour. At a 1 km cell
 * that asymmetry has no meaning, and no money depends on it — deliberately NOT
 * routed through `common/money` (integer minor units, HALF-UP), which exists for
 * amounts.
 */
export function toSector(coordinate: number): number {
  return Math.round(coordinate * SECTOR_SCALE) / SECTOR_SCALE;
}
