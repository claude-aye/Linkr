/**
 * Probe: a provider's eligibility for the tender's trade, as `accept` reads it
 * and as the client's received-quotes list computes it — against a real
 * Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database
 * that has been migrated):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_quoteeligibility_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/quote-eligibility.probe.ts
 *
 * ⚠️ WHY THIS PROBE EXISTS. The predicate lives TWICE: in TypeScript
 * (`ProfessionalServiceCategoryRepository.isEligibleForCategory`, read by
 * `QuotesService.accept`) and in SQL (the `provider_eligible_for_category`
 * EXISTS of `QuoteRepository.findReceivedForRequest`). Jest mocks both, so a
 * drift between them — the list showing a live "Accept" that answers 409, or
 * the reverse — has no symptom there. This probe runs the SHIPPED code of both
 * on the same rows, case by case, and checks they agree with each other AND
 * with the expected answer. To exercise a mutation, edit either side and
 * re-run: ts-node compiles from source.
 *
 * Refuses to run unless the database name contains "probe"; cleans up after
 * itself (hard DELETE of its own fixtures in a scratch database only).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { Quote } from '../../modules/quotes/entities/quote.entity';
import { QuoteRepository } from '../../modules/quotes/repositories/quote.repository';
import { ProfessionalServiceCategory } from '../../modules/service-providers/entities/professional-service-category.entity';
import { ProfessionalServiceCategoryRepository } from '../../modules/service-providers/repositories/professional-service-category.repository';

const TAG = '[probe-quote-eligibility]';

// ── Fixture identifiers ────────────────────────────────────────────────────
const U_CLIENT = 'aaaaaaa6-0000-4000-8000-000000000001';
const CAT = 'eeeeeee6-0000-4000-8000-000000000001'; // the tender's trade
const CAT_OTHER = 'eeeeeee6-0000-4000-8000-000000000002'; // another trade
const TENDER = 'fffffff6-0000-4000-8000-000000000001';

/**
 * One provider per case, each with ONE SUBMITTED quote on the tender. `claims`
 * are the provider's rows in `professional_service_categories`.
 */
interface Case {
  label: string;
  expected: boolean;
  claims: Array<{
    category: string;
    status: 'NOT_REQUIRED' | 'VERIFIED' | 'PENDING' | 'REJECTED';
    active: boolean;
    deleted: boolean;
  }>;
}

const live = (status: Case['claims'][number]['status']) => ({
  category: CAT,
  status,
  active: true,
  deleted: false,
});

const CASES: Case[] = [
  { label: 'NOT_REQUIRED, active', expected: true, claims: [live('NOT_REQUIRED')] },
  { label: 'VERIFIED, active', expected: true, claims: [live('VERIFIED')] },
  {
    label: 'paused (is_active = false) — the PATCH path',
    expected: false,
    claims: [{ ...live('NOT_REQUIRED'), active: false }],
  },
  {
    label: 'soft-deleted — the DELETE path',
    expected: false,
    claims: [{ ...live('NOT_REQUIRED'), deleted: true }],
  },
  {
    label: 'REJECTED — the license-expiry downgrade',
    expected: false,
    claims: [live('REJECTED')],
  },
  { label: 'PENDING', expected: false, claims: [live('PENDING')] },
  {
    label: 'claim on ANOTHER trade only',
    expected: false,
    claims: [{ ...live('NOT_REQUIRED'), category: CAT_OTHER }],
  },
  // No claim of its own while every other provider holds one on CAT: proves
  // the EXISTS is correlated to THIS provider, not "someone holds the trade".
  { label: "no claim (others' claims on the trade exist)", expected: false, claims: [] },
  {
    label: 'deleted REJECTED history + a live NOT_REQUIRED claim',
    expected: true,
    claims: [{ ...live('REJECTED'), deleted: true }, live('NOT_REQUIRED')],
  },
  {
    label: 'paused AND REJECTED',
    expected: false,
    claims: [{ ...live('REJECTED'), active: false }],
  },
];

const providerId = (i: number) =>
  `ccccccc6-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const providerUserId = (i: number) =>
  `aaaaaaa6-0000-4000-8000-${String(i + 100).padStart(12, '0')}`;
const quoteId = (i: number) =>
  `99999996-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

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
  const providers = CASES.map((_, i) => providerId(i));
  const users = [U_CLIENT, ...CASES.map((_, i) => providerUserId(i))];
  await ds.query(`DELETE FROM quotes WHERE service_request_id = $1`, [TENDER]);
  await ds.query(`DELETE FROM service_requests WHERE id = $1`, [TENDER]);
  await ds.query(
    `DELETE FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`,
    [providers],
  );
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [providers]);
  await ds.query(`DELETE FROM service_categories WHERE id = ANY($1::uuid[])`, [[CAT, CAT_OTHER]]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
}

async function seed(ds: DataSource): Promise<void> {
  const user = (id: string, email: string) =>
    ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Probe', 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email],
    );
  await user(U_CLIENT, 'probe-qe-client@linkr.test');

  for (const [id, slug] of [
    [CAT, 'probe-qe-trade'],
    [CAT_OTHER, 'probe-qe-other-trade'],
  ]) {
    await ds.query(
      `INSERT INTO service_categories
         (id, slug, name_translations, description_translations, icon_url,
          regulation_level, is_active, sort_order)
       VALUES ($1, $2, '{"fr-CA":"Métier sonde"}'::jsonb, '{}'::jsonb, '',
               'INFORMAL', true, 0)`,
      [id, slug],
    );
  }

  await ds.query(
    `INSERT INTO service_requests
       (id, client_user_id, request_type, status, service_category_id,
        title, description, service_address, service_location,
        service_location_precision, quotes_deadline_utc)
     VALUES ($1, $2, 'PROJECT_TENDER', 'OPEN', $3,
             '${TAG} tender', 'Probe fixture.', '1 rue Probe',
             ${point(-71.21, 46.81)}::geometry, 'GEOCODED', now() + interval '3 days')`,
    [TENDER, U_CLIENT, CAT],
  );

  for (const [i, c] of CASES.entries()) {
    await user(providerUserId(i), `probe-qe-pro${i}@linkr.test`);
    await ds.query(
      `INSERT INTO service_providers
         (id, provider_type, user_id, organization_id, business_name, headline, bio,
          service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, NULL, $3, '', '',
               ${point(-71.29, 46.81)}::geography, 25, true, now())`,
      [providerId(i), providerUserId(i), `Probe Pro ${i}`],
    );
    // Deleted claims first: the live-claim unique index only sees live rows.
    for (const claim of [...c.claims].sort((a, b) => Number(b.deleted) - Number(a.deleted))) {
      await ds.query(
        `INSERT INTO professional_service_categories
           (service_provider_id, service_category_id, verification_status,
            requested_at_utc, is_active, deleted_at_utc)
         VALUES ($1, $2, $3, now(), $4, CASE WHEN $5 THEN now() END)`,
        [providerId(i), claim.category, claim.status, claim.active, claim.deleted],
      );
    }
    await ds.query(
      `INSERT INTO quotes
         (id, service_request_id, service_provider_id, amount, currency,
          estimated_duration_minutes, description, status, valid_until_utc,
          created_at_utc)
       VALUES ($1, $2, $3, 500.00, 'CAD', 90, 'Probe quote.', 'SUBMITTED',
               now() + interval '5 days', now() - make_interval(mins => $4))`,
      [quoteId(i), TENDER, providerId(i), 100 - i],
    );
  }
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

    const quotes = new QuoteRepository(ds.getRepository(Quote));
    const pscRepo = new ProfessionalServiceCategoryRepository(
      ds.getRepository(ProfessionalServiceCategory),
    );

    console.log('A. The list — one statement, one row per quote');
    statements = 0;
    const records = await quotes.findReceivedForRequest(TENDER);
    check('findReceivedForRequest = 1 statement (the EXISTS is inline)', statements, 1);
    check('one row per quote (no fan-out from claims)', records.length, CASES.length);
    const listed = new Map(records.map((r) => [r.serviceProviderId, r]));

    console.log('\nB. Case by case: accept read == list column == expected');
    for (const [i, c] of CASES.entries()) {
      const fromAccept = await pscRepo.isEligibleForCategory(providerId(i), CAT);
      // Same read through a manager, as `accept` makes it inside its tx.
      const fromAcceptTx = await ds.transaction((m) =>
        pscRepo.isEligibleForCategory(providerId(i), CAT, m),
      );
      const fromList = listed.get(providerId(i))?.providerEligibleForCategory;
      check(`${c.label} → ${c.expected}`, [fromAccept, fromAcceptTx, fromList], [
        c.expected,
        c.expected,
        c.expected,
      ]);
    }
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
