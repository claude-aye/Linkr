import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Password reset: the token table, and the revocation bound that expels live
 * sessions when a password changes.
 *
 * Both belong to the same responsibility — a reset that did not expel the
 * sessions it was meant to expel is not a reset — so they ship in ONE migration.
 * Splitting them would allow a deploy where the reset works and the expulsion
 * silently does not.
 *
 * ⚠️ TIMESTAMP: THE RESERVED BAND WAS DELIBERATELY PASSED OVER. The band
 * 1780480000000–1780499999999 is free and was offered for this work, but it sits
 * BEHIND the head (`1780520000000-CreateReviews`). A migration numbered behind
 * the head is skipped on any database that has already run past it — it would
 * apply on a fresh database and never on a developer's existing one, and the
 * divergence has no symptom until something reads a column that is not there.
 * This migration therefore takes head + 10000000 = 1780530000000. Keep doing
 * that; a "free" slot behind the head is a trap, not an opportunity.
 *
 * ⚠️ THE TOKEN IS NEVER STORED. `token_hash` holds SHA-256 (hex) of a 32-byte
 * random value; the raw token exists only in the email and in the BullMQ job
 * payload. That is a deliberate consequence, not a precaution: because nothing
 * can re-read the secret from here, the "enqueue an id and look the secret up at
 * send time" shortcut is CLOSED, and the real ceiling on exposure is the token's
 * own 60-minute lifetime rather than Redis eviction (see EMAIL_JOB_OPTIONS).
 *
 * SHA-256 and NOT Argon2id, against the usual reflex: a random salt would make
 * lookup by equality impossible, and 32 bytes of cryptographic randomness have no
 * weak entropy for a slow hash to compensate. The threat a slow hash answers —
 * guessing a human-chosen secret — does not exist here.
 *
 * `ON DELETE CASCADE`, deviating from this repository's `ON DELETE RESTRICT`
 * convention, on purpose: a Loi 25 erasure request must be able to go through
 * without a manual sweep of leftover reset tokens. The rows have no historical
 * value — an unconsumed token is worthless and a consumed one is spent — so
 * there is nothing that RESTRICT would be protecting.
 *
 * NO `updated_at_utc` and NO `deleted_at_utc`: a row is inserted, consumed once,
 * and never edited. Same append-only reasoning already documented for `payments`,
 * `refunds` and `demand_signals`. Adding either by reflex would advertise a
 * lifecycle that does not exist.
 *
 * TWO indexes, for the two queries this table exists to answer:
 *   • UNIQUE on `token_hash` — the consume path, which finds a row by hash and
 *     NEVER by user. Unique because a hash collision must be a database error,
 *     not a silent second match.
 *   • PARTIAL on `user_id WHERE consumed_at_utc IS NULL` — the rotation path,
 *     which expires a user's live tokens when a new one is requested. Partial
 *     because spent tokens are dead weight the rotation never looks at.
 *
 * Written by hand, not generated: `migration:generate` in this repository emits
 * systematic FK-rename noise and is not trustworthy.
 */
export class CreatePasswordResetTokens1780530000000 implements MigrationInterface {
  name = 'CreatePasswordResetTokens1780530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset_tokens" (
        "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          uuid        NOT NULL,
        "token_hash"       text        NOT NULL,
        "expires_at_utc"   timestamptz NOT NULL,
        "consumed_at_utc"  timestamptz NULL,
        "created_at_utc"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_password_reset_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "fk_password_reset_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "password_reset_tokens" IS
        'Single-use password reset tokens. Stores SHA-256 of the token, never the token. Rows are found by token_hash only — never by user — so a lookup cannot leak whether an account exists.'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "password_reset_tokens"."token_hash" IS
        'SHA-256 (hex) of a 32-byte random, base64url-encoded token. The raw token lives only in the email and the queue payload.'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_password_reset_tokens_hash"
        ON "password_reset_tokens" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_password_reset_tokens_user_active"
        ON "password_reset_tokens" ("user_id")
        WHERE "consumed_at_utc" IS NULL
    `);

    // The revocation bound. NOT NULL is load-bearing: a nullable column would let
    // a branch that forgot to compare pass everything through, and the omission
    // would look exactly like a working system.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "sessions_invalidated_at_utc" timestamptz NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "users"."sessions_invalidated_at_utc" IS
        'Refresh tokens issued before this instant are rejected. A revocation bound, NOT a mirror of the password: the password lives on user_auth_providers.password_hash, and this column must also be written by a future authenticated password change and by a future "sign out everywhere". Compared against the JWT iat in SECONDS.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "sessions_invalidated_at_utc"
    `);
    // Data loss is assumed and bounded: this migration creates the table, so
    // nothing that predates it is destroyed. Dropping the table takes its two
    // indexes and its foreign key with it.
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
  }
}
