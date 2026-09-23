/**
 * Probe: the tender feed's membership truth table, against a real Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_tenderfeed_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/tender-feed.probe.ts
 *
 * ⚠️ WHY THIS IS A NODE PROBE AND NOT A .sql FILE — a deliberate deviation.
 * The rule under test is a correlated EXISTS over three tables, two PostGIS
 * predicates and a LATERAL. Re-typing that query into a .sql file would test a
 * COPY of it: the copy would pass while the shipped query regressed, which is
 * the one failure mode a probe exists to prevent. So this goes through
 * `ServiceRequestRepository.findOpenTendersForProvider` itself. To exercise a
 * mutation, edit the repository, `pnpm --filter @linkr/api build` is NOT needed
 * (ts-node compiles from source), and re-run.
 *
 * ⚠️ IT REFUSES TO RUN ON A DATABASE IT WAS NOT POINTED AT ON PURPOSE. The seed
 * below writes rows and deletes them again; running it against a working
 * database would be destructive in a way that is tedious to undo. The database
 * name must therefore contain "probe" — see `assertScratchDatabase`.
 *
 * It cleans up after itself (hard DELETE of its own rows only — these are
 * fixtures in a scratch database, not user data, so the soft-delete rule of
 * CLAUDE.md §13 does not apply), and is idempotent: a second run starts by
 * removing what the first one left.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { ServiceRequest } from '../../modules/service-requests/entities/service-request.entity';
import { ServiceRequestRepository } from '../../modules/service-requests/repositories/service-request.repository';
import { ProviderTenderItemDto } from '../../modules/service-requests/dto/provider-tender-item.dto';
import { ServiceProvider } from '../../modules/service-providers/entities/service-provider.entity';
import { ServiceProviderRepository } from '../../modules/service-providers/repositories/service-provider.repository';

// ── Fixture identifiers ────────────────────────────────────────────────────
// Fixed UUIDs so a re-run can delete exactly what it created, and so a failure
// report names a row the reader can go and look at.
const TAG = '[probe-tender-feed]';

const U_PRO = 'aaaaaaa1-0000-4000-8000-000000000001';
const U_CLIENT = 'aaaaaaa1-0000-4000-8000-000000000002';
const ORG = 'bbbbbbb1-0000-4000-8000-000000000001';
const P_IND = 'ccccccc1-0000-4000-8000-000000000001';
const P_ORG = 'ccccccc1-0000-4000-8000-000000000002';
const ZONE = 'ddddddd1-0000-4000-8000-000000000001';

const C_MATCH = 'eeeeeee1-0000-4000-8000-000000000001'; // claimed, NOT_REQUIRED
const C_OTHER = 'eeeeeee1-0000-4000-8000-000000000002'; // never claimed
const C_PENDING = 'eeeeeee1-0000-4000-8000-000000000003'; // claimed, PENDING

const T = {
  RADIUS: 'fffffff1-0000-4000-8000-000000000001',
  ZONE: 'fffffff1-0000-4000-8000-000000000002',
  FAR: 'fffffff1-0000-4000-8000-000000000003',
  OTHER_CAT: 'fffffff1-0000-4000-8000-000000000004',
  PENDING_CAT: 'fffffff1-0000-4000-8000-000000000005',
  DEADLINE_PAST: 'fffffff1-0000-4000-8000-000000000006',
  OWN: 'fffffff1-0000-4000-8000-000000000007',
  DIRECT: 'fffffff1-0000-4000-8000-000000000008',
  SEARCH_AREA: 'fffffff1-0000-4000-8000-000000000009',
  QUOTED: 'fffffff1-0000-4000-8000-00000000000a',
} as const;

const Q_WITHDRAWN = '99999991-0000-4000-8000-000000000001';
const Q_SUBMITTED = '99999991-0000-4000-8000-000000000002';

// Québec City. The provider's base and, give or take a few hundred metres,
// every tender that is supposed to match on radius.
const BASE: [number, number] = [-71.21, 46.81];
const NEARBY: [number, number] = [-71.22, 46.81]; // ≈ 760 m from BASE
const IN_ZONE: [number, number] = [-73.75, 45.55]; // Laval — ≈ 250 km away
const TORONTO: [number, number] = [-79.38, 43.65];

const RADIUS_KM = 10;

// ── Tiny assertion harness ─────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

function assertScratchDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set.');
  const name = url.split('/').pop() ?? '';
  if (!name.includes('probe')) {
    throw new Error(
      `Refusing to run: "${name}" does not look like a scratch database. ` +
        'Point DATABASE_URL at a database whose name contains "probe".',
    );
  }
  return name;
}

// ── Seed ───────────────────────────────────────────────────────────────────
const point = ([lng, lat]: [number, number]): string =>
  `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

async function wipe(ds: DataSource): Promise<void> {
  // Children first: every FK in this domain is ON DELETE RESTRICT.
  await ds.query(`DELETE FROM quotes WHERE id = ANY($1::uuid[])`, [
    [Q_WITHDRAWN, Q_SUBMITTED],
  ]);
  await ds.query(`DELETE FROM service_requests WHERE id = ANY($1::uuid[])`, [
    Object.values(T),
  ]);
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
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    [U_PRO, U_CLIENT],
  ]);
}

async function seed(ds: DataSource): Promise<void> {
  for (const [id, email, first] of [
    [U_PRO, 'probe-pro@linkr.test', 'Pro'],
    [U_CLIENT, 'probe-client@linkr.test', 'Client'],
  ]) {
    await ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, $3, 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email, first],
    );
  }

  await ds.query(
    `INSERT INTO organizations
       (id, legal_name, display_name, slug, description, legal_address,
        country_code, subdivision_code, billing_email, is_active)
     VALUES ($1, 'Probe Org Inc.', 'Probe Org', 'probe-org-tender-feed',
             'Fixture.', '1 rue Probe', 'CA', 'CA-QC', 'probe@linkr.test', true)`,
    [ORG],
  );

  for (const [id, slug, label] of [
    [C_MATCH, 'probe-match', 'Métier couvert'],
    [C_OTHER, 'probe-other', 'Métier non revendiqué'],
    [C_PENDING, 'probe-pending', 'Métier en attente'],
  ]) {
    await ds.query(
      `INSERT INTO service_categories
         (id, slug, name_translations, description_translations, icon_url,
          regulation_level, is_active, sort_order)
       VALUES ($1, $2, $3::jsonb, '{}'::jsonb, '', 'INFORMAL', true, 0)`,
      [id, slug, JSON.stringify({ 'fr-CA': label })],
    );
  }

  // The caller. Individual, active, 10 km radius around BASE.
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, organization_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'INDIVIDUAL', $2, NULL, 'Probe Pro', '', '',
             ${point(BASE)}::geography, ${RADIUS_KM}, true, now())`,
    [P_IND, U_PRO],
  );

  // A second caller, ORGANIZATION-owned, at the same base. `user_id` is NULL on
  // this row — which is the whole reason D4 uses IS DISTINCT FROM. Its
  // `business_name` is deliberately NULL so discovery's display-name fallback
  // has to resolve through `organizations`.
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, organization_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'ORGANIZATION', NULL, $2, NULL, '', '',
             ${point(BASE)}::geography, ${RADIUS_KM}, true, now())`,
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

  // A named zone around IN_ZONE, belonging to the INDIVIDUAL provider only.
  // ~0.05° box — far outside the 10 km radius, which is the point.
  const [zl, zt] = IN_ZONE;
  await ds.query(
    `INSERT INTO professional_service_zones
       (id, service_provider_id, zone_polygon, zone_label)
     VALUES ($1, $2,
       ST_SetSRID(ST_GeomFromText('POLYGON((${zl - 0.05} ${zt - 0.05},
         ${zl + 0.05} ${zt - 0.05}, ${zl + 0.05} ${zt + 0.05},
         ${zl - 0.05} ${zt + 0.05}, ${zl - 0.05} ${zt - 0.05}))'), 4326)::geography,
       'Probe zone')`,
    [ZONE, P_IND],
  );

  const tender = async (opts: {
    id: string;
    label: string;
    category: string;
    at: [number, number];
    client?: string;
    type?: string;
    precision?: string;
    deadlineHours?: number;
  }): Promise<void> => {
    await ds.query(
      `INSERT INTO service_requests
         (id, client_user_id, request_type, status, service_category_id,
          title, description, service_address, service_location,
          service_location_precision, quotes_deadline_utc)
       VALUES ($1, $2, $3, 'OPEN', $4, $5, 'Probe fixture.', '1 rue Probe',
               ${point(opts.at)}::geometry, $6,
               now() + make_interval(hours => $7))`,
      [
        opts.id,
        opts.client ?? U_CLIENT,
        opts.type ?? 'PROJECT_TENDER',
        opts.category,
        `${TAG} ${opts.label}`,
        opts.precision ?? 'GEOCODED',
        opts.deadlineHours ?? 72,
      ],
    );
  };

  await tender({ id: T.RADIUS, label: 'in radius', category: C_MATCH, at: NEARBY });
  await tender({ id: T.ZONE, label: 'in zone only', category: C_MATCH, at: IN_ZONE });
  await tender({ id: T.FAR, label: 'out of both', category: C_MATCH, at: TORONTO });
  await tender({ id: T.OTHER_CAT, label: 'other trade', category: C_OTHER, at: NEARBY });
  await tender({ id: T.PENDING_CAT, label: 'PENDING trade', category: C_PENDING, at: NEARBY });
  await tender({
    id: T.DEADLINE_PAST,
    label: 'deadline passed, still OPEN (R7 selection window)',
    category: C_MATCH,
    at: NEARBY,
    deadlineHours: -24,
  });
  await tender({ id: T.OWN, label: 'own tender', category: C_MATCH, at: NEARBY, client: U_PRO });
  await tender({
    id: T.DIRECT,
    label: 'DIRECT_BOOKING',
    category: C_MATCH,
    at: NEARBY,
    type: 'DIRECT_BOOKING',
  });
  await tender({
    id: T.SEARCH_AREA,
    label: 'not GEOCODED',
    category: C_MATCH,
    at: NEARBY,
    precision: 'SEARCH_AREA',
  });
  await tender({ id: T.QUOTED, label: 'quoted twice', category: C_MATCH, at: NEARBY });

  // Withdraw-then-resubmit: two rows for one (provider, tender) couple, which
  // the PARTIAL unique index allows and a naive LEFT JOIN would duplicate.
  await ds.query(
    `INSERT INTO quotes
       (id, service_request_id, service_provider_id, amount, currency,
        estimated_duration_minutes, description, status, valid_until_utc,
        created_at_utc)
     VALUES
       ($1, $3, $5, 100.00, 'CAD', 60, 'First try.', 'WITHDRAWN',
        now() + interval '5 days', now() - interval '2 hours'),
       ($2, $4, $5, 120.00, 'CAD', 60, 'Second try.', 'SUBMITTED',
        now() + interval '5 days', now() - interval '1 hour')`,
    [Q_WITHDRAWN, Q_SUBMITTED, T.QUOTED, T.QUOTED, P_IND],
  );
}

// ── Cases ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const name = assertScratchDatabase(process.env.DATABASE_URL);
  console.log(`${TAG} database: ${name}\n`);

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [__dirname + '/../../modules/**/*.entity.{ts,js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: ['error'],
  });
  await ds.initialize();

  try {
    await wipe(ds);
    await seed(ds);

    const requests = new ServiceRequestRepository(ds.getRepository(ServiceRequest));
    const providers = new ServiceProviderRepository(ds.getRepository(ServiceProvider));

    // ── A. Membership truth table, from the INDIVIDUAL provider ────────────
    console.log('A. Membership (INDIVIDUAL provider)');
    const feed = await requests.findOpenTendersForProvider(P_IND, {
      page: 1,
      limit: 50,
    });
    // Mapped through the DTO the endpoint actually returns, so the probe sees
    // the payload rather than the row behind it.
    const items = feed.items.map(ProviderTenderItemDto.from);
    const ids = items.map((i) => i.id);
    const shown = (id: string): boolean => ids.includes(id);

    check('in radius → shown', shown(T.RADIUS), true);
    check('in a named zone only → shown', shown(T.ZONE), true);
    check('outside radius and zones → hidden', shown(T.FAR), false);
    check('trade never claimed → hidden', shown(T.OTHER_CAT), false);
    check('trade claimed but PENDING → hidden', shown(T.PENDING_CAT), false);
    check(
      'deadline passed, still OPEN in the selection window → hidden',
      shown(T.DEADLINE_PAST),
      false,
    );
    check("the provider's own tender → hidden", shown(T.OWN), false);
    check('DIRECT_BOOKING → hidden', shown(T.DIRECT), false);
    check('location not GEOCODED → hidden', shown(T.SEARCH_AREA), false);

    // ── B. Withdraw-then-resubmit: ONE row, the latest status ─────────────
    console.log('\nB. Withdraw then resubmit');
    check(
      'the twice-quoted tender appears exactly once',
      ids.filter((id) => id === T.QUOTED).length,
      1,
    );
    const quoted = items.find((i) => i.id === T.QUOTED);
    check('myQuoteStatus is the LATEST quote', quoted?.myQuoteStatus, 'SUBMITTED');
    check('myQuoteId is the latest quote id', quoted?.myQuoteId, Q_SUBMITTED);
    check(
      'a tender never quoted carries nulls',
      [
        items.find((i) => i.id === T.RADIUS)?.myQuoteId,
        items.find((i) => i.id === T.RADIUS)?.myQuoteStatus,
      ],
      [null, null],
    );

    // ── C. total agrees with the rows it describes ────────────────────────
    console.log('\nC. Envelope');
    check('total equals the number of rows', feed.total, items.length);
    check('exactly the three expected tenders', [...ids].sort(), [
      T.QUOTED,
      T.RADIUS,
      T.ZONE,
    ].sort());

    // ── D. Pagination keeps total honest ──────────────────────────────────
    const paged = await requests.findOpenTendersForProvider(P_IND, {
      page: 1,
      limit: 1,
    });
    check('a capped page still reports the full total', paged.total, 3);
    check('a capped page returns one row', paged.items.length, 1);

    // ── E. ORGANIZATION provider — the IS DISTINCT FROM case ──────────────
    // `me.user_id` is NULL here. With `<>` instead, `NULL <> x` is NULL, the
    // whole WHERE fails, and this feed empties silently.
    console.log('\nE. ORGANIZATION provider (D4)');
    const orgFeed = await requests.findOpenTendersForProvider(P_ORG, {
      page: 1,
      limit: 50,
    });
    const orgItems = orgFeed.items.map(ProviderTenderItemDto.from);
    const orgIds = orgItems.map((i) => i.id).sort();
    check('an organization provider sees its matches', orgItems.length > 0, true);
    check(
      'including a tender published by another provider-owning user',
      orgIds.includes(T.OWN),
      true,
    );
    check('but not one covered only by another provider zone', orgIds.includes(T.ZONE), false);
    check(
      "and it carries no quote of the individual provider's",
      orgItems.find((i) => i.id === T.QUOTED)?.myQuoteId,
      null,
    );

    // ── F. Distance ───────────────────────────────────────────────────────
    console.log('\nF. Distance');
    // 0.01 degree of longitude at latitude 46.8 is about 760 m, which rounds UP.
    // The sub-500 m case that rounds to 0 is covered by the mapper unit test;
    // what this asserts is that the DB really measures METRES, not degrees —
    // drop the ::geography cast and this reads 0 while the zone case explodes.
    check(
      'a tender ~760 m away reports 1 km',
      items.find((i) => i.id === T.RADIUS)?.distanceKm,
      1,
    );
    const zoneKm = items.find((i) => i.id === T.ZONE)?.distanceKm ?? -1;
    check(
      'a zone-covered tender ~250 km away reports a plausible distance',
      zoneKm > 200 && zoneKm < 300,
      true,
    );

    // ── G. Geo-safety of the projection ───────────────────────────────────
    console.log('\nG. What never crosses');
    const keys = Object.keys(items[0] ?? {});
    for (const forbidden of [
      'serviceAddress',
      'serviceLocation',
      'clientUserId',
      'clientDisplayName',
    ]) {
      check(`no ${forbidden} on the item`, keys.includes(forbidden), false);
    }

    // ── H. Discovery parity (D1 non-regression) ───────────────────────────
    // Printed rather than asserted: the comparison is against main, run by
    // `src/database/probes/discovery-parity.probe.ts`.
    console.log('\nH. Discovery parity inputs (see discovery-parity.probe.ts)');
    const eligibleHere = await providers.findEligibleProviderIds(
      NEARBY[0],
      NEARBY[1],
      C_MATCH,
    );
    check(
      'both probe providers are eligible at the nearby point',
      [...eligibleHere].sort(),
      [P_IND, P_ORG].sort(),
    );
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(
    `\n${TAG} ${passed} passed, ${failures.length} failed${
      failures.length ? ':\n  - ' + failures.join('\n  - ') : ''
    }`,
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`${TAG} probe crashed:`, err);
  process.exit(1);
});
