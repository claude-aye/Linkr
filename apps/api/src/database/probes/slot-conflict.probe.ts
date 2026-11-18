/**
 * Slot-conflict probe (CAL-3) — what only a REAL database can prove.
 *
 * jest pins the overlap rule as a pure function and mocks the repository. It
 * cannot see:
 *   1. WHOSE rows the SQL reads (this provider, not another; direct bookings,
 *      not tenders; live rows, not soft-deleted ones) and the duration it joins;
 *   2. that two clients posting the same hour at the same instant cannot both
 *      pass — only the `FOR UPDATE` on the provider row makes that true;
 *   3. that what refuses at acceptance is a CONFIRMED appointment, not another
 *      request still OPEN.
 *
 * It calls the SHIPPED repository, never a copy of its SQL.
 *
 * Run (scratch database only — it refuses any name without "probe"):
 *   DATABASE_URL=postgresql://…/linkr_cal3_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/slot-conflict.probe.ts
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { ServiceRequest } from '../../modules/service-requests/entities/service-request.entity';
import {
  CreateServiceRequestData,
  ServiceRequestRepository,
} from '../../modules/service-requests/repositories/service-request.repository';
import { ServiceRequestStatus } from '../../modules/service-requests/enums/service-request-status.enum';
import { ServiceRequestType } from '../../modules/service-requests/enums/service-request-type.enum';

const U_CLIENT = 'aaaaaab3-0000-4000-8000-000000000001';
const U_PRO = 'aaaaaab3-0000-4000-8000-000000000002';
const U_PRO2 = 'aaaaaab3-0000-4000-8000-000000000003';
const P = 'ccccccb3-0000-4000-8000-000000000001';
const P2 = 'ccccccb3-0000-4000-8000-000000000002';

const H = 60 * 60 * 1000;
const M = 60 * 1000;

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

function assertScratchDatabase(url: string | undefined): void {
  const name = (url ?? '').split('/').pop() ?? '';
  if (!name.includes('probe')) {
    throw new Error(`Refusing to run on "${name}": use a scratch database whose name contains "probe".`);
  }
}

let categoryId = '';
let itemId = '';
let pscId = '';

async function wipe(ds: DataSource): Promise<void> {
  // Hard deletes of THIS probe's own fixtures in a scratch database — the
  // soft-delete rule (§13) is about user data, not probe scaffolding.
  const ids = [[P, P2]];
  await ds.query(
    `DELETE FROM service_requests WHERE requested_service_provider_id = ANY($1::uuid[])
        OR assigned_service_provider_id = ANY($1::uuid[])`,
    ids,
  );
  await ds.query(
    `DELETE FROM professional_services WHERE professional_service_category_id IN
       (SELECT id FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[]))`,
    ids,
  );
  await ds.query(`DELETE FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`, ids);
  await ds.query(`DELETE FROM provider_time_off WHERE service_provider_id = ANY($1::uuid[])`, ids);
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, ids);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_CLIENT, U_PRO, U_PRO2]]);
}

async function seed(ds: DataSource): Promise<void> {
  const [cat] = await ds.query(
    `SELECT id FROM service_categories WHERE slug = 'coiffure' AND deleted_at_utc IS NULL`,
  );
  const [item] = await ds.query(
    `SELECT id FROM service_items WHERE service_category_id = $1 AND deleted_at_utc IS NULL ORDER BY sort_order LIMIT 1`,
    [cat.id],
  );
  categoryId = cat.id;
  itemId = item.id;
  for (const [id, email] of [
    [U_CLIENT, 'probe-slot-client@linkr.test'],
    [U_PRO, 'probe-slot-pro@linkr.test'],
    [U_PRO2, 'probe-slot-pro2@linkr.test'],
  ]) {
    await ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Probe', 'Slot', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email],
    );
  }
  for (const [id, user] of [
    [P, U_PRO],
    [P2, U_PRO2],
  ]) {
    await ds.query(
      `INSERT INTO service_providers
         (id, provider_type, user_id, business_name, headline, bio,
          service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, 'Probe', '', '',
               ST_SetSRID(ST_MakePoint(-71.21, 46.81), 4326)::geography, 25, true, now())`,
      [id, user],
    );
  }
  const [psc] = await ds.query(
    `INSERT INTO professional_service_categories
       (service_provider_id, service_category_id, verification_status, requested_at_utc, is_active)
     VALUES ($1, $2, 'NOT_REQUIRED', now(), true) RETURNING id`,
    [P, categoryId],
  );
  pscId = psc.id;
}

function bookingData(providerId: string, startMs: number, endMs: number): CreateServiceRequestData {
  return {
    clientUserId: U_CLIENT,
    requestType: ServiceRequestType.DIRECT_BOOKING,
    status: ServiceRequestStatus.OPEN,
    serviceCategoryId: categoryId,
    serviceItemId: itemId,
    requestedServiceProviderId: providerId,
    title: 'probe-slot',
    description: 'probe',
    serviceAddress: '1 rue Probe',
    serviceLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
    desiredStartAtUtc: new Date(startMs),
    desiredEndAtUtc: new Date(endMs),
    estimatedAmount: '40.00',
    estimatedCurrency: 'CAD',
    responseDeadlineUtc: new Date(startMs),
    quotesDeadlineUtc: null,
  } as CreateServiceRequestData;
}

/** Inserts WITHOUT the guard (fixture), then moves it to `status`. */
async function fixture(
  ds: DataSource,
  repo: ServiceRequestRepository,
  providerId: string,
  startMs: number,
  endMs: number,
  status: ServiceRequestStatus,
  type: ServiceRequestType = ServiceRequestType.DIRECT_BOOKING,
): Promise<string> {
  const data = bookingData(providerId, startMs, endMs);
  data.requestType = type;
  const rec = await repo.create(data);
  if (status !== ServiceRequestStatus.OPEN) {
    await ds.query(
      `UPDATE service_requests
          SET status = $2::service_request_status, assigned_service_provider_id = $3,
              accepted_at_utc = now(), scheduled_at_utc = desired_start_at_utc,
              completed_at_utc = CASE WHEN $2::text IN ('COMPLETED','PAID') THEN now() END,
              cancelled_at_utc = CASE WHEN $2::text = 'CANCELLED' THEN now() END
        WHERE id = $1`,
      [rec.id, status, providerId],
    );
  }
  return rec.id;
}

async function tryBook(repo: ServiceRequestRepository, providerId: string, startMs: number, endMs: number) {
  const r = await repo.insertDirectBookingIfSlotFree(bookingData(providerId, startMs, endMs), providerId, {
    startMs,
    endMs,
  });
  return r.inserted ? 'inserted' : r.reason;
}

async function main(): Promise<void> {
  assertScratchDatabase(process.env.DATABASE_URL);
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [__dirname + '/../../modules/**/*.entity.{ts,js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: ['error'],
  });
  await ds.initialize();
  const repo = new ServiceRequestRepository(ds.getRepository(ServiceRequest));
  // One far-future day per section, 10 h Eastern = 15 h UTC.
  const day = (n: number) => Date.parse('2027-03-01T15:00:00Z') + n * 24 * H;

  try {
    await wipe(ds);
    await seed(ds);

    console.log('A. creation against an OPEN booking (10 h – 11 h)');
    const a = day(0);
    check('first booking on a free slot', await tryBook(repo, P, a, a + H), 'inserted');
    check('same window', await tryBook(repo, P, a, a + H), 'SLOT_TAKEN');
    check('partial overlap at the start', await tryBook(repo, P, a - 0.5 * H, a + 0.5 * H), 'SLOT_TAKEN');
    check('enclosing window', await tryBook(repo, P, a - H, a + 2 * H), 'SLOT_TAKEN');
    check('inside window', await tryBook(repo, P, a + 15 * M, a + 45 * M), 'SLOT_TAKEN');
    check('touching after (11 h – 12 h)', await tryBook(repo, P, a + H, a + 2 * H), 'inserted');
    check('touching before (9 h – 10 h)', await tryBook(repo, P, a - H, a), 'inserted');
    check('another provider, same window', await tryBook(repo, P2, a, a + H), 'inserted');

    console.log('B. statuses that no longer take time');
    for (const [i, status] of [
      ServiceRequestStatus.CANCELLED,
      ServiceRequestStatus.EXPIRED,
      ServiceRequestStatus.COMPLETED,
      ServiceRequestStatus.PAID,
    ].entries()) {
      const s = day(1 + i);
      await fixture(ds, repo, P, s, s + H, status);
      check(`existing ${status}`, await tryBook(repo, P, s, s + H), 'inserted');
    }
    const ip = day(5);
    await fixture(ds, repo, P, ip, ip + H, ServiceRequestStatus.IN_PROGRESS);
    check('existing IN_PROGRESS blocks', await tryBook(repo, P, ip, ip + H), 'SLOT_TAKEN');
    const del = day(6);
    const delId = await fixture(ds, repo, P, del, del + H, ServiceRequestStatus.ASSIGNED);
    await ds.query(`UPDATE service_requests SET deleted_at_utc = now() WHERE id = $1`, [delId]);
    check('existing ASSIGNED but soft-deleted', await tryBook(repo, P, del, del + H), 'inserted');

    console.log('C. information that never refuses');
    const t = day(7);
    await ds.query(
      `INSERT INTO provider_time_off (service_provider_id, starts_at_utc, ends_at_utc)
       VALUES ($1, $2, $3)`,
      [P, new Date(t - H), new Date(t + 3 * H)],
    );
    check('blocked period only', await tryBook(repo, P, t, t + H), 'inserted');
    const night = Date.parse('2027-03-09T07:00:00Z'); // 2 h du matin, heure de l'Est
    check('outside any opening hours', await tryBook(repo, P, night, night + H), 'inserted');
    const tdr = day(9);
    await fixture(ds, repo, P, tdr, tdr + H, ServiceRequestStatus.ASSIGNED, ServiceRequestType.PROJECT_TENDER);
    check('an accepted PROJECT_TENDER on that hour', await tryBook(repo, P, tdr, tdr + H), 'inserted');

    console.log('D. the listed duration is read (45 min service, window 10 h – 12 h)');
    await ds.query(
      `INSERT INTO professional_services
         (professional_service_category_id, service_item_id, pricing_model, price_amount,
          price_currency, estimated_duration_minutes, is_active)
       VALUES ($1, $2, 'FLAT', 40, 'CAD', 45, true)`,
      [pscId, itemId],
    );
    const d = day(10);
    await fixture(ds, repo, P, d, d + 2 * H, ServiceRequestStatus.OPEN);
    check('10 h 45 – 11 h 45 is free', await tryBook(repo, P, d + 45 * M, d + 105 * M), 'inserted');
    const d2 = day(11);
    await fixture(ds, repo, P, d2, d2 + 2 * H, ServiceRequestStatus.OPEN);
    check('10 h 30 – 11 h 30 overlaps', await tryBook(repo, P, d2 + 30 * M, d2 + 90 * M), 'SLOT_TAKEN');

    console.log('D2. creation reads the occupied time (10 h – 17 h offered, 45 min service)');
    const g = day(13);
    await fixture(ds, repo, P, g + 4 * H, g + 5 * H, ServiceRequestStatus.ASSIGNED);
    check('confirmed at 14 h: accepted', await tryBook(repo, P, g, g + 7 * H), 'inserted');
    const g2 = day(14);
    await fixture(ds, repo, P, g2 + 30 * M, g2 + 90 * M, ServiceRequestStatus.ASSIGNED);
    check('confirmed at 10 h 30: refused', await tryBook(repo, P, g2, g2 + 7 * H), 'SLOT_TAKEN');

    console.log('E. acceptance: only a CONFIRMED appointment refuses');
    const e = day(12);
    const self = await fixture(ds, repo, P, e, e + 2 * H, ServiceRequestStatus.OPEN);
    const conflictFor = (id: string) =>
      ds.transaction((m) => repo.hasConfirmedSlotConflict(m, id, P));
    await fixture(ds, repo, P, e + 15 * M, e + 75 * M, ServiceRequestStatus.OPEN);
    check('another OPEN request on the same hour', await conflictFor(self), false);
    await fixture(ds, repo, P2, e, e + H, ServiceRequestStatus.ASSIGNED);
    check('another provider ASSIGNED on the same hour', await conflictFor(self), false);
    await fixture(ds, repo, P, e + 45 * M, e + 105 * M, ServiceRequestStatus.ASSIGNED);
    check('touching a confirmed appointment (self = 10 h – 10 h 45)', await conflictFor(self), false);
    await fixture(ds, repo, P, e + 30 * M, e + 90 * M, ServiceRequestStatus.ASSIGNED);
    check('overlapping a confirmed appointment', await conflictFor(self), true);

    console.log('F. two simultaneous creations on the same window');
    for (let round = 1; round <= 5; round += 1) {
      const f = day(20 + round);
      const results = await Promise.all([
        tryBook(repo, P, f, f + H),
        tryBook(repo, P, f, f + H),
      ]);
      const live = await ds.query(
        `SELECT count(*)::int AS n FROM service_requests
          WHERE requested_service_provider_id = $1 AND desired_start_at_utc = $2 AND deleted_at_utc IS NULL`,
        [P, new Date(f)],
      );
      check(`round ${round}: one passes, one is refused`, [...results].sort(), ['SLOT_TAKEN', 'inserted']);
      check(`round ${round}: one row`, live[0].n, 1);
    }
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
