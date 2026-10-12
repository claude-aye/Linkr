import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proof of consent (PR L2): WHEN a person accepted the terms, and WHICH version.
 *
 * The public trial collects real email addresses, so Loi 25 needs a record of
 * the acceptance — not a checkbox the server never heard about.
 *
 * ⚠️ NO BACKFILL. Existing accounts stay at NULL, which means "never accepted".
 * Inventing a date for them would be a false proof, worse than no proof: it
 * would claim a consent nobody gave. A re-acceptance screen is a separate,
 * deferred piece of work (CLAUDE.md §6).
 *
 * ⚠️ TIMESTAMP = head + 10000000 (head was 1780530000000-CreatePasswordResetTokens).
 * Never behind the head: a migration numbered behind it is skipped on any
 * database that already ran past it.
 *
 * `terms_version` is the civil date of the accepted text (`YYYY-MM-DD`),
 * `LEGAL_VERSION` on the web side, `CURRENT_TERMS_VERSION` on the API side —
 * kept in step by scripts/check-mirrored-constants.mjs.
 *
 * The CHECK makes a half-written proof unrepresentable: a date without a
 * version (or the reverse) says nothing a regulator could rely on.
 *
 * Mirrored on the `User` entity (`comment` options and `@Check`), otherwise the
 * next `migration:generate` would propose dropping the comments and the CHECK.
 */
export class AddUserTermsAcceptance1780540000000 implements MigrationInterface {
  name = 'AddUserTermsAcceptance1780540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "terms_accepted_at_utc" timestamp with time zone NULL,
        ADD COLUMN "terms_version" varchar(10) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "chk_users_terms_acceptance_paired"
        CHECK (("terms_accepted_at_utc" IS NULL) = ("terms_version" IS NULL))
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."terms_accepted_at_utc" IS 'When the user accepted the terms and privacy policy, set by the server at signup. NULL = never accepted (accounts created before PR L2, and OAuth accounts). Never backfilled.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "users"."terms_version" IS 'Civil date (YYYY-MM-DD) of the legal texts accepted: LEGAL_VERSION on the web, CURRENT_TERMS_VERSION on the API. NULL = never accepted.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT "chk_users_terms_acceptance_paired"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "terms_version",
        DROP COLUMN "terms_accepted_at_utc"
    `);
  }
}
