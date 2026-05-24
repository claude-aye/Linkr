import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1779596097582 implements MigrationInterface {
  name = 'InitialSchema1779596097582';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Extensions — must exist before tables that depend on them.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "postgis";`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // Enum types (named as TypeORM would auto-generate them).
    await queryRunner.query(
      `CREATE TYPE "users_verification_level_enum" AS ENUM ('NONE', 'EMAIL', 'PHONE', 'IDENTITY');`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_auth_providers_provider_type_enum" AS ENUM ('EMAIL_PASSWORD', 'GOOGLE', 'APPLE');`,
    );

    // users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying NOT NULL,
        "email_verified_at_utc" TIMESTAMP WITH TIME ZONE,
        "phone" character varying,
        "phone_verified_at_utc" TIMESTAMP WITH TIME ZONE,
        "first_name" character varying NOT NULL,
        "last_name" character varying NOT NULL,
        "display_name" character varying,
        "avatar_url" character varying,
        "language_preference" character varying NOT NULL DEFAULT 'fr-CA',
        "country_code" character varying(2) NOT NULL,
        "subdivision_code" character varying(6) NOT NULL,
        "preferred_currency" character varying(3) NOT NULL,
        "default_location" geometry(Point,4326),
        "verification_level" "users_verification_level_enum" NOT NULL DEFAULT 'NONE',
        "created_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at_utc" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      );
    `);

    // Partial unique indexes — uniqueness coexists with soft delete.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_users_email" ON "users" ("email") WHERE "deleted_at_utc" IS NULL;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deleted_at_utc" IS NULL;`,
    );

    // GIST index for proximity queries on the PostGIS point.
    await queryRunner.query(
      `CREATE INDEX "ix_users_default_location_gist" ON "users" USING GIST ("default_location");`,
    );

    // user_auth_providers
    await queryRunner.query(`
      CREATE TABLE "user_auth_providers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider_type" "user_auth_providers_provider_type_enum" NOT NULL,
        "provider_user_id" character varying,
        "password_hash" character varying,
        "last_used_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_auth_providers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_user_auth_providers_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);

    // One provider type per user; one Linkr account per OAuth identity.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_user_auth_providers_user_type" ON "user_auth_providers" ("user_id", "provider_type");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_user_auth_providers_oauth_identity" ON "user_auth_providers" ("provider_type", "provider_user_id") WHERE "provider_user_id" IS NOT NULL;`,
    );

    // Auth integrity: password for EMAIL_PASSWORD, OAuth sub for GOOGLE/APPLE.
    await queryRunner.query(`
      ALTER TABLE "user_auth_providers" ADD CONSTRAINT "chk_auth_provider_consistency"
      CHECK (
        (provider_type = 'EMAIL_PASSWORD' AND password_hash IS NOT NULL AND provider_user_id IS NULL)
        OR
        (provider_type IN ('GOOGLE', 'APPLE') AND provider_user_id IS NOT NULL AND password_hash IS NULL)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: drop tables (and their indexes/constraints) then enums.
    // PostGIS / pgcrypto extensions are intentionally left in place — other
    // components may depend on them.
    await queryRunner.query(`DROP TABLE "user_auth_providers";`);
    await queryRunner.query(`DROP TABLE "users";`);
    await queryRunner.query(
      `DROP TYPE "user_auth_providers_provider_type_enum";`,
    );
    await queryRunner.query(`DROP TYPE "users_verification_level_enum";`);
  }
}
