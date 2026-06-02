import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProviderServices1780360000000 implements MigrationInterface {
  name = 'CreateProviderServices1780360000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "psc_verification_status" AS ENUM ('PENDING','VERIFIED','REJECTED','NOT_REQUIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "professional_service_pricing_model" AS ENUM ('FLAT','HOURLY','QUOTE_ONLY')`,
    );

    await queryRunner.query(`
      CREATE TABLE "professional_service_categories" (
        "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id"   uuid                     NOT NULL,
        "service_category_id"   uuid                     NOT NULL,
        "verification_status"   "psc_verification_status" NOT NULL,
        "requested_at_utc"      timestamp with time zone NOT NULL,
        "verified_at_utc"       timestamp with time zone,
        "rejection_reason"      text,
        "is_active"             boolean                  NOT NULL DEFAULT true,
        "created_at_utc"        timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at_utc"        timestamp with time zone NOT NULL DEFAULT now(),
        "deleted_at_utc"        timestamp with time zone,
        CONSTRAINT "pk_professional_service_categories" PRIMARY KEY ("id"),
        CONSTRAINT "fk_psc_service_provider"
          FOREIGN KEY ("service_provider_id") REFERENCES "service_providers"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_psc_service_category"
          FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_psc_provider_category_active"
       ON "professional_service_categories" ("service_provider_id", "service_category_id")
       WHERE "deleted_at_utc" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_psc_service_provider_id" ON "professional_service_categories" ("service_provider_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_psc_service_category_id" ON "professional_service_categories" ("service_category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_psc_verification_status" ON "professional_service_categories" ("verification_status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "professional_services" (
        "id"                               uuid                                   NOT NULL DEFAULT gen_random_uuid(),
        "professional_service_category_id" uuid                                   NOT NULL,
        "service_item_id"                  uuid                                   NOT NULL,
        "pricing_model"                    "professional_service_pricing_model"   NOT NULL,
        "price_amount"                     decimal(10,2),
        "price_currency"                   varchar(3)                             NOT NULL,
        "estimated_duration_minutes"       integer,
        "description_override"             text,
        "is_active"                        boolean                                NOT NULL DEFAULT true,
        "created_at_utc"                   timestamp with time zone               NOT NULL DEFAULT now(),
        "updated_at_utc"                   timestamp with time zone               NOT NULL DEFAULT now(),
        "deleted_at_utc"                   timestamp with time zone,
        CONSTRAINT "pk_professional_services" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ps_psc"
          FOREIGN KEY ("professional_service_category_id")
          REFERENCES "professional_service_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_ps_service_item"
          FOREIGN KEY ("service_item_id") REFERENCES "service_items"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_ps_pricing" CHECK (
          (pricing_model = 'QUOTE_ONLY' AND price_amount IS NULL)
          OR
          (pricing_model IN ('FLAT','HOURLY') AND price_amount IS NOT NULL AND price_amount >= 0)
        )
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_ps_psc_item_active"
       ON "professional_services" ("professional_service_category_id", "service_item_id")
       WHERE "deleted_at_utc" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ps_psc_id" ON "professional_services" ("professional_service_category_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_ps_psc_id"`);
    await queryRunner.query(`DROP INDEX "ux_ps_psc_item_active"`);
    await queryRunner.query(`DROP TABLE "professional_services"`);
    await queryRunner.query(`DROP INDEX "idx_psc_verification_status"`);
    await queryRunner.query(`DROP INDEX "idx_psc_service_category_id"`);
    await queryRunner.query(`DROP INDEX "idx_psc_service_provider_id"`);
    await queryRunner.query(`DROP INDEX "ux_psc_provider_category_active"`);
    await queryRunner.query(`DROP TABLE "professional_service_categories"`);
    await queryRunner.query(`DROP TYPE "professional_service_pricing_model"`);
    await queryRunner.query(`DROP TYPE "psc_verification_status"`);
  }
}
