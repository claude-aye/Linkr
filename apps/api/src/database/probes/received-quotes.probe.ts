/**
 * Probe: the client's received-quotes list, against a real Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_receivedquotes_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/received-quotes.probe.ts
 *
 * Same stance as `tender-feed.probe.ts`: it runs the SHIPPED code — the
 * repository query, the reviews aggregate, and `ReceivedQuotesService` itself —
 * never a re-typed copy of the SQL. The only stand-in is the request lookup,
 * wired to `ServiceRequestRepository.findById`, which is exactly what
 * `ServiceRequestsService.getRequestRecord` delegates to.
 *
 * Refuses to run unless the database name contains "probe"; cleans up after
 * itself (hard DELETE of its own fixtures in a scratch database only).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { HttpException } from '@nestjs/common';

import { Quote } from '../../modules/quotes/entities/quote.entity';
import { QuoteRepository } from '../../modules/quotes/repositories/quote.repository';
import { ReceivedQuotesService } from '../../modules/quotes/received-quotes.service';
import { ServiceRequest } from '../../modules/service-requests/entities/service-request.entity';
import { ServiceRequestRepository } from '../../modules/service-requests/repositories/service-request.repository';
import { ServiceRequestsService } from '../../modules/service-requests/service-requests.service';
import { Review } from '../../modules/reviews/entities/review.entity';
import { ReviewsRepository } from '../../modules/reviews/repositories/reviews.repository';

const TAG = '[probe-received-quotes]';

// ── Fixture identifiers ────────────────────────────────────────────────────
const U_CLIENT = 'aaaaaaa3-0000-4000-8000-000000000001';
const U_STRANGER = 'aaaaaaa3-0000-4000-8000-000000000002';
const U_REVIEWER = 'aaaaaaa3-0000-4000-8000-000000000003';
// One user per INDIVIDUAL provider (user_id is unique among live providers).
const U = (n: number): string => `aaaaaaa3-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;

const ORG = 'bbbbbbb3-0000-4000-8000-000000000001';
const CAT = 'eeeeeee3-0000-4000-8000-000000000001';

const P = {
  RATED3: 'ccccccc3-0000-4000-8000-000000000001', // 3 reviews, VERIFIED, active
  RATED2: 'ccccccc3-0000-4000-8000-000000000002', // 2 reviews
  DELETED: 'ccccccc3-0000-4000-8000-000000000003', // soft-deleted provider
  PAUSED: 'ccccccc3-0000-4000-8000-000000000004', // is_active = false
  NOCLAIM: 'ccccccc3-0000-4000-8000-000000000005', // claim on the trade soft-deleted
  WITHDRAWER: 'ccccccc3-0000-4000-8000-000000000006', // only a WITHDRAWN quote
  EXPIRED: 'ccccccc3-0000-4000-8000-000000000007', // SUBMITTED but past valid_until
  REJECTED: 'ccccccc3-0000-4000-8000-000000000008', // a REJECTED quote
  ORG: 'ccccccc3-0000-4000-8000-000000000009', // ORGANIZATION, NULL business_name
} as const;

const TENDER = 'fffffff3-0000-4000-8000-000000000001';
const DIRECT = 'fffffff3-0000-4000-8000-000000000002';
const OTHERS = 'fffffff3-0000-4000-8000-000000000003'; // another client's tender
const UNKNOWN = 'fffffff3-0000-4000-8000-0000000000ff';
// Five completed requests carrying the reviews (a review needs a request).
const REVIEW_REQ = (n: number): string => `fffffff3-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;

const Q = {
  RATED3: '99999993-0000-4000-8000-000000000001',
  RATED2: '99999993-0000-4000-8000-000000000002',
  DELETED: '99999993-0000-4000-8000-000000000003',
  PAUSED: '99999993-0000-4000-8000-000000000004',
  NOCLAIM: '99999993-0000-4000-8000-000000000005',
  WITHDRAWN: '99999993-0000-4000-8000-000000000006',
  EXPIRED: '99999993-0000-4000-8000-000000000007',
  REJECTED: '99999993-0000-4000-8000-000000000008',
  ORG: '99999993-0000-4000-8000-000000000009',
} as const;

// Québec City: the tender, and every provider base within a few km of it.
const TENDER_AT: [number, number] = [-71.21, 46.81];
const NEAR: [number, number] = [-71.29, 46.81]; // ≈ 6 km west

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

const point = ([lng, lat]: [number, number]): string =>
  `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

const INDIVIDUALS = Object.entries(P).filter(([k]) => k !== 'ORG');

async function wipe(ds: DataSource): Promise<void> {
  const requests = [TENDER, DIRECT, OTHERS, ...[1, 2, 3, 4, 5].map(REVIEW_REQ)];
  await ds.query(`DELETE FROM reviews WHERE service_request_id = ANY($1::uuid[])`, [requests]);
  await ds.query(`DELETE FROM quotes WHERE id = ANY($1::uuid[])`, [Object.values(Q)]);
  await ds.query(`DELETE FROM service_requests WHERE id = ANY($1::uuid[])`, [requests]);
  await ds.query(
    `DELETE FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`,
    [Object.values(P)],
  );
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [Object.values(P)]);
  await ds.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
  await ds.query(`DELETE FROM service_categories WHERE id = $1`, [CAT]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    [U_CLIENT, U_STRANGER, U_REVIEWER, ...INDIVIDUALS.map((_, i) => U(i + 1))],
  ]);
}

async function seed(ds: DataSource): Promise<void> {
  const user = (id: string, email: string, first: string) =>
    ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, $3, 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email, first],
    );
  await user(U_CLIENT, 'probe-rq-client@linkr.test', 'Client');
  await user(U_STRANGER, 'probe-rq-stranger@linkr.test', 'Stranger');
  await user(U_REVIEWER, 'probe-rq-reviewer@linkr.test', 'Reviewer');

  await ds.query(
    `INSERT INTO service_categories
       (id, slug, name_translations, description_translations, icon_url,
        regulation_level, is_active, sort_order)
     VALUES ($1, 'probe-rq-trade', '{"fr-CA":"Métier sonde"}'::jsonb, '{}'::jsonb, '',
             'INFORMAL', true, 0)`,
    [CAT],
  );

  await ds.query(
    `INSERT INTO organizations
       (id, legal_name, display_name, slug, description, legal_address,
        country_code, subdivision_code, billing_email, is_active)
     VALUES ($1, 'Probe RQ Org Inc.', 'Probe RQ Org', 'probe-rq-org',
             'Fixture.', '1 rue Probe', 'CA', 'CA-QC', 'probe@linkr.test', true)`,
    [ORG],
  );

  for (const [i, [key, id]] of INDIVIDUALS.entries()) {
    await user(U(i + 1), `probe-rq-pro-${key.toLowerCase()}@linkr.test`, `Pro${key}`);
    await ds.query(
      `INSERT INTO service_providers
         (id, provider_type, user_id, organization_id, business_name, headline, bio,
          service_base_location, service_radius_km, is_active, activated_at_utc,
          deleted_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, NULL, $3, $4, '',
               ${point(NEAR)}::geography, 25, $5, now(), $6)`,
      [
        id,
        U(i + 1),
        `Probe ${key}`,
        `Headline ${key}`,
        key !== 'PAUSED',
        key === 'DELETED' ? new Date() : null,
      ],
    );
  }
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, organization_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'ORGANIZATION', NULL, $2, NULL, 'Org headline', '',
             ${point(NEAR)}::geography, 25, true, now())`,
    [P.ORG, ORG],
  );

  for (const [key, id] of Object.entries(P)) {
    await ds.query(
      `INSERT INTO professional_service_categories
         (service_provider_id, service_category_id, verification_status,
          requested_at_utc, is_active, deleted_at_utc)
       VALUES ($1, $2, $3, now(), true, $4)`,
      [
        id,
        CAT,
        key === 'RATED3' ? 'VERIFIED' : 'NOT_REQUIRED',
        key === 'NOCLAIM' ? new Date() : null,
      ],
    );
  }

  const request = (id: string, client: string, type: string, status: string) =>
    ds.query(
      `INSERT INTO service_requests
         (id, client_user_id, request_type, status, service_category_id,
          title, description, service_address, service_location,
          service_location_precision, quotes_deadline_utc)
       VALUES ($1, $2, $3::service_request_type, $4, $5, $6, 'Probe fixture.', '1 rue Probe',
               ${point(TENDER_AT)}::geometry, 'GEOCODED',
               CASE WHEN $3::text = 'PROJECT_TENDER' THEN now() + interval '3 days' END)`,
      [id, client, type, status, CAT, `${TAG} ${id.slice(-4)}`],
    );
  await request(TENDER, U_CLIENT, 'PROJECT_TENDER', 'OPEN');
  await request(DIRECT, U_CLIENT, 'DIRECT_BOOKING', 'OPEN');
  await request(OTHERS, U_STRANGER, 'PROJECT_TENDER', 'OPEN');

  // Reviews: 3 for RATED3 (5, 4, 4 → 4.33), 2 for RATED2 (under the threshold).
  const reviews: Array<[number, string, number]> = [
    [1, P.RATED3, 5],
    [2, P.RATED3, 4],
    [3, P.RATED3, 4],
    [4, P.RATED2, 5],
    [5, P.RATED2, 5],
  ];
  for (const [n, provider, rating] of reviews) {
    await request(REVIEW_REQ(n), U_REVIEWER, 'DIRECT_BOOKING', 'COMPLETED');
    await ds.query(
      `INSERT INTO reviews (service_request_id, service_provider_id, author_user_id, rating)
       VALUES ($1, $2, $3, $4)`,
      [REVIEW_REQ(n), provider, U_REVIEWER, rating],
    );
  }

  // Quotes. Arrival order (minutes ago) is chosen so that a pure arrival sort
  // would interleave statuses — the REJECTED one is the OLDEST, and must still
  // come after every SUBMITTED one.
  const quote = (
    id: string,
    provider: string,
    status: string,
    minutesAgo: number,
    validUntil: string = `now() + interval '5 days'`,
  ) =>
    ds.query(
      `INSERT INTO quotes
         (id, service_request_id, service_provider_id, amount, currency,
          estimated_duration_minutes, description, status, valid_until_utc,
          created_at_utc)
       VALUES ($1, $2, $3, 500.00, 'CAD', 90, 'Probe quote.', $4, ${validUntil},
               now() - make_interval(mins => $5))`,
      [id, TENDER, provider, status, minutesAgo],
    );
  await quote(Q.REJECTED, P.REJECTED, 'REJECTED', 600);
  await quote(Q.WITHDRAWN, P.WITHDRAWER, 'WITHDRAWN', 500);
  await quote(Q.RATED2, P.RATED2, 'SUBMITTED', 400);
  // Past its validity but still SUBMITTED: the hourly cron has not run yet.
  await quote(Q.EXPIRED, P.EXPIRED, 'SUBMITTED', 350, `now() - interval '1 hour'`);
  await quote(Q.DELETED, P.DELETED, 'SUBMITTED', 300);
  await quote(Q.PAUSED, P.PAUSED, 'SUBMITTED', 200);
  await quote(Q.NOCLAIM, P.NOCLAIM, 'SUBMITTED', 150);
  await quote(Q.ORG, P.ORG, 'SUBMITTED', 120);
  await quote(Q.RATED3, P.RATED3, 'SUBMITTED', 100);
}

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (err instanceof HttpException) return err.getStatus();
    throw err;
  }
}

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

    const quotes = new QuoteRepository(ds.getRepository(Quote));
    const srRepo = new ServiceRequestRepository(ds.getRepository(ServiceRequest));
    const reviews = new ReviewsRepository(ds.getRepository(Review));
    const service = new ReceivedQuotesService(
      quotes,
      { getRequestRecord: (id: string) => srRepo.findById(id) } as unknown as ServiceRequestsService,
      reviews,
    );

    const items = await service.listForClient(TENDER, U_CLIENT);
    const byId = new Map(items.map((i) => [i.id, i]));
    const ids = items.map((i) => i.id);

    console.log('A. Scope and order');
    check('WITHDRAWN is excluded', ids.includes(Q.WITHDRAWN), false);
    check('every other quote is present, SUBMITTED first then arrival', ids, [
      Q.RATED2,
      Q.EXPIRED,
      Q.DELETED,
      Q.PAUSED,
      Q.NOCLAIM,
      Q.ORG,
      Q.RATED3,
      Q.REJECTED,
    ]);

    console.log('\nB. Deleted provider — never escamoted');
    const del = byId.get(Q.DELETED);
    check('the row is present', del !== undefined, true);
    check('identity masked', [del?.displayName, del?.headline, del?.distanceKm], [null, null, null]);
    check('not acceptable', del?.acceptable, false);
    check('provider id still there', del?.serviceProviderId, P.DELETED);

    console.log('\nC. Claim on the trade');
    check('soft-deleted claim → verificationStatus null, row present', byId.get(Q.NOCLAIM)?.verificationStatus, null);
    check('live VERIFIED claim reads VERIFIED', byId.get(Q.RATED3)?.verificationStatus, 'VERIFIED');

    console.log('\nD. Rating (D-4 from the shared aggregate)');
    check('2 reviews → count 2, average null', [byId.get(Q.RATED2)?.reviewCount, byId.get(Q.RATED2)?.averageRating], [2, null]);
    check('3 reviews → count 3, average 4.33', [byId.get(Q.RATED3)?.reviewCount, byId.get(Q.RATED3)?.averageRating], [3, 4.33]);
    check('no review → count 0, average null', [byId.get(Q.PAUSED)?.reviewCount, byId.get(Q.PAUSED)?.averageRating], [0, null]);

    console.log('\nE. acceptable');
    check('SUBMITTED past valid_until (cron lag) → false', byId.get(Q.EXPIRED)?.acceptable, false);
    check('paused provider → false, identity kept', [byId.get(Q.PAUSED)?.acceptable, byId.get(Q.PAUSED)?.displayName], [false, 'Probe PAUSED']);
    check('ORGANIZATION provider → false', byId.get(Q.ORG)?.acceptable, false);
    check('REJECTED quote → false', byId.get(Q.REJECTED)?.acceptable, false);
    check('live INDIVIDUAL, valid quote → true', byId.get(Q.RATED3)?.acceptable, true);
    check('a soft-deleted claim does not block acceptance (accept never read it)', byId.get(Q.NOCLAIM)?.acceptable, true);

    console.log('\nF. Display name — one SQL source');
    check('INDIVIDUAL → business_name', byId.get(Q.RATED3)?.displayName, 'Probe RATED3');
    check('ORGANIZATION with NULL business_name → organization display_name', byId.get(Q.ORG)?.displayName, 'Probe RQ Org');

    console.log('\nG. Distance is metres, not degrees');
    const km = byId.get(Q.RATED3)?.distanceKm ?? -1;
    check('≈ 6 km between base and tender', km >= 5 && km <= 7, true);

    console.log('\nH. What never crosses');
    const keys = Object.keys(items[0] ?? {});
    for (const forbidden of ['email', 'phone', 'serviceAddress', 'serviceBaseLocation', 'userId', 'providerUserId']) {
      check(`no ${forbidden} on the item`, keys.includes(forbidden), false);
    }

    console.log('\nI. Guards 404 → 403 → 400 (real request rows)');
    check('unknown request → 404', await statusOf(service.listForClient(UNKNOWN, U_CLIENT)), 404);
    check("someone else's tender → 403", await statusOf(service.listForClient(OTHERS, U_CLIENT)), 403);
    check("stranger on the client's DIRECT_BOOKING → 403, not 400", await statusOf(service.listForClient(DIRECT, U_STRANGER)), 403);
    check('owner of a DIRECT_BOOKING → 400', await statusOf(service.listForClient(DIRECT, U_CLIENT)), 400);
    await ds.query(`UPDATE service_requests SET deleted_at_utc = now() WHERE id = $1`, [OTHERS]);
    check('soft-deleted request → 404 (even for a stranger)', await statusOf(service.listForClient(OTHERS, U_CLIENT)), 404);
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
