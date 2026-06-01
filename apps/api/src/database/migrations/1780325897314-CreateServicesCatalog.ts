import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServicesCatalog1780325897314 implements MigrationInterface {
  name = 'CreateServicesCatalog1780325897314';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Extend users table with system role ────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "users_system_role_enum" AS ENUM ('USER', 'ADMIN');`,
    );
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "system_role" "users_system_role_enum" NOT NULL DEFAULT 'USER';
    `);

    // ── Enum types ─────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "service_category_regulation_level" AS ENUM ('REGULATED', 'INFORMAL');`,
    );
    await queryRunner.query(
      `CREATE TYPE "service_item_approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');`,
    );
    await queryRunner.query(
      `CREATE TYPE "regulatory_required_document_type" AS ENUM ('LICENSE_NUMBER', 'COMPETENCY_CARD', 'CERTIFICATION');`,
    );
    await queryRunner.query(
      `CREATE TYPE "regulatory_input_type" AS ENUM ('TEXT_INPUT', 'FILE_UPLOAD', 'TEXT_AND_FILE');`,
    );

    // ── service_categories ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "service_categories" (
        "id"                       uuid         NOT NULL DEFAULT gen_random_uuid(),
        "slug"                     varchar(80)  NOT NULL,
        "name_translations"        jsonb        NOT NULL,
        "description_translations" jsonb        NOT NULL DEFAULT '{}',
        "icon_url"                 varchar,
        "regulation_level"         "service_category_regulation_level" NOT NULL,
        "is_active"                boolean      NOT NULL DEFAULT true,
        "sort_order"               int          NOT NULL DEFAULT 0,
        "created_at_utc"           timestamptz  NOT NULL DEFAULT now(),
        "updated_at_utc"           timestamptz  NOT NULL DEFAULT now(),
        "deleted_at_utc"           timestamptz,
        CONSTRAINT "pk_service_categories" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_service_categories_slug"
        ON "service_categories" ("slug")
        WHERE "deleted_at_utc" IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_categories_is_active"
        ON "service_categories" ("is_active");
    `);

    // ── service_items ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "service_items" (
        "id"                       uuid         NOT NULL DEFAULT gen_random_uuid(),
        "service_category_id"      uuid         NOT NULL,
        "slug"                     varchar(80)  NOT NULL,
        "name_translations"        jsonb        NOT NULL,
        "description_translations" jsonb        NOT NULL DEFAULT '{}',
        "typical_duration_minutes" int,
        "suggested_price_range"    jsonb,
        "suggested_by_user_id"     uuid,
        "approval_status"          "service_item_approval_status" NOT NULL DEFAULT 'PENDING',
        "approved_at_utc"          timestamptz,
        "approved_by_user_id"      uuid,
        "rejection_reason"         text,
        "is_active"                boolean      NOT NULL DEFAULT true,
        "sort_order"               int          NOT NULL DEFAULT 0,
        "created_at_utc"           timestamptz  NOT NULL DEFAULT now(),
        "updated_at_utc"           timestamptz  NOT NULL DEFAULT now(),
        "deleted_at_utc"           timestamptz,
        CONSTRAINT "pk_service_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_service_items_category"
          FOREIGN KEY ("service_category_id")
          REFERENCES "service_categories" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_service_items_suggested_by"
          FOREIGN KEY ("suggested_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_service_items_approved_by"
          FOREIGN KEY ("approved_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_service_items_category_slug"
        ON "service_items" ("service_category_id", "slug")
        WHERE "deleted_at_utc" IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_items_category_id"
        ON "service_items" ("service_category_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_items_approval_status"
        ON "service_items" ("approval_status");
    `);

    // ── regulatory_requirements ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "regulatory_requirements" (
        "id"                              uuid         NOT NULL DEFAULT gen_random_uuid(),
        "service_category_id"             uuid         NOT NULL,
        "country_code"                    varchar(2)   NOT NULL,
        "subdivision_code"                varchar(6),
        "authority_code"                  varchar(40)  NOT NULL,
        "authority_full_name_translations" jsonb       NOT NULL,
        "validation_endpoint_url"         varchar,
        "required_document_type"          "regulatory_required_document_type" NOT NULL,
        "input_type"                      "regulatory_input_type"              NOT NULL,
        "is_required"                     boolean      NOT NULL DEFAULT true,
        "created_at_utc"                  timestamptz  NOT NULL DEFAULT now(),
        "updated_at_utc"                  timestamptz  NOT NULL DEFAULT now(),
        "deleted_at_utc"                  timestamptz,
        CONSTRAINT "pk_regulatory_requirements" PRIMARY KEY ("id"),
        CONSTRAINT "fk_regulatory_requirements_category"
          FOREIGN KEY ("service_category_id")
          REFERENCES "service_categories" ("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_regulatory_requirements_unique_rule"
        ON "regulatory_requirements"
          ("service_category_id", "country_code", "subdivision_code", "authority_code")
        WHERE "deleted_at_utc" IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_regulatory_requirements_country_subdivision"
        ON "regulatory_requirements" ("country_code", "subdivision_code");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "regulatory_requirements";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_categories";`);

    await queryRunner.query(`DROP TYPE IF EXISTS "regulatory_input_type";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "regulatory_required_document_type";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_item_approval_status";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_category_regulation_level";`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "system_role";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_system_role_enum";`);
  }
}
