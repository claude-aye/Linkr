import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceProviders1780342061384 implements MigrationInterface {
  name = 'CreateServiceProviders1780342061384';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostGIS already enabled in phase 3.3 — do not recreate the extension.

    // ── Enum ───────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "service_provider_type" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');`,
    );

    // ── service_providers ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "service_providers" (
        "id"                    uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "provider_type"         "service_provider_type" NOT NULL,
        "user_id"               uuid,
        "organization_id"       uuid,
        "business_name"         varchar(150),
        "headline"              varchar(150),
        "bio"                   text,
        "service_base_location" geography(Point, 4326) NOT NULL,
        "service_radius_km"     int                    NOT NULL,
        "is_active"             boolean                NOT NULL DEFAULT true,
        "activated_at_utc"      timestamptz,
        "created_at_utc"        timestamptz            NOT NULL DEFAULT now(),
        "updated_at_utc"        timestamptz            NOT NULL DEFAULT now(),
        "deleted_at_utc"        timestamptz,
        CONSTRAINT "pk_service_providers" PRIMARY KEY ("id"),
        CONSTRAINT "chk_service_providers_radius" CHECK ("service_radius_km" >= 0),
        CONSTRAINT "chk_service_providers_polymorphic" CHECK (
          ("provider_type" = 'INDIVIDUAL'   AND "user_id" IS NOT NULL AND "organization_id" IS NULL)
          OR
          ("provider_type" = 'ORGANIZATION' AND "organization_id" IS NOT NULL AND "user_id" IS NULL)
        ),
        CONSTRAINT "fk_service_providers_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_service_providers_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT
      );
    `);

    // One active provider per owner (individual or organization).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_service_providers_user"
        ON "service_providers" ("user_id")
        WHERE "deleted_at_utc" IS NULL AND "user_id" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_service_providers_org"
        ON "service_providers" ("organization_id")
        WHERE "deleted_at_utc" IS NULL AND "organization_id" IS NOT NULL;
    `);
    // Spatial index — indispensable for ST_DWithin proximity queries (phase 3.8).
    await queryRunner.query(`
      CREATE INDEX "ix_service_providers_base_location"
        ON "service_providers" USING GIST ("service_base_location");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_providers_is_active"
        ON "service_providers" ("is_active");
    `);

    // ── professional_service_zones ─────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "professional_service_zones" (
        "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id" uuid                     NOT NULL,
        "zone_polygon"        geography(Polygon, 4326) NOT NULL,
        "zone_label"          varchar(120)             NOT NULL,
        "created_at_utc"      timestamptz              NOT NULL DEFAULT now(),
        "updated_at_utc"      timestamptz              NOT NULL DEFAULT now(),
        "deleted_at_utc"      timestamptz,
        CONSTRAINT "pk_professional_service_zones" PRIMARY KEY ("id"),
        CONSTRAINT "fk_professional_service_zones_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_professional_service_zones_polygon"
        ON "professional_service_zones" USING GIST ("zone_polygon");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_professional_service_zones_provider"
        ON "professional_service_zones" ("service_provider_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_professional_service_zones_provider";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_professional_service_zones_polygon";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "professional_service_zones";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_service_providers_is_active";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_service_providers_base_location";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_service_providers_org";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_service_providers_user";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_providers";`);

    await queryRunner.query(`DROP TYPE IF EXISTS "service_provider_type";`);
  }
}
