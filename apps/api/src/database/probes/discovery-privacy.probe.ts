/**
 * Probe: provider-location privacy in `discover` (CLAUDE.md §13.1, entry 22),
 * evaluated against a REAL Postgres + PostGIS.
 *
 * Invocation (from apps/api, DATABASE_URL on a SCRATCH, fully-migrated database
 * whose name contains `probe`):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_discoveryprivacy_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/discovery-privacy.probe.ts
 *
 * Why a probe and not jest: the rounding and the grid are SQL (the ORDER BY
 * needs them), and no mock can prove a `ROUND` or a `FLOOR`. Part A evaluates
 * the SHIPPED fragments (`discovery-privacy.sql.ts`) on literal inputs; part B
 * runs the SHIPPED `findEligibleForDiscovery` on seeded providers. Neither
 * re-types the SQL.
 *
 * Exits non-zero on the first failed check.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { ServiceProvider } from '../../modules/service-providers/entities/service-provider.entity';
import {
  BASE_LAT_FROM_PARAM,
  BASE_LNG_FROM_PARAM,
  CELL_DISTANCE_FROM_PARAM,
  gridCentreSql,
  PROVIDER_CELL_CENTRE_SQL,
  roundedDistanceSql,
} from '../../modules/service-providers/repositories/discovery-privacy.sql';
import { ServiceProviderRepository } from '../../modules/service-providers/repositories/service-provider.repository';

const U_A = 'aaaaaaa7-0000-4000-8000-000000000001';
const U_B = 'aaaaaaa7-0000-4000-8000-000000000002';
const P_A = 'ccccccc7-0000-4000-8000-000000000001';
const P_B = 'ccccccc7-0000-4000-8000-000000000002';
const CATEGORY = 'eeeeeee7-0000-4000-8000-000000000001';

/** Dana's real base in the dev database — 7 decimals, a geocoded address. */
const BASE: [number, number] = [-71.2745765, 46.7786612];

let failures = 0;
function check(label: string, ok: boolean, detail: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${JSON.stringify(detail)}`);
  if (!ok) failures++;
}

async function rounded(ds: DataSource, metres: number): Promise<number> {
  const rows: Array<{ v: number }> = await ds.query(
    `SELECT ${roundedDistanceSql(CELL_DISTANCE_FROM_PARAM)} AS v`,
    [metres],
  );
  return rows[0].v;
}

async function cell(
  ds: DataSource,
  lat: number | null,
  lng: number | null,
): Promise<{ lat: number | null; lng: number | null }> {
  const g = gridCentreSql(BASE_LAT_FROM_PARAM, BASE_LNG_FROM_PARAM);
  const rows: Array<{ lat: number | null; lng: number | null }> = await ds.query(
    `SELECT ${g.lat} AS lat, ${g.lng} AS lng`,
    [lat, lng],
  );
  return rows[0];
}

const near = (a: number | null, b: number): boolean =>
  a !== null && Math.abs(a - b) < 1e-9;

async function partA(ds: DataSource): Promise<void> {
  const tiers: Array<[number, number]> = [
    [0, 100],
    [49, 100],
    [149, 100],
    [150, 200],
    [851, 900],
    [949, 900],
    [951, 1000],
    [999.9, 1000],
    [1000, 1000],
    [1249, 1000],
    [1250, 1500],
    [1251, 1500],
    [12_345, 12_500],
  ];
  for (const [input, expected] of tiers) {
    const got = await rounded(ds, input);
    check(`tier ${input} m → ${expected} m`, got === expected, { got });
  }

  // Cell centres, both hemispheres of sign, and the boundaries of one cell.
  const centre = await cell(ds, BASE[1], BASE[0]);
  check('Dana base → its cell centre', near(centre.lat, 46.7775) && near(centre.lng, -71.27355), centre);
  check('cell centre ≠ exact base', centre.lat !== BASE[1] && centre.lng !== BASE[0], centre);

  // Dana's cell: lat [46.775, 46.780), lng [-71.2772, -71.2699).
  const lowEdge = await cell(ds, 46.775, -71.2772);
  check('lower cell edge belongs to the cell', near(lowEdge.lat, 46.7775) && near(lowEdge.lng, -71.27355), lowEdge);
  const justUnderTop = await cell(ds, 46.7799999, -71.2699001);
  check('just under the top edge stays in the cell', near(justUnderTop.lat, 46.7775) && near(justUnderTop.lng, -71.27355), justUnderTop);
  const top = await cell(ds, 46.78, -71.2699);
  check('top edge opens the next cell', near(top.lat, 46.7825) && near(top.lng, -71.26625), top);

  const south = await cell(ds, -33.8688, 151.2093);
  check('negative latitude / positive longitude', near(south.lat, -33.8675) && near(south.lng, 151.20855), south);

  const nul = await cell(ds, null, null);
  check('NULL base → NULL cell', nul.lat === null && nul.lng === null, nul);
}

async function wipe(ds: DataSource): Promise<void> {
  await ds.query(
    `DELETE FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`,
    [[P_A, P_B]],
  );
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [[P_A, P_B]]);
  await ds.query(`DELETE FROM service_categories WHERE id = $1`, [CATEGORY]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_A, U_B]]);
}

async function seed(ds: DataSource): Promise<void> {
  for (const [u, n] of [[U_A, 'a'], [U_B, 'b']]) {
    await ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Privacy', 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [u, `privacy-probe-${n}@linkr.test`],
    );
  }
  await ds.query(
    `INSERT INTO service_categories (id, slug, name_translations, description_translations,
                                     icon_url, regulation_level, is_active, sort_order)
     VALUES ($1, 'privacy-probe', '{"fr-CA":"Sonde"}', '{}', '', 'INFORMAL', true, 99)`,
    [CATEGORY],
  );
  // B sits ~37 m north-east of A, IN THE SAME CELL. From the north-east search
  // point below B is EXACTLY closer, so any answer read from the exact base
  // would tell them apart. Swapping their bases must change nothing.
  const bases: Array<[string, string, [number, number]]> = [
    [P_A, U_A, BASE],
    [P_B, U_B, [BASE[0] + 0.0004, BASE[1] + 0.0002]],
  ];
  for (const [p, u, [lng, lat]] of bases) {
    await ds.query(
      `INSERT INTO service_providers (id, provider_type, user_id, business_name,
         service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, $3,
         ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 25, true, now())`,
      [p, u, `Privacy ${p.slice(-1)}`, lng, lat],
    );
    await ds.query(
      `INSERT INTO professional_service_categories (service_provider_id, service_category_id,
         verification_status, requested_at_utc, is_active)
       VALUES ($1, $2, 'NOT_REQUIRED', now(), true)`,
      [p, CATEGORY],
    );
  }
}

async function partB(ds: DataSource): Promise<void> {
  const repo = new ServiceProviderRepository(ds.getRepository(ServiceProvider));
  const at = (lng: number, lat: number) =>
    repo.findEligibleForDiscovery({ lng, lat, categoryId: CATEGORY, page: 1, limit: 20 });

  // A search ON the exact base is measured from the cell centre like any other
  // point: it reports the rounded cell→base distance, never 0, and nothing that
  // singles the base out. Only a search on the CELL CENTRE hits the floor.
  const [raw] = await ds.query(
    `SELECT ST_Distance(${PROVIDER_CELL_CENTRE_SQL},
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS m
       FROM service_providers sp WHERE sp.id = $3`,
    [BASE[0], BASE[1], P_A],
  );
  const [cellToBase] = await ds.query(
    `SELECT ${roundedDistanceSql(CELL_DISTANCE_FROM_PARAM)} AS d`,
    [Number(raw.m)],
  );
  const onBase = await at(BASE[0], BASE[1]);
  const a = onBase.items.find((i) => i.id === P_A);
  check(
    'search ON the base → rounded cell→base distance, never 0',
    a?.distanceMeters === Number(cellToBase.d) && a?.distanceMeters !== 0,
    { got: a?.distanceMeters, cellToBase: Number(cellToBase.d) },
  );
  check('total agrees with items (anti false positive)', onBase.total === 2 && onBase.items.length === 2, onBase.total);

  const centre = a?.approximateLocation;
  if (centre) {
    const onCentre = await at(centre.lng, centre.lat);
    const ac = onCentre.items.find((i) => i.id === P_A);
    check('search ON the cell centre → 100 m (floor), never 0', ac?.distanceMeters === 100, ac?.distanceMeters);
  } else {
    check('search ON the cell centre → 100 m (floor), never 0', false, 'no approximateLocation');
  }

  // Three search points around A: same cell every time, never the exact base.
  const points: Array<[number, number]> = [
    [BASE[0] + 0.01, BASE[1]],
    [BASE[0], BASE[1] + 0.012],
    [BASE[0] - 0.02, BASE[1] - 0.008],
  ];
  const cells: string[] = [];
  for (const [lng, lat] of points) {
    const r = await at(lng, lat);
    const item = r.items.find((i) => i.id === P_A);
    cells.push(JSON.stringify(item?.approximateLocation));
    const d = item?.distanceMeters ?? -1;
    const onStep = d < 1000 ? d % 100 === 0 : d % 500 === 0;
    check(`distance from (${lng.toFixed(4)}, ${lat.toFixed(4)}) is on a step`, onStep && d >= 100, d);
  }
  check('approximateLocation identical from 3 points', new Set(cells).size === 1, cells[0]);
  check(
    'approximateLocation ≠ exact base',
    cells[0] !== JSON.stringify({ lat: BASE[1], lng: BASE[0] }),
    cells[0],
  );

  // Same cell ⇒ same distance, and the id breaks the tie. From this point B is
  // EXACTLY closer, which the control proves, so an exact-distance sort would
  // have put B first.
  const NE: [number, number] = [BASE[0] + 0.02, BASE[1] + 0.01];
  const ne = await at(NE[0], NE[1]);
  const order = ne.items.map((i) => `${i.id.slice(-1)}:${i.distanceMeters}`);
  const exact: Array<{ id: string; d: number }> = await ds.query(
    `SELECT sp.id, ST_Distance(sp.service_base_location,
              ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS d
       FROM service_providers sp WHERE sp.id = ANY($3::uuid[])`,
    [NE[0], NE[1], [P_A, P_B]],
  );
  const bIsCloser =
    exact.find((r) => r.id === P_B)!.d < exact.find((r) => r.id === P_A)!.d;
  const sameDistance = ne.items[0]?.distanceMeters === ne.items[1]?.distanceMeters;
  check('control: B is exactly closer, same reported distance', bIsCloser && sameDistance, { order, exact });
  check('tie broken by id (A first), not by exact distance', ne.items[0]?.id === P_A, order);

  // ── The radius is drawn around the CELL, not the base ────────────────────
  // EDGE_IN_BASE: 24 950 m from A's exact base, beyond 25 km from its cell.
  // EDGE_IN_CELL: 24 950 m from A's cell, beyond 25 km from its exact base.
  // An exact-base circle would answer the opposite on each.
  const edges: Array<{ lat: number; lng: number; base_m: number; cell_m: number }> = await ds.query(
    `WITH a AS (SELECT service_base_location AS base, ${PROVIDER_CELL_CENTRE_SQL} AS cell
                  FROM service_providers sp WHERE sp.id = $1),
          p AS (SELECT ST_Project(a.base, 24950, ST_Azimuth(a.cell, a.base))::geography AS pt FROM a
                UNION ALL
                SELECT ST_Project(a.cell, 24950, ST_Azimuth(a.base, a.cell))::geography FROM a)
     SELECT ST_Y(p.pt::geometry) AS lat, ST_X(p.pt::geometry) AS lng,
            ST_Distance(a.base, p.pt) AS base_m, ST_Distance(a.cell, p.pt) AS cell_m
       FROM p, a`,
    [P_A],
  );
  const [edgeInBase, edgeInCell] = edges;
  check(
    'control: edge points straddle the two circles',
    edgeInBase.base_m < 25000 && edgeInBase.cell_m > 25000 &&
      edgeInCell.base_m > 25000 && edgeInCell.cell_m < 25000,
    edges.map((e) => ({ base_m: Math.round(e.base_m), cell_m: Math.round(e.cell_m) })),
  );
  const atEdgeBase = await at(edgeInBase.lng, edgeInBase.lat);
  check('inside the exact circle but outside the cell circle → A absent', !atEdgeBase.items.some((i) => i.id === P_A), atEdgeBase.total);
  const atEdgeCell = await at(edgeInCell.lng, edgeInCell.lat);
  check('inside the cell circle but outside the exact circle → A present', atEdgeCell.items.some((i) => i.id === P_A), atEdgeCell.total);

  // ── discover never reads the exact base: swap A's and B's bases ──────────
  // Same cell, different exact points. Presence, distance, pin and order must
  // be byte-identical before and after the swap, from every search point.
  const searchPoints: Array<[number, number]> = [
    BASE, ...points, NE,
    [edgeInBase.lng, edgeInBase.lat],
    [edgeInCell.lng, edgeInCell.lat],
  ];
  const snapshot = async (): Promise<string> =>
    JSON.stringify(await Promise.all(searchPoints.map(([lng, lat]) => at(lng, lat))));
  const before = await snapshot();
  await ds.query(
    `UPDATE service_providers sp
        SET service_base_location = o.service_base_location
       FROM service_providers o
      WHERE (sp.id, o.id) IN (($1::uuid, $2::uuid), ($2::uuid, $1::uuid))`,
    [P_A, P_B],
  );
  const swapped: Array<{ id: string; lng: number }> = await ds.query(
    `SELECT id, ST_X(service_base_location::geometry) AS lng FROM service_providers
      WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [[P_A, P_B]],
  );
  check('control: the swap really moved A onto B\'s base', near(swapped[0].lng, BASE[0] + 0.0004), swapped);
  const after = await snapshot();
  check(`discover identical after swapping exact bases (${searchPoints.length} points)`, before === after, before === after ? 'same' : { before, after });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/probe/.test(url.split('/').pop() ?? '')) {
    throw new Error('Refusing to run: DATABASE_URL must point at a scratch *probe* database.');
  }
  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [__dirname + '/../../modules/**/*.entity.{ts,js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: ['error'],
  });
  await ds.initialize();
  try {
    await partA(ds);
    await wipe(ds);
    await seed(ds);
    await partB(ds);
  } finally {
    await wipe(ds);
    await ds.destroy();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
