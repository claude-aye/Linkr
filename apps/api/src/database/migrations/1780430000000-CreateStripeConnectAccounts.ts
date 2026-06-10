import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStripeConnectAccounts1780430000000
  implements MigrationInterface
{
  name = 'CreateStripeConnectAccounts1780430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "stripe_connect_account_type" AS ENUM ('EXPRESS', 'CUSTOM')
    `);

    await queryRunner.query(`
      CREATE TYPE "stripe_connect_onboarding_status" AS ENUM (
        'NOT_STARTED', 'INFO_NEEDED', 'PENDING_VERIFICATION',
        'VERIFIED', 'RESTRICTED', 'DISABLED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "stripe_connect_accounts" (
        "id"                          uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id"         uuid NOT NULL,
        "stripe_account_id"           varchar NOT NULL,
        "account_type"                "stripe_connect_account_type" NOT NULL DEFAULT 'EXPRESS',
        "onboarding_status"           "stripe_connect_onboarding_status" NOT NULL DEFAULT 'NOT_STARTED',
        "charges_enabled"             boolean NOT NULL DEFAULT false,
        "payouts_enabled"             boolean NOT NULL DEFAULT false,
        "requirements_currently_due"  jsonb NOT NULL DEFAULT '[]',
        "country_code"                varchar(2) NOT NULL,
        "default_currency"            varchar(3) NOT NULL,
        "onboarded_at_utc"            timestamptz,
        "created_at_utc"              timestamptz NOT NULL DEFAULT now(),
        "updated_at_utc"              timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "pk_stripe_connect_accounts" PRIMARY KEY ("id"),

        CONSTRAINT "fk_stripe_connect_accounts_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "uq_stripe_connect_accounts_service_provider"
          UNIQUE ("service_provider_id"),
        CONSTRAINT "uq_stripe_connect_accounts_stripe_account"
          UNIQUE ("stripe_account_id"),

        -- A VERIFIED account must have both capabilities enabled.
        CONSTRAINT "chk_stripe_connect_verified_capabilities"
          CHECK ("onboarding_status" <> 'VERIFIED'
                 OR ("charges_enabled" AND "payouts_enabled")),
        -- A NOT_STARTED account must have neither capability enabled.
        CONSTRAINT "chk_stripe_connect_not_started_capabilities"
          CHECK ("onboarding_status" <> 'NOT_STARTED'
                 OR (NOT "charges_enabled" AND NOT "payouts_enabled"))
      )
    `);

    // Supports the 3.10b onboarding-reminder sweep (providers stuck mid-flow).
    await queryRunner.query(`
      CREATE INDEX "idx_connect_onboarding_incomplete"
        ON "stripe_connect_accounts" ("onboarding_status")
        WHERE "onboarding_status" IN ('INFO_NEEDED', 'PENDING_VERIFICATION')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_connect_onboarding_incomplete"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "stripe_connect_accounts"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "stripe_connect_onboarding_status"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "stripe_connect_account_type"`);
  }
}
