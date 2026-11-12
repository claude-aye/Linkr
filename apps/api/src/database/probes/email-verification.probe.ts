/**
 * Probe: email verification tokens (mandate L1) against a real Postgres.
 *
 * Invocation (from apps/api, with DATABASE_URL pointing at a SCRATCH database
 * that has been migrated):
 *
 *   DATABASE_URL=postgresql://linkr:...@127.0.0.1:5432/linkr_emailverif_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/email-verification.probe.ts
 *
 * Why it exists: the rules of this flow live in SQL — expiry, single use, the
 * address check, rotation, and the password-reset side effect — and jest mocks
 * the database. This probe runs the SHIPPED repositories on real rows.
 *
 * Refuses to run unless the database name contains "probe"; cleans up after
 * itself (hard DELETE of its own fixtures in a scratch database only).
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

import { EmailVerificationTokenRepository } from '../../modules/auth/email-verification-token.repository';
import { PasswordResetTokenRepository } from '../../modules/auth/password-reset-token.repository';
import { hashToken } from '../../modules/auth/token-hash';
import { PasswordResetToken } from '../../modules/auth/entities/password-reset-token.entity';

const U_A = 'aaaaaaa9-0000-4000-8000-000000000001';
const U_B = 'aaaaaaa9-0000-4000-8000-000000000002';
const EMAIL_A = 'probe-verif-a@linkr.test';
const EMAIL_B = 'probe-verif-b@linkr.test';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`,
  );
}

function assertScratchDatabase(url: string | undefined): void {
  const name = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!name.includes('probe')) {
    throw new Error(`Refusing to run: database "${name}" is not a probe database`);
  }
}

async function wipe(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_A, U_B]]);
}

async function seed(ds: DataSource): Promise<void> {
  for (const [id, email] of [
    [U_A, EMAIL_A],
    [U_B, EMAIL_B],
  ]) {
    await ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Probe', 'Verif', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email],
    );
    await ds.query(
      `INSERT INTO user_auth_providers (user_id, provider_type, password_hash)
       VALUES ($1, 'EMAIL_PASSWORD', 'old-hash')`,
      [id],
    );
  }
}

const verifiedAt = async (ds: DataSource, id: string): Promise<boolean> =>
  (
    await ds.query(`SELECT email_verified_at_utc IS NOT NULL AS v FROM users WHERE id = $1`, [id])
  )[0].v;

/** The service's order: insert, (mail queued), then expire the older live tokens. */
async function issue(
  repo: EmailVerificationTokenRepository,
  userId: string,
  email: string,
  tokenHash: string,
  expiresAtUtc: Date,
): Promise<void> {
  const inserted = await repo.insert(userId, email, tokenHash, expiresAtUtc);
  await repo.expireOlderLive(userId, inserted);
}

const future = () => new Date(Date.now() + 24 * 3600 * 1000);

function parseDuration(value: string): number {
  const m = /^(\d+)\s*(ms|s|min)?$/.exec(value.trim());
  if (!m) throw new Error(`Unreadable deadlock_timeout: ${value}`);
  const n = Number(m[1]);
  return m[2] === 'min' ? n * 60000 : m[2] === 'ms' ? n : n * 1000;
}

/** Polls until `n` backends of this database are waiting on a heavyweight lock. */
async function waitForLockWaiters(ds: DataSource, n: number): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const rows = await ds.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${n} lock waiter(s)`);
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
  const repo = new EmailVerificationTokenRepository(ds);
  const resetRepo = new PasswordResetTokenRepository(
    ds.getRepository(PasswordResetToken),
    ds,
  );

  try {
    console.log('A. valid token');
    await wipe(ds);
    await seed(ds);
    await issue(repo, U_A, EMAIL_A, hashToken('tok-a'), future());
    check('valid token → user id', await repo.consumeAndVerify(hashToken('tok-a')), U_A);
    check('… account verified', await verifiedAt(ds, U_A), true);
    check('… the other account untouched', await verifiedAt(ds, U_B), false);

    console.log('B. reused token');
    check('same token again → null', await repo.consumeAndVerify(hashToken('tok-a')), null);

    console.log('C. expired token');
    await issue(repo, U_B, EMAIL_B, hashToken('tok-exp'), new Date(Date.now() - 1000));
    check('expired → null', await repo.consumeAndVerify(hashToken('tok-exp')), null);
    check('… not verified', await verifiedAt(ds, U_B), false);

    console.log('D. unknown token');
    check('unknown → null', await repo.consumeAndVerify(hashToken('nope')), null);

    console.log('E. token issued for a previous address');
    await issue(repo, U_B, EMAIL_B, hashToken('tok-old'), future());
    await ds.query(`UPDATE users SET email = 'probe-verif-b2@linkr.test' WHERE id = $1`, [U_B]);
    check('old-address token → null', await repo.consumeAndVerify(hashToken('tok-old')), null);
    check('… not verified', await verifiedAt(ds, U_B), false);
    const notConsumed = await ds.query(
      `SELECT consumed_at_utc FROM email_verification_tokens WHERE token_hash = $1`,
      [hashToken('tok-old')],
    );
    check('… token not consumed', notConsumed[0].consumed_at_utc, null);
    await ds.query(`UPDATE users SET email = 'PROBE-VERIF-B@linkr.test' WHERE id = $1`, [U_B]);
    check('case-variant address is NOT the same address → null', await repo.consumeAndVerify(hashToken('tok-old')), null);
    await ds.query(`UPDATE users SET email = $2 WHERE id = $1`, [U_B, EMAIL_B]);

    console.log('F. rotation');
    await issue(repo, U_B, EMAIL_B, hashToken('tok-r1'), future());
    await issue(repo, U_B, EMAIL_B, hashToken('tok-r2'), future());
    check('older token after a resend → null', await repo.consumeAndVerify(hashToken('tok-r1')), null);
    check('newest token → user id', await repo.consumeAndVerify(hashToken('tok-r2')), U_B);

    console.log('G. already verified + valid token');
    const before = (await ds.query(`SELECT email_verified_at_utc AS d FROM users WHERE id = $1`, [U_A]))[0].d;
    await issue(repo, U_A, EMAIL_A, hashToken('tok-again'), future());
    check('valid token on verified account → user id', await repo.consumeAndVerify(hashToken('tok-again')), U_A);
    const after = (await ds.query(`SELECT email_verified_at_utc AS d FROM users WHERE id = $1`, [U_A]))[0].d;
    check('… verification date unchanged', after.getTime(), before.getTime());

    console.log('H. concurrency');
    await wipe(ds);
    await seed(ds);
    await issue(repo, U_A, EMAIL_A, hashToken('tok-race'), future());
    const race = await Promise.all([
      repo.consumeAndVerify(hashToken('tok-race')),
      repo.consumeAndVerify(hashToken('tok-race')),
    ]);
    check('two simultaneous clicks → exactly one success', race.filter((r) => r !== null).length, 1);

    console.log('H2. two racing resends (FOR UPDATE on the user row)');
    for (let round = 1; round <= 5; round += 1) {
      await Promise.all([
        issue(repo, U_B, EMAIL_B, hashToken(`race-${round}-a`), future()),
        issue(repo, U_B, EMAIL_B, hashToken(`race-${round}-b`), future()),
      ]);
      const live = await ds.query(
        `SELECT count(*)::int AS n FROM email_verification_tokens
          WHERE user_id = $1 AND consumed_at_utc IS NULL AND expires_at_utc > now()`,
        [U_B],
      );
      check(`round ${round}: exactly one live link left`, live[0].n, 1);
    }

    console.log('H3. a send that failed keeps the previous link (L1b)');
    await issue(repo, U_B, EMAIL_B, hashToken('kept-old'), future());
    const fresh = await repo.insert(U_B, EMAIL_B, hashToken('failed-new'), future());
    await repo.expire(fresh.id); // what the service does when the enqueue fails
    check('the never-sent new token is dead', await repo.consumeAndVerify(hashToken('failed-new')), null);
    check('the previous link still verifies', await repo.consumeAndVerify(hashToken('kept-old')), U_B);
    await ds.query(`UPDATE users SET email_verified_at_utc = NULL WHERE id = $1`, [U_B]);

    console.log('H4. old link clicked during a resend rotation (L1d lock order), 20 rounds');
    {
      const deadlockMs = parseDuration(
        (await ds.query(`SHOW deadlock_timeout`))[0].deadlock_timeout as string,
      );
      let slow = 0;
      let threw = 0;
      let wrong = 0;
      for (let round = 1; round <= 20; round += 1) {
        await ds.query(`UPDATE users SET email_verified_at_utc = NULL WHERE id = $1`, [U_B]);
        await issue(repo, U_B, EMAIL_B, hashToken(`h4-old-${round}`), future());
        const fresh = await repo.insert(U_B, EMAIL_B, hashToken(`h4-new-${round}`), future());

        // A third transaction holds the users row so both sides queue behind it
        // in a known order: the rotation first, then the click.
        const blocker = ds.createQueryRunner();
        await blocker.connect();
        await blocker.startTransaction();
        await blocker.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [U_B]);

        const rotation = repo.expireOlderLive(U_B, fresh).then(
          () => 'ok',
          () => 'threw',
        );
        await waitForLockWaiters(ds, 1);
        const click = repo.consumeAndVerify(hashToken(`h4-old-${round}`)).then(
          (r) => r,
          () => 'threw' as const,
        );
        await waitForLockWaiters(ds, 2);

        const released = Date.now();
        await blocker.rollbackTransaction();
        await blocker.release();
        const [rot, clk] = await Promise.all([rotation, click]);
        const elapsed = Date.now() - released;
        if (process.env.PROBE_DEBUG) console.log(`    round ${round}: ${elapsed} ms`);

        if (rot === 'threw' || clk === 'threw') threw += 1;
        // A deadlock is only resolved after deadlock_timeout: a fast finish
        // proves there was none, whichever side PostgreSQL would have killed.
        if (elapsed >= deadlockMs * 0.9) slow += 1;
        // The rotation ran first, so the old link is dead → null (generic 400).
        if (clk !== null) wrong += 1;
        if ((await repo.consumeAndVerify(hashToken(`h4-new-${round}`))) !== U_B) wrong += 1;
      }
      check('no side threw (no 500)', threw, 0);
      check(`no deadlock (every round finished under ${deadlockMs * 0.9} ms)`, slow, 0);
      check('old link refused, new link verifies, every round', wrong, 0);
      await ds.query(`UPDATE users SET email_verified_at_utc = NULL WHERE id = $1`, [U_B]);
    }

    console.log('I. soft-deleted account');
    await issue(repo, U_B, EMAIL_B, hashToken('tok-del'), future());
    await ds.query(`UPDATE users SET deleted_at_utc = now() WHERE id = $1`, [U_B]);
    check('soft-deleted → null', await repo.consumeAndVerify(hashToken('tok-del')), null);
    await ds.query(`UPDATE users SET deleted_at_utc = NULL WHERE id = $1`, [U_B]);

    console.log('J. completed password reset marks the address verified');
    await ds.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at_utc) VALUES ($1, $2, $3)`,
      [U_B, hashToken('reset-b'), future()],
    );
    check('reset → user id', await resetRepo.consumeAndSetPassword(hashToken('reset-b'), 'new-hash'), U_B);
    check('… address verified', await verifiedAt(ds, U_B), true);
    const firstDate = (await ds.query(`SELECT email_verified_at_utc AS d FROM users WHERE id = $1`, [U_B]))[0].d;
    await ds.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at_utc) VALUES ($1, $2, $3)`,
      [U_B, hashToken('reset-b2'), future()],
    );
    await resetRepo.consumeAndSetPassword(hashToken('reset-b2'), 'newer-hash');
    const secondDate = (await ds.query(`SELECT email_verified_at_utc AS d FROM users WHERE id = $1`, [U_B]))[0].d;
    check('… a second reset keeps the first date (COALESCE)', secondDate.getTime(), firstDate.getTime());

    console.log('K. cascade on hard delete');
    await ds.query(`DELETE FROM users WHERE id = $1`, [U_A]);
    const left = await ds.query(`SELECT count(*)::int AS n FROM email_verification_tokens WHERE user_id = $1`, [U_A]);
    check('tokens removed with the user', left[0].n, 0);
  } finally {
    await wipe(ds);
    await ds.destroy();
  }

  console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
