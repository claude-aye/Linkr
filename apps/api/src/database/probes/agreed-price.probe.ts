/**
 * Probe: the agreed price (`agreedAmount` / `agreedCurrency`), against a real
 * Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database
 * that has been migrated):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_agreedprice_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/agreed-price.probe.ts
 *
 * Same stance as `received-quotes.probe.ts`: it runs the SHIPPED code — the
 * repository queries (the LATERAL join is SQL, no mock can prove it) and the
 * real `ServiceRequestsService` mappers on top of them. To exercise a mutation,
 * edit the repository or the rule and re-run: ts-node compiles from source.
 *
 * Refuses to run unless the database name contains "probe"; cleans up after
 * itself (hard DELETE of its own fixtures in a scratch database only).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { ServiceRequest } from '../../modules/service-requests/entities/service-request.entity';
import { ServiceRequestRepository } from '../../modules/service-requests/repositories/service-request.repository';
import { ServiceRequestsService } from '../../modules/service-requests/service-requests.service';

const TAG = '[probe-agreed-price]';

// ── Fixture identifiers ────────────────────────────────────────────────────
const U_CLIENT = 'aaaaaaa5-0000-4000-8000-000000000001';
const U_PRO1 = 'aaaaaaa5-0000-4000-8000-000000000002';
const U_PRO2 = 'aaaaaaa5-0000-4000-8000-000000000003';
const CAT = 'eeeeeee5-0000-4000-8000-000000000001';
const P1 = 'ccccccc5-0000-4000-8000-000000000001'; // the retained provider
const P2 = 'ccccccc5-0000-4000-8000-000000000002'; // the loser

const R = {
  TENDER_ACCEPTED: 'fffffff5-0000-4000-8000-000000000001',
  DIRECT_ACCEPTED: 'fffffff5-0000-4000-8000-000000000002',
  TENDER_OPEN: 'fffffff5-0000-4000-8000-000000000003',
  DIRECT_OPEN: 'fffffff5-0000-4000-8000-000000000004',
  TENDER_ANOMALY: 'fffffff5-0000-4000-8000-000000000005',
  TENDER_CANCELLED: 'fffffff5-0000-4000-8000-000000000006',
  TENDER_USD: 'fffffff5-0000-4000-8000-000000000007',
} as const;

const Q = {
  ACC_WITHDRAWN: '99999995-0000-4000-8000-000000000001', // P1's older, withdrawn offer
  ACC_WON: '99999995-0000-4000-8000-000000000002', // P1's ACCEPTED offer
  ACC_LOST: '99999995-0000-4000-8000-000000000003', // P2's REJECTED offer
  OPEN_SUBMITTED: '99999995-0000-4000-8000-000000000004',
  CANCELLED_WON: '99999995-0000-4000-8000-000000000005',
  USD_WON: '99999995-0000-4000-8000-000000000006',
} as const;

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

const point = (lng: number, lat: number): string =>
  `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

async function wipe(ds: DataSource): Promise<void> {
  const requests = Object.values(R);
  await ds.query(`DELETE FROM quotes WHERE service_request_id = ANY($1::uuid[])`, [requests]);
  await ds.query(`DELETE FROM service_requests WHERE id = ANY($1::uuid[])`, [requests]);
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [[P1, P2]]);
  await ds.query(`DELETE FROM service_categories WHERE id = $1`, [CAT]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_CLIENT, U_PRO1, U_PRO2]]);
}

async function seed(ds: DataSource): Promise<void> {
  const user = (id: string, email: string, first: string) =>
    ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, $3, 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email, first],
    );
  await user(U_CLIENT, 'probe-ap-client@linkr.test', 'Client');
  await user(U_PRO1, 'probe-ap-pro1@linkr.test', 'Pro1');
  await user(U_PRO2, 'probe-ap-pro2@linkr.test', 'Pro2');

  await ds.query(
    `INSERT INTO service_categories
       (id, slug, name_translations, description_translations, icon_url,
        regulation_level, is_active, sort_order)
     VALUES ($1, 'probe-ap-trade', '{"fr-CA":"Métier sonde"}'::jsonb, '{}'::jsonb, '',
             'INFORMAL', true, 0)`,
    [CAT],
  );

  for (const [id, userId, name] of [
    [P1, U_PRO1, 'Probe Pro 1'],
    [P2, U_PRO2, 'Probe Pro 2'],
  ]) {
    await ds.query(
      `INSERT INTO service_providers
         (id, provider_type, user_id, organization_id, business_name, headline, bio,
          service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, NULL, $3, '', '',
               ${point(-71.29, 46.81)}::geography, 25, true, now())`,
      [id, userId, name],
    );
  }

  const request = (
    id: string,
    type: string,
    status: string,
    opts: {
      assigned?: string;
      requested?: string;
      accepted?: boolean;
      cancelled?: boolean;
      estimated: [string, string];
    },
  ) =>
    ds.query(
      `INSERT INTO service_requests
         (id, client_user_id, request_type, status, service_category_id,
          requested_service_provider_id, assigned_service_provider_id,
          title, description, service_address, service_location,
          service_location_precision, estimated_amount, estimated_currency,
          quotes_deadline_utc, response_deadline_utc, accepted_at_utc,
          cancelled_at_utc, cancelled_by_user_id)
       VALUES ($1, $2, $3::service_request_type, $4, $5, $6, $7,
               $8, 'Probe fixture.', '1 rue Probe',
               ${point(-71.21, 46.81)}::geometry, 'GEOCODED', $9, $10,
               CASE WHEN $3::text = 'PROJECT_TENDER' THEN now() + interval '3 days' END,
               CASE WHEN $3::text = 'DIRECT_BOOKING' THEN now() + interval '1 day' END,
               CASE WHEN $11 THEN now() END,
               CASE WHEN $12 THEN now() END,
               CASE WHEN $12 THEN $2::uuid END)`,
      [
        id,
        U_CLIENT,
        type,
        status,
        CAT,
        opts.requested ?? null,
        opts.assigned ?? null,
        `${TAG} ${id.slice(-4)}`,
        opts.estimated[0],
        opts.estimated[1],
        opts.accepted ?? false,
        opts.cancelled ?? false,
      ],
    );

  // The tender's estimated_amount is the client's indicative BUDGET (1500) —
  // deliberately far from every quote, so returning it by mistake cannot pass.
  await request(R.TENDER_ACCEPTED, 'PROJECT_TENDER', 'ASSIGNED', {
    assigned: P1, accepted: true, estimated: ['1500.00', 'CAD'],
  });
  await request(R.DIRECT_ACCEPTED, 'DIRECT_BOOKING', 'ASSIGNED', {
    assigned: P1, requested: P1, accepted: true, estimated: ['90.00', 'CAD'],
  });
  await request(R.TENDER_OPEN, 'PROJECT_TENDER', 'OPEN', { estimated: ['1500.00', 'CAD'] });
  await request(R.DIRECT_OPEN, 'DIRECT_BOOKING', 'OPEN', {
    requested: P1, estimated: ['90.00', 'CAD'],
  });
  await request(R.TENDER_ANOMALY, 'PROJECT_TENDER', 'ASSIGNED', {
    assigned: P1, accepted: true, estimated: ['1500.00', 'CAD'],
  });
  await request(R.TENDER_CANCELLED, 'PROJECT_TENDER', 'CANCELLED', {
    assigned: P1, accepted: true, cancelled: true, estimated: ['1500.00', 'CAD'],
  });
  await request(R.TENDER_USD, 'PROJECT_TENDER', 'ASSIGNED', {
    assigned: P1, accepted: true, estimated: ['1500.00', 'CAD'],
  });

  const quote = (
    id: string,
    requestId: string,
    provider: string,
    amount: string,
    currency: string,
    status: string,
    minutesAgo: number,
  ) =>
    ds.query(
      `INSERT INTO quotes
         (id, service_request_id, service_provider_id, amount, currency,
          estimated_duration_minutes, description, status, valid_until_utc,
          created_at_utc)
       VALUES ($1, $2, $3, $4, $5, 90, 'Probe quote.', $6, now() + interval '5 days',
               now() - make_interval(mins => $7))`,
      [id, requestId, provider, amount, currency, status, minutesAgo],
    );
  await quote(Q.ACC_WITHDRAWN, R.TENDER_ACCEPTED, P1, '800.00', 'CAD', 'WITHDRAWN', 300);
  await quote(Q.ACC_LOST, R.TENDER_ACCEPTED, P2, '999.00', 'CAD', 'REJECTED', 200);
  await quote(Q.ACC_WON, R.TENDER_ACCEPTED, P1, '250.00', 'CAD', 'ACCEPTED', 100);
  await quote(Q.OPEN_SUBMITTED, R.TENDER_OPEN, P2, '300.00', 'CAD', 'SUBMITTED', 50);
  await quote(Q.CANCELLED_WON, R.TENDER_CANCELLED, P1, '410.00', 'CAD', 'ACCEPTED', 50);
  // A quote in its own currency: the pair must come from the QUOTE, not the request.
  await quote(Q.USD_WON, R.TENDER_USD, P1, '175.50', 'USD', 'ACCEPTED', 50);
  // R.TENDER_ANOMALY: assigned and accepted, and NO ACCEPTED quote at all.
}

async function main(): Promise<void> {
  const name = assertScratchDatabase(process.env.DATABASE_URL);
  console.log(`${TAG} database: ${name}\n`);

  let statements = 0;
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [__dirname + '/../../modules/**/*.entity.{ts,js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: ['query', 'error'],
    logger: {
      logQuery: () => {
        statements += 1;
      },
      logQueryError: (e: string | Error) => console.error(e),
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    },
  });
  await ds.initialize();

  try {
    await wipe(ds);
    await seed(ds);

    const repo = new ServiceRequestRepository(ds.getRepository(ServiceRequest));
    const service = new ServiceRequestsService(
      repo,
      {} as never,
      {} as never,
      { findById: async () => ({ systemRole: 'USER' }) } as never,
      {} as never,
      {} as never,
      { getOrThrow: () => 72 } as unknown as ConfigService,
      {} as never,
    );

    const warnings: string[] = [];
    const spy = (Logger.prototype.warn = function (message: unknown): void {
      warnings.push(String(message));
    });
    void spy;

    // ── Client side ────────────────────────────────────────────────────────
    const listed = await service.list(U_CLIENT, { page: 1, limit: 50 } as never);
    const byId = new Map(listed.items.map((i) => [i.id, i]));
    const pair = (id: string): unknown => [
      byId.get(id)?.agreedAmount,
      byId.get(id)?.agreedCurrency,
    ];

    console.log('A. GET /service-requests (client list)');
    check('every fixture is listed', listed.items.length, Object.keys(R).length);
    check('accepted TENDER → the ACCEPTED quote (250), NOT the 1500 budget', pair(R.TENDER_ACCEPTED), ['250.00', 'CAD']);
    check('… and its estimatedAmount is untouched', byId.get(R.TENDER_ACCEPTED)?.estimatedAmount, '1500.00');
    check('accepted DIRECT_BOOKING → its own estimate', pair(R.DIRECT_ACCEPTED), ['90.00', 'CAD']);
    check('OPEN tender (with a SUBMITTED quote) → null', pair(R.TENDER_OPEN), [null, null]);
    check('OPEN direct booking → null', pair(R.DIRECT_OPEN), [null, null]);
    check('accepted tender with NO ACCEPTED quote → null (budget is no fallback)', pair(R.TENDER_ANOMALY), [null, null]);
    check('cancelled AFTER acceptance keeps the price it was accepted at', pair(R.TENDER_CANCELLED), ['410.00', 'CAD']);
    check('currency comes from the QUOTE (USD), not the request (CAD)', pair(R.TENDER_USD), ['175.50', 'USD']);
    check('a WITHDRAWN / REJECTED quote is never picked', [pair(R.TENDER_ACCEPTED)], [['250.00', 'CAD']]);
    check('total is coherent with the page', listed.total, listed.items.length);

    console.log('\nB. GET /service-requests/:id');
    const one = await service.findById(R.TENDER_ACCEPTED, U_CLIENT);
    check('findById on the accepted tender', [one.agreedAmount, one.agreedCurrency], ['250.00', 'CAD']);
    const openOne = await service.findById(R.TENDER_OPEN, U_CLIENT);
    check('findById on the OPEN tender', [openOne.agreedAmount, openOne.agreedCurrency], [null, null]);

    console.log('\nC. One statement per page, whatever its size');
    statements = 0;
    await service.list(U_CLIENT, { page: 1, limit: 50 } as never);
    const full = statements;
    statements = 0;
    await service.list(U_CLIENT, { page: 1, limit: 1 } as never);
    const single = statements;
    check('COUNT + page = 2 statements for 7 rows', full, 2);
    check('… and 2 statements for 1 row (no per-row query)', single, 2);

    // ── Provider side ──────────────────────────────────────────────────────
    console.log('\nD. GET /service-providers/:id/service-requests (JobCard)');
    const jobs = await service.listForProvider(P1, { page: 1, limit: 50 } as never);
    const jobById = new Map(jobs.items.map((i) => [i.id, i]));
    const jobPair = (id: string): unknown => [
      jobById.get(id)?.agreedAmount,
      jobById.get(id)?.agreedCurrency,
    ];
    check('the retained provider sees the QUOTE amount on the tender job', jobPair(R.TENDER_ACCEPTED), ['250.00', 'CAD']);
    check('… and the estimate on a direct job', jobPair(R.DIRECT_ACCEPTED), ['90.00', 'CAD']);
    check('a targeted OPEN direct booking → null', jobPair(R.DIRECT_OPEN), [null, null]);
    check('currency from the quote on the provider side too', jobPair(R.TENDER_USD), ['175.50', 'USD']);
    check('accepted tender without a quote → null on the provider side', jobPair(R.TENDER_ANOMALY), [null, null]);
    check('the loser sees no job at all', (await service.listForProvider(P2, { page: 1, limit: 50 } as never)).items.length, 0);
    statements = 0;
    await service.listForProvider(P1, { page: 1, limit: 50 } as never);
    check('provider list: COUNT + page = 2 statements', statements, 2);
    check('provider total matches its items', jobs.total, jobs.items.length);

    console.log('\nE. D4 — the anomaly is served AND logged (id only)');
    const anomalyWarnings = warnings.filter((w) => w.includes(R.TENDER_ANOMALY));
    check('the anomalous tender was warned about', anomalyWarnings.length >= 1, true);
    check(
      'no warning names any OTHER fixture',
      warnings.filter((w) => !w.includes(R.TENDER_ANOMALY)).length,
      0,
    );
    check(
      'the message carries the id and no title / client / amount',
      anomalyWarnings.every((w) => !w.includes('probe-agreed') && !w.includes(U_CLIENT) && !w.includes('1500')),
      true,
    );
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(`\n${TAG} ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
