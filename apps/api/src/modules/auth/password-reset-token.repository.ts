import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthProviderType } from '../users/enums/auth-provider-type.enum';
import { PasswordResetToken } from './entities/password-reset-token.entity';

/**
 * Data access for password reset. Two operations, and both are one statement.
 *
 * ⚠️ EVERY LOOKUP IS BY `token_hash`. There is no "find the user by email, then
 * compare" path here, and there must never be one: that shape is where a timing
 * comparison and an account-existence leak reappear together. It also means this
 * class never needs `timingSafeEqual` — nothing is compared in application
 * memory, the equality happens inside an indexed SQL predicate.
 */
@Injectable()
export class PasswordResetTokenRepository {
  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokenRepo: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Rotation + insert, in one transaction.
   *
   * Requesting a new link kills the previous ones (A-2.15): a user who asks
   * twice and clicks the older mail must be told the link was replaced, not
   * silently handed two working tokens. Expiring rather than deleting keeps the
   * verification rule singular — the consume path knows ONE predicate
   * (`not consumed AND not expired`) and needs no notion of "superseded".
   *
   * Both statements are in the same transaction so a crash between them cannot
   * leave a user with zero usable tokens after having just asked for one.
   */
  async rotateAndInsert(
    userId: string,
    tokenHash: string,
    expiresAtUtc: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE password_reset_tokens
            SET expires_at_utc = now()
          WHERE user_id = $1
            AND consumed_at_utc IS NULL
            AND expires_at_utc > now()`,
        [userId],
      );

      await manager.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at_utc)
         VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAtUtc],
      );
    });
  }

  /**
   * Consumes a token and writes the new password — ALL OF IT, OR NONE OF IT.
   *
   * ⚠️ THE THREE WRITES ARE ONE TRANSACTION, AND THAT IS THE WHOLE POINT OF THIS
   * METHOD (A-2.6). Burn the token without storing the password and the user is
   * locked out permanently, holding a dead link and a password that never
   * changed — the single worst outcome this feature can produce, and the one a
   * naive two-step implementation produces under any error.
   *
   *   1. consume the token   (conditional UPDATE, below)
   *   2. write password_hash (user_auth_providers)
   *   3. move the revocation bound (users) — expels every live session
   *
   * ⚠️ STEP 1 IS THE CONCURRENCY GUARD, IN THE `WHERE`, NOT IN A PRIOR `SELECT`.
   * `consumed_at_utc IS NULL AND expires_at_utc > now()` is evaluated by the
   * database while the row is locked by the UPDATE itself, so two simultaneous
   * requests carrying the same token cannot both match: the second one updates
   * ZERO rows and this method returns `null`. A `SELECT` then `UPDATE` would let
   * both pass. No `FOR UPDATE` is needed and none is used — the UPDATE is the
   * lock.
   *
   * ⚠️ `.query()` on an UPDATE ... RETURNING gives `[rows, affected]`, NOT rows —
   * a quirk this codebase has been bitten by six times (payment, refund, quote,
   * stripe-connect, notifications, reviews each carry a local normaliser). Here
   * it is handled by reading `[0]` explicitly rather than by a seventh copy of
   * the helper: a bare `rows.length` would be 2 on ZERO matched rows, which would
   * turn "this token is invalid" into "this token worked".
   *
   * @returns the owning user's id when the token was valid, `null` otherwise —
   *          the caller cannot tell WHY it was invalid, and neither can the user.
   */
  async consumeAndSetPassword(
    tokenHash: string,
    passwordHash: string,
  ): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
      const consumed: unknown = await manager.query(
        `UPDATE password_reset_tokens
            SET consumed_at_utc = now()
          WHERE token_hash = $1
            AND consumed_at_utc IS NULL
            AND expires_at_utc > now()
        RETURNING user_id`,
        [tokenHash],
      );

      const rows = (Array.isArray(consumed) ? consumed[0] : []) as
        | { user_id: string }[]
        | undefined;
      const userId = rows?.[0]?.user_id;

      // Unknown, already spent, expired or rotated away — one outcome, no detail.
      if (!userId) {
        return null;
      }

      // The password lives on the EMAIL_PASSWORD auth provider row, not on
      // `users`. A user who only ever signed in with Google has no such row;
      // `updated` is then 0 and we roll back rather than burn their token for
      // nothing. (`forgot-password` does not offer a link to those accounts in
      // the first place — this is the belt to that suspenders.)
      const updated: unknown = await manager.query(
        // The provider type is interpolated, not bound: it is a compile-time
        // constant from our own enum (never caller data), and this is the house
        // convention for native PG enums in raw SQL — see
        // notifications.repository.ts:74. It also sidesteps the parameter-type
        // inference question a bound value raises against an enum column.
        `UPDATE user_auth_providers
            SET password_hash = $1
          WHERE user_id = $2
            AND provider_type = '${AuthProviderType.EMAIL_PASSWORD}'
        RETURNING id`,
        [passwordHash, userId],
      );

      const updatedRows = (Array.isArray(updated) ? updated[0] : []) as
        | { id: string }[]
        | undefined;
      if (!updatedRows?.length) {
        throw new NoEmailPasswordProviderError(userId);
      }

      // Expels every refresh token issued before now (A-2.10). Inside the same
      // transaction: a password changed without this bound moving would leave
      // whoever took over the account still signed in.
      await manager.query(
        `UPDATE users SET sessions_invalidated_at_utc = now() WHERE id = $1`,
        [userId],
      );

      return userId;
    });
  }
}

/**
 * Thrown inside the reset transaction to roll it back when the account has no
 * email/password provider to write to. Internal to this module — the controller
 * never surfaces it distinctly, because doing so would tell an anonymous caller
 * which accounts are OAuth-only.
 */
export class NoEmailPasswordProviderError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has no EMAIL_PASSWORD auth provider`);
    this.name = 'NoEmailPasswordProviderError';
  }
}
