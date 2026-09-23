/**
 * Probe: discovery is UNCHANGED by the eligibility extraction (D1).
 *
 * Invocation (from apps/api, DATABASE_URL on a SCRATCH database):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_tenderfeed_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/discovery-parity.probe.ts
 *
 * It prints deterministic JSON and asserts nothing on its own: the assertion is
 * a DIFF between two runs of this same file — one against this branch, one
 * against `main`:
 *
 *   npx ts-node ... > /tmp/parity-branch.json
 *   git checkout main -- src/modules/service-providers/repositories/service-provider.repository.ts
 *   npx ts-node ... > /tmp/parity-main.json
 *   git checkout HEAD -- src/modules/service-providers/repositories/service-provider.repository.ts
 *   diff /tmp/parity-main.json /tmp/parity-branch.json
 *
 * ⚠️ THE ORGANIZATION PROVIDER BELOW CARRIES A NULL `business_name` ON PURPOSE.
 * The extraction moved discovery's display-name fallback off a
 * `LEFT JOIN organizations` and onto a correlated scalar subquery on the same
 * FK. A fixture whose providers all have a business name would exercise the
 * COALESCE's first branch only and would report parity it never tested.
 *
 * The probed points are chosen to cover every branch of the predicate: a point
 * inside the radius, a point covered only by a named zone, a point outside both,
 * a trade nobody claims, and a trade claimed but PENDING.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { ServiceProvider } from '../../modules/service-providers/entities/service-provider.entity';
import { ServiceProviderRepository } from '../../modules/service-providers/repositories/service-provider.repository';

const U_PRO = 'aaaaaaa2-0000-4000-8000-000000000001';
const ORG = 'bbbbbbb2-0000-4000-8000-000000000001';
const P_IND = 'ccccccc2-0000-4000-8000-000000000001';
const P_ORG = 'ccccccc2-0000-4000-8000-000000000002';
const ZONE = 'ddddddd2-0000-4000-8000-000000000001';
const C_MATCH = 'eeeeeee2-0000-4000-8000-000000000001';
const C_OTHER = 'eeeeeee2-0000-4000-8000-000000000002';
const C_PENDING = 'eeeeeee2-0000-4000-8000-000000000003';

const BASE: [number, number] = [-71.21, 46.81];
const NEARBY: [number, number] = [-71.22, 46.81];
const IN_ZONE: [number, number] = [-73.75, 45.55];
const TORONTO: [number, number] = [-79.38, 43.65];

const point = ([lng, lat]: [number, number]): string =>
  `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

async function wipe(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM professional_service_zones WHERE id = $1`, [ZONE]);
  await ds.query(
    `DELETE FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`,
    [[P_IND, P_ORG]],
  );
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [
    [P_IND, P_ORG],
  ]);
  await ds.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
  await ds.query(`DELETE FROM service_categories WHERE id = ANY($1::uuid[])`, [
    [C_MATCH, C_OTHER, C_PENDING],
  ]);
  await ds.query(`DELETE FROM users WHERE id = $1`, [U_PRO]);
}

async function seed(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO users (id, email, first_name, last_name, language_preference,
                        country_code, subdivision_code, preferred_currency)
     VALUES ($1, 'parity-pro@linkr.test', 'Parity', 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
    [U_PRO],
  );
  await ds.query(
    `INSERT INTO organizations
       (id, legal_name, display_name, slug, description, legal_address,
        country_code, subdivision_code, billing_email, is_active)
     VALUES ($1, 'Parity Org Inc.', 'Parity Org Display', 'parity-org-probe',
             'Fixture.', '1 rue Probe', 'CA', 'CA-QC', 'parity@linkr.test', true)`,
    [ORG],
  );
  for (const [id, slug] of [
    [C_MATCH, 'parity-match'],
    [C_OTHER, 'parity-other'],
    [C_PENDING, 'parity-pending'],
  ]) {
    await ds.query(
      `INSERT INTO service_categories
         (id, slug, name_translations, description_translations, icon_url,
          regulation_level, is_active, sort_order)
       VALUES ($1, $2, '{"fr-CA":"Parité"}'::jsonb, '{}'::jsonb, '', 'INFORMAL', true, 0)`,
      [id, slug],
    );
  }
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, organization_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'INDIVIDUAL', $2, NULL, 'Parity Individual', 'Headline', '',
             ${point(BASE)}::geography, 10, true, now())`,
    [P_IND, U_PRO],
  );
  // NULL business_name → the display-name fallback must resolve through
  // `organizations`. This is the row the extraction could have broken.
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, organization_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'ORGANIZATION', NULL, $2, NULL, NULL, '',
             ${point(BASE)}::geography, 10, true, now())`,
    [P_ORG, ORG],
  );
  for (const [provider, category, status] of [
    [P_IND, C_MATCH, 'NOT_REQUIRED'],
    [P_IND, C_PENDING, 'PENDING'],
    [P_ORG, C_MATCH, 'NOT_REQUIRED'],
  ]) {
    await ds.query(
      `INSERT INTO professional_service_categories
         (service_provider_id, service_category_id, verification_status,
          requested_at_utc, is_active)
       VALUES ($1, $2, $3, now(), true)`,
      [provider, category, status],
    );
  }
  const [zl, zt] = IN_ZONE;
  await ds.query(
    `INSERT INTO professional_service_zones
       (id, service_provider_id, zone_polygon, zone_label)
     VALUES ($1, $2,
       ST_SetSRID(ST_GeomFromText('POLYGON((${zl - 0.05} ${zt - 0.05},
         ${zl + 0.05} ${zt - 0.05}, ${zl + 0.05} ${zt + 0.05},
         ${zl - 0.05} ${zt + 0.05}, ${zl - 0.05} ${zt - 0.05}))'), 4326)::geography,
       'Parity zone')`,
    [ZONE, P_IND],
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || !(url.split('/').pop() ?? '').includes('probe')) {
    throw new Error('Point DATABASE_URL at a database whose name contains "probe".');
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

  const out: Record<string, unknown> = {};
  try {
    await wipe(ds);
    await seed(ds);

    const repo = new ServiceProviderRepository(ds.getRepository(ServiceProvider));

    const cases: Array<[string, [number, number], string]> = [
      ['radius/match', NEARBY, C_MATCH],
      ['zone-only/match', IN_ZONE, C_MATCH],
      ['far/match', TORONTO, C_MATCH],
      ['radius/unclaimed-trade', NEARBY, C_OTHER],
      ['radius/pending-trade', NEARBY, C_PENDING],
    ];

    for (const [label, [lng, lat], category] of cases) {
      out[`ids:${label}`] = (
        await repo.findEligibleProviderIds(lng, lat, category)
      ).sort();

      const page = await repo.findEligibleForDiscovery({
        lng,
        lat,
        categoryId: category,
        page: 1,
        limit: 20,
      });
      out[`discover:${label}`] = {
        total: page.total,
        // Sorted by id so a tie on distance cannot make the diff flap.
        items: [...page.items].sort((a, b) => a.id.localeCompare(b.id)),
      };
    }

    // Pagination path, so the COUNT branch is compared too.
    const paged = await repo.findEligibleForDiscovery({
      lng: NEARBY[0],
      lat: NEARBY[1],
      categoryId: C_MATCH,
      page: 2,
      limit: 1,
    });
    out['discover:paged(page=2,limit=1)'] = {
      total: paged.total,
      count: paged.items.length,
    };
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('parity probe crashed:', err);
  process.exit(1);
});
