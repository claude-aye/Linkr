import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Email verification (mandate L1): the token table.
 *
 * Calqued on `password_reset_tokens` (A-2), with ONE extra column, `email`: the
 * address the token was issued FOR. A token only marks an account verified while
 * that address is still the account's (the consume path compares the two, exact
 * and case-sensitive, because sign-up stores the address raw and
 * `ux_users_email` is on the raw value). Without it, a future address change
 * would let an old link confirm an address it was never sent to.
 *
 * ⚠️ TIMESTAMP: head + 10000000 (head = 1780550000000-CreatePortfolioItems).
 * Never a slot behind the head — see the A-2 migration docblock.
 *
 * ⚠️ THE TOKEN IS NEVER STORED, only its SHA-256 (hex). The raw value lives in
 * the email and in the BullMQ job payload. TTL is 24 h (longer than a reset,
 * because nothing is unlocked by it beyond confirming a mailbox the user already
 * reads, and people open sign-up mails late).
 *
 * `ON DELETE CASCADE`, same reasoning as reset tokens: a Loi 25 erasure must not
 * need a manual sweep. No `updated_at_utc`, no `deleted_at_utc`: append-only.
 *
 * Written by hand: `migration:generate` emits FK-rename noise in this repository.
 */
export class CreateEmailVerificationTokens1780560000000 implements MigrationInterface {
  name = 'CreateEmailVerificationTokens1780560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_verification_tokens" (
        "id"               uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          uuid        NOT NULL,
        "token_hash"       text        NOT NULL,
        "email"            varchar     NOT NULL,
        "expires_at_utc"   timestamptz NOT NULL,
        "consumed_at_utc"  timestamptz NULL,
        "created_at_utc"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_email_verification_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "fk_email_verification_tokens_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "email_verification_tokens" IS
        'Single-use email verification tokens. Stores SHA-256 of the token, never the token, and the address it was issued for: a token only verifies while that address is still the account''s.'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "email_verification_tokens"."token_hash" IS
        'SHA-256 (hex) of a 32-byte random, base64url-encoded token. The raw token lives only in the email and the queue payload.'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "email_verification_tokens"."email" IS
        'Address the token was sent to, copied raw from users.email at issue time. Compared exactly (case-sensitive) at consume time.'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_email_verification_tokens_hash"
        ON "email_verification_tokens" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_email_verification_tokens_user_active"
        ON "email_verification_tokens" ("user_id")
        WHERE "consumed_at_utc" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Bounded loss: this migration creates the table. users.email_verified_at_utc
    // predates it and is untouched.
    await queryRunner.query(`DROP TABLE "email_verification_tokens"`);
  }
}
