import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Data access for email verification (mandate L1). Every lookup is by
 * `token_hash` — never "find the user, then compare" — same rule as the reset
 * repository: the equality happens inside an indexed SQL predicate.
 */
@Injectable()
export class EmailVerificationTokenRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Rotation + insert, in one transaction. Every live token of the user is
   * expired before the new one is written: after a resend, only the newest
   * link works.
   */
  async rotateAndInsert(
    userId: string,
    email: string,
    tokenHash: string,
    expiresAtUtc: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE email_verification_tokens
            SET expires_at_utc = now()
          WHERE user_id = $1
            AND consumed_at_utc IS NULL
            AND expires_at_utc > now()`,
        [userId],
      );

      await manager.query(
        `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at_utc)
         VALUES ($1, $2, $3, $4)`,
        [userId, email, tokenHash, expiresAtUtc],
      );
    });
  }

  /**
   * Consumes a token and marks the account verified — both or neither.
   *
   * ⚠️ THE ADDRESS CHECK IS IN THE SAME `WHERE` AS THE CONSUME. A token matches
   * only while `users.email` still EQUALS the address it was issued for (exact,
   * case-sensitive: sign-up stores the address raw). A token for an old address
   * therefore matches nothing, is not consumed, and the caller gets the generic
   * failure. Soft-deleted accounts match nothing either.
   *
   * ⚠️ Concurrency guard in the `WHERE` (`consumed_at_utc IS NULL`), evaluated
   * under the UPDATE's own row lock: two simultaneous clicks cannot both match.
   *
   * ⚠️ `.query()` on an UPDATE … RETURNING returns `[rows, affected]`; `[0]` is
   * read explicitly (a bare `.length` is 2 on zero matched rows).
   *
   * `COALESCE` keeps an existing verification date: an already-verified account
   * presenting a valid token succeeds and nothing changes.
   *
   * @returns the user id when the token was valid, `null` otherwise.
   */
  async consumeAndVerify(tokenHash: string): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
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

      await manager.query(
        `UPDATE users
            SET email_verified_at_utc = COALESCE(email_verified_at_utc, now())
          WHERE id = $1
            AND email = $2`,
        [row.user_id, row.email],
      );

      return row.user_id;
    });
  }
}
