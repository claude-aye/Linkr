import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Thrown inside the consume transaction to roll it back when the account row
 * could not be marked verified (deleted, or its address changed, between the
 * token UPDATE and the users UPDATE). Internal: the caller answers the generic
 * 400, never this.
 */
class AccountNotVerifiableError extends Error {}

/**
 * SQLSTATE of the two "the database gave up on this transaction" outcomes:
 * 40P01 deadlock_detected, 40001 serialization_failure. TypeORM's
 * QueryFailedError copies the driver's `code` onto itself; `driverError` is
 * read too, defensively.
 */
const CONCURRENCY_ABORT_CODES = new Set(['40P01', '40001']);

export function isConcurrencyAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; driverError?: { code?: unknown } };
  const code = typeof e.code === 'string' ? e.code : e.driverError?.code;
  return typeof code === 'string' && CONCURRENCY_ABORT_CODES.has(code);
}

/**
 * Data access for email verification (mandate L1). Every lookup is by
 * `token_hash` — never "find the user, then compare" — same rule as the reset
 * repository: the equality happens inside an indexed SQL predicate.
 *
 * ⚠️ ISSUE ORDER (L1b): a new token is INSERTED, then mailed, and only once the
 * mail is queued are the older live tokens expired (`expireOlderLive`). A
 * failed enqueue therefore never kills the link the user already has.
 */
@Injectable()
export class EmailVerificationTokenRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Inserts a token, under a `FOR UPDATE` lock on the user's row so concurrent
   * issues for one user are serialised (and get distinct, ordered
   * `created_at_utc`).
   *
   * @returns the new row's id and creation instant, used by `expireOlderLive`.
   */
  async insert(
    userId: string,
    email: string,
    tokenHash: string,
    expiresAtUtc: Date,
  ): Promise<{ id: string; createdAtUtc: Date }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      const inserted = (await manager.query(
        `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at_utc, created_at_utc)
         VALUES ($1, $2, $3, $4, clock_timestamp())
         RETURNING id, created_at_utc`,
        [userId, email, tokenHash, expiresAtUtc],
      )) as { id: string; created_at_utc: Date }[];
      return { id: inserted[0].id, createdAtUtc: inserted[0].created_at_utc };
    });
  }

  /**
   * Expires every live token of the user created BEFORE `keep` (rotation),
   * under the same row lock. Older only: two racing resends cannot kill each
   * other's link — the newer one survives.
   */
  async expireOlderLive(
    userId: string,
    keep: { id: string; createdAtUtc: Date },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
      await manager.query(
        `UPDATE email_verification_tokens
            SET expires_at_utc = now()
          WHERE user_id = $1
            AND id <> $2
            AND created_at_utc < $3
            AND consumed_at_utc IS NULL
            AND expires_at_utc > now()`,
        [userId, keep.id, keep.createdAtUtc],
      );
    });
  }

  /** Expires one token (the new one, when its mail could not be queued). */
  async expire(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE email_verification_tokens SET expires_at_utc = now() WHERE id = $1`,
      [id],
    );
  }

  /**
   * Consumes a token and marks the account verified — both or neither.
   *
   * ⚠️ THE ADDRESS CHECK IS IN THE SAME `WHERE` AS THE CONSUME. A token matches
   * only while `users.email` still EQUALS the address it was issued for (exact,
   * case-sensitive: sign-up stores the address raw). Soft-deleted accounts match
   * nothing either.
   *
   * ⚠️ The users UPDATE repeats both conditions (address, `deleted_at_utc IS
   * NULL`) and must touch exactly one row; otherwise the transaction is rolled
   * back — the token stays unconsumed — and the caller gets the generic 400.
   *
   * ⚠️ `.query()` on an UPDATE … RETURNING returns `[rows, affected]`; `[0]` is
   * read explicitly (a bare `.length` is 2 on zero matched rows).
   *
   * ⚠️ LOCK ORDER (L1d): the `users` row FIRST, then the token — the same order
   * as `insert` and `expireOlderLive`. Locking the token first (by its UPDATE)
   * and the user second made a cycle with a concurrent resend's rotation, which
   * holds the user and waits on the token: PostgreSQL then killed one side
   * (40P01) and verify-email answered 500. If the database still aborts the
   * transaction for concurrency (40P01, 40001), the caller gets `null`, hence
   * the generic 400 — the token was not consumed (rollback), a retry works.
   *
   * @returns the user id when the token was valid, `null` otherwise.
   */
  async consumeAndVerify(tokenHash: string): Promise<string | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Lock only; the result is not read. An unknown token locks nothing,
        // and the UPDATE below decides.
        await manager.query(
          `SELECT u.id
             FROM users u
             JOIN email_verification_tokens t ON t.user_id = u.id
            WHERE t.token_hash = $1
              FOR UPDATE OF u`,
          [tokenHash],
        );

        const consumed: unknown = await manager.query(
          `UPDATE email_verification_tokens t
              SET consumed_at_utc = now()
             FROM users u
            WHERE t.token_hash = $1
              AND t.consumed_at_utc IS NULL
              AND t.expires_at_utc > now()
              AND u.id = t.user_id
              AND u.deleted_at_utc IS NULL
              AND u.email = t.email
          RETURNING t.user_id, t.email`,
          [tokenHash],
        );

        const rows = (Array.isArray(consumed) ? consumed[0] : []) as
          | { user_id: string; email: string }[]
          | undefined;
        const row = rows?.[0];
        if (!row) {
          return null;
        }

        const updated: unknown = await manager.query(
          `UPDATE users
              SET email_verified_at_utc = COALESCE(email_verified_at_utc, now())
            WHERE id = $1
              AND email = $2
              AND deleted_at_utc IS NULL
          RETURNING id`,
          [row.user_id, row.email],
        );
        const updatedRows = (Array.isArray(updated) ? updated[0] : []) as
          | { id: string }[]
          | undefined;
        if (!updatedRows?.length) {
          throw new AccountNotVerifiableError();
        }

        return row.user_id;
      });
    } catch (error) {
      if (error instanceof AccountNotVerifiableError || isConcurrencyAbort(error)) {
        return null;
      }
      throw error;
    }
  }
}
