import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQuotes1780420000000 implements MigrationInterface {
  name = 'CreateQuotes1780420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "quote_status" AS ENUM (
        'SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'REJECTED', 'EXPIRED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "quotes" (
        "id"                          uuid           NOT NULL DEFAULT gen_random_uuid(),
        "service_request_id"          uuid           NOT NULL,
        "service_provider_id"         uuid           NOT NULL,
        "amount"                      numeric(12, 2) NOT NULL,
        "currency"                    varchar(3)     NOT NULL,
        "estimated_duration_minutes"  integer        NOT NULL,
        "proposed_start_at_utc"       timestamptz,
        "description"                 text           NOT NULL,
        "status"                      "quote_status" NOT NULL DEFAULT 'SUBMITTED',
        "valid_until_utc"             timestamptz    NOT NULL,
        "created_at_utc"              timestamptz    NOT NULL DEFAULT now(),
        "updated_at_utc"              timestamptz    NOT NULL DEFAULT now(),

        CONSTRAINT "pk_quotes" PRIMARY KEY ("id"),

        CONSTRAINT "fk_quotes_service_request"
          FOREIGN KEY ("service_request_id")
          REFERENCES "service_requests" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_quotes_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_quotes_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "chk_quotes_duration_positive" CHECK ("estimated_duration_minutes" > 0),
        -- Compare two columns only — never now() inside a CHECK.
        CONSTRAINT "chk_quotes_valid_until_after_created"
          CHECK ("valid_until_utc" > "created_at_utc")
      )
    `);

    // At most one live (SUBMITTED) quote per provider per request.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_quote_one_live_per_provider_per_request"
        ON "quotes" ("service_request_id", "service_provider_id")
        WHERE "status" = 'SUBMITTED'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_quotes_request_status"
        ON "quotes" ("service_request_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_quotes_provider"
        ON "quotes" ("service_provider_id")
    `);

    // Partial index supporting the hourly expiry sweep.
    await queryRunner.query(`
      CREATE INDEX "idx_quotes_expiry_sweep"
        ON "quotes" ("valid_until_utc")
        WHERE "status" = 'SUBMITTED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_expiry_sweep"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_provider"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_request_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_quote_one_live_per_provider_per_request"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "quotes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "quote_status"`);
  }
}
