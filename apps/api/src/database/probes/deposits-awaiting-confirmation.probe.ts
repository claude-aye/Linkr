/**
 * Probe: the client's « deposits to confirm » list, against a real Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_pendingdeposits_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/deposits-awaiting-confirmation.probe.ts
 *
 * Same stance as the other probes: it runs the SHIPPED query
 * (`ServiceRequestRepository.findDepositsAwaitingClientConfirmation`) and the
 * shipped mapper (`DepositAwaitingConfirmationItemDto.from`), never a re-typed
 * copy of the SQL. jest mocks the repository, so the predicate itself — a join
 * across two tables, one row per term — is only ever exercised here.
 *
 * Refuses to run unless the database name contains "probe"; cleans up after
 * itself (hard DELETE of its own fixtures in a scratch database only).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { ServiceRequest } from '../../modules/service-requests/entities/service-request.entity';
import { ServiceRequestRepository } from '../../modules/service-requests/repositories/service-request.repository';
import { DepositAwaitingConfirmationItemDto } from '../../modules/service-requests/dto/deposit-awaiting-confirmation.dto';
import { Payment } from '../../modules/payments/entities/payment.entity';
import { PaymentRepository } from '../../modules/payments/repositories/payment.repository';

const TAG = '[probe-pending-deposits]';

const U_CLIENT = 'aaaaaaa4-0000-4000-8000-000000000001';
const U_STRANGER = 'aaaaaaa4-0000-4000-8000-000000000002';
const U_PRO = 'aaaaaaa4-0000-4000-8000-000000000003';
const SP = 'ccccccc4-0000-4000-8000-000000000001';
const CAT = 'eeeeeee4-0000-4000-8000-000000000001';
const PM_CLIENT = 'ddddddd4-0000-4000-8000-000000000001';
const PM_STRANGER = 'ddddddd4-0000-4000-8000-000000000002';

/**
 * One request per case. Each carries AT MOST one DEPOSIT (the unique guard),
 * so every case is one row the query either returns or does not.
 */
interface Case {
  key: string;
  client: string;
  payer: string;
  requestStatus: string;
  paymentType: 'DEPOSIT' | 'BALANCE';
  paymentStatus: string;
  withIntent: boolean;
  requestDeleted?: boolean;
  /** Minutes ago the charge failed — drives the expected order. */
  failedMinutesAgo: number;
  expected: boolean;
}

const CASES: Case[] = [
  { key: 'ASSIGNED', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 30, expected: true },
  { key: 'IN_PROGRESS', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'IN_PROGRESS', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 10, expected: true },
  { key: 'COMPLETED', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'COMPLETED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 20, expected: true },
  // Request not live.
  { key: 'PAID', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'PAID', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
  { key: 'CANCELLED', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'CANCELLED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
  { key: 'OPEN', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'OPEN', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
  // Deposit row not confirmable.
  { key: 'NO_INTENT', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: false, failedMinutesAgo: 5, expected: false },
  { key: 'SUCCEEDED', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'SUCCEEDED', withIntent: true, failedMinutesAgo: 5, expected: false },
  // REQUIRES_ACTION — the client abandoned the challenge, then the provider's
  // retry reconciled the row: only the client can clear it, so it stays listed.
  { key: 'REQUIRES_ACTION', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'REQUIRES_ACTION', withIntent: true, failedMinutesAgo: 15, expected: true },
  { key: 'RA_NO_INTENT', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'REQUIRES_ACTION', withIntent: false, failedMinutesAgo: 5, expected: false },
  // PENDING — a provider retry has just re-armed the row: in flight, not ours.
  { key: 'PENDING', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'PENDING', withIntent: true, failedMinutesAgo: 5, expected: false },
  { key: 'BALANCE', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'COMPLETED', paymentType: 'BALANCE', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
  // Soft-deleted request.
  { key: 'DELETED', client: U_CLIENT, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, requestDeleted: true, failedMinutesAgo: 5, expected: false },
  // Someone else's.
  { key: 'STRANGER', client: U_STRANGER, payer: U_STRANGER, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
  // Payer is the client, but the request belongs to someone else (both sides read).
  { key: 'PAYER_NOT_OWNER', client: U_STRANGER, payer: U_CLIENT, requestStatus: 'ASSIGNED', paymentType: 'DEPOSIT', paymentStatus: 'FAILED', withIntent: true, failedMinutesAgo: 5, expected: false },
];

const reqId = (i: number): string => `fffffff4-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`;
const payId = (i: number): string => `99999994-0000-4000-8000-0000000000${String(i + 1).padStart(2, '0')}`;

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

async function wipe(ds: DataSource): Promise<void> {
  const requests = CASES.map((_, i) => reqId(i));
  await ds.query(`DELETE FROM payments WHERE service_request_id = ANY($1::uuid[])`, [requests]);
  await ds.query(`DELETE FROM service_requests WHERE id = ANY($1::uuid[])`, [requests]);
  await ds.query(`DELETE FROM payment_methods WHERE id = ANY($1::uuid[])`, [[PM_CLIENT, PM_STRANGER]]);
  await ds.query(`DELETE FROM service_providers WHERE id = $1`, [SP]);
  await ds.query(`DELETE FROM service_categories WHERE id = $1`, [CAT]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_CLIENT, U_STRANGER, U_PRO]]);
}

async function seed(ds: DataSource): Promise<void> {
  const user = (id: string, email: string) =>
    ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Probe', 'Probe', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email],
    );
  await user(U_CLIENT, 'probe-pd-client@linkr.test');
  await user(U_STRANGER, 'probe-pd-stranger@linkr.test');
  await user(U_PRO, 'probe-pd-pro@linkr.test');

  await ds.query(
    `INSERT INTO service_categories
       (id, slug, name_translations, description_translations, icon_url,
        regulation_level, is_active, sort_order)
     VALUES ($1, 'probe-pd-trade', '{"fr-CA":"Métier sonde"}'::jsonb, '{}'::jsonb, '',
             'INFORMAL', true, 0)`,
    [CAT],
  );
  await ds.query(
    `INSERT INTO service_providers
       (id, provider_type, user_id, business_name, headline, bio,
        service_base_location, service_radius_km, is_active, activated_at_utc)
     VALUES ($1, 'INDIVIDUAL', $2, 'Probe Pro', '', '',
             ST_SetSRID(ST_MakePoint(-71.21, 46.81), 4326)::geography, 25, true, now())`,
    [SP, U_PRO],
  );
  for (const [id, owner, pm] of [
    [PM_CLIENT, U_CLIENT, 'pm_probe_pd_client'],
    [PM_STRANGER, U_STRANGER, 'pm_probe_pd_stranger'],
  ]) {
    await ds.query(
      `INSERT INTO payment_methods (id, owner_user_id, stripe_payment_method_id, type, last4, is_default)
       VALUES ($1, $2, $3, 'CARD', '3184', true)`,
      [id, owner, pm],
    );
  }

  for (const [i, c] of CASES.entries()) {
    await ds.query(
      `INSERT INTO service_requests
         (id, client_user_id, request_type, status, service_category_id,
          title, description, service_address, service_location,
          service_location_precision, deleted_at_utc)
       VALUES ($1, $2, 'DIRECT_BOOKING', $3, $4, $5, 'Probe fixture.', '1 rue Probe',
               ST_SetSRID(ST_MakePoint(-71.21, 46.81), 4326), 'GEOCODED', $6)`,
      [reqId(i), c.client, c.requestStatus, CAT, `${TAG} ${c.key}`, c.requestDeleted ? new Date() : null],
    );
    await ds.query(
      `INSERT INTO payments
         (id, service_request_id, payment_type, payer_user_id, recipient_service_provider_id,
          payment_method_id, stripe_payment_intent_id, status, gross_amount, currency,
          commission_rate_percent, platform_fee_amount, tax_amount, provider_net_amount,
          failed_at_utc, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 30.00, 'CAD', 10.00, 3.00, 0.00, 27.00,
               now() - make_interval(mins => $9), 'Your card was declined.')`,
      [
        payId(i),
        reqId(i),
        c.paymentType,
        c.payer,
        SP,
        c.payer === U_CLIENT ? PM_CLIENT : PM_STRANGER,
        c.withIntent ? `pi_probe_pd_${c.key.toLowerCase()}` : null,
        c.paymentStatus,
        c.failedMinutesAgo,
      ],
    );
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

    const repo = new ServiceRequestRepository(ds.getRepository(ServiceRequest));
    const records = await repo.findDepositsAwaitingClientConfirmation(U_CLIENT);
    const keys = records.map((r) => r.title.replace(`${TAG} `, ''));

    console.log('Table de vérité — un cas par terme du prédicat :');
    for (const c of CASES) {
      check(`${c.key.padEnd(16)} → ${c.expected ? 'listé' : 'absent'}`, keys.includes(c.key), c.expected);
    }

    console.log('\nOrdre et forme :');
    check('ordre = échec le plus récent d’abord', keys, ['IN_PROGRESS', 'REQUIRES_ACTION', 'COMPLETED', 'ASSIGNED']);
    const dto = DepositAwaitingConfirmationItemDto.from(records[0]);
    check('champs exposés (ni clientSecret, ni message Stripe)', Object.keys(dto).sort(), [
      'currency',
      'failedAtUtc',
      'grossAmount',
      'serviceRequestId',
      'title',
    ]);
    check('montant et devise de la ligne', [dto.grossAmount, dto.currency], ['30.00', 'CAD']);
    check('identifiant de la demande', dto.serviceRequestId, reqId(1));

    console.log('\nÉcriture conditionnelle de la carte (même liste de statuts) :');
    const payments = new PaymentRepository(ds.getRepository(Payment));
    for (const key of ['ASSIGNED', 'REQUIRES_ACTION', 'PENDING', 'SUCCEEDED']) {
      const i = CASES.findIndex((c) => c.key === key);
      const touched = await payments.setPaymentMethodWhileAwaitingClient(payId(i), PM_CLIENT);
      check(`${CASES[i].paymentStatus.padEnd(16)} → carte ${touched ? 'écrite' : 'non écrite'}`, touched, key === 'ASSIGNED' || key === 'REQUIRES_ACTION');
    }

    console.log('\nAutre lecteur :');
    const stranger = await repo.findDepositsAwaitingClientConfirmation(U_STRANGER);
    // STRANGER is listed for its owner; PAYER_NOT_OWNER is not (payer ≠ caller).
    check(
      'le second client ne voit que le sien',
      stranger.map((r) => r.title.replace(`${TAG} `, '')),
      ['STRANGER'],
    );
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(`\n${TAG} ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
