import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganizationsAndMemberships1779799026375
  implements MigrationInterface
{
  name = 'AddOrganizationsAndMemberships1779799026375';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum for organization-level RBAC.
    await queryRunner.query(
      `CREATE TYPE "organization_role_enum" AS ENUM ('OWNER', 'WORKER');`,
    );

    // organizations
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "legal_name" character varying(200) NOT NULL,
        "display_name" character varying(200) NOT NULL,
        "slug" character varying(50) NOT NULL,
        "logo_url" text,
        "description" text NOT NULL DEFAULT '',
        "legal_address" text NOT NULL,
        "country_code" character varying(2) NOT NULL,
        "subdivision_code" character varying(10) NOT NULL,
        "billing_email" character varying(320) NOT NULL,
        "business_number" character varying(50),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at_utc" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_organizations" PRIMARY KEY ("id")
      );
    `);

    // Slug uniqueness coexists with soft delete.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_organizations_slug" ON "organizations" ("slug") WHERE "deleted_at_utc" IS NULL;`,
    );
    // Geo lookups by jurisdiction (tax/feature toggling).
    await queryRunner.query(
      `CREATE INDEX "ix_organizations_country_subdivision" ON "organizations" ("country_code", "subdivision_code");`,
    );

    // organization_memberships
    await queryRunner.query(`
      CREATE TABLE "organization_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" "organization_role_enum" NOT NULL,
        "joined_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "left_at_utc" TIMESTAMP WITH TIME ZONE,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at_utc" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_organization_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "fk_memberships_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_memberships_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);

    // One active membership per (org, user); history preserved via left_at_utc.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_active_membership" ON "organization_memberships" ("organization_id", "user_id") WHERE "left_at_utc" IS NULL;`,
    );
    // "My organizations" lookup.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_user_active" ON "organization_memberships" ("user_id", "is_active");`,
    );
    // Member roster + active-owner counting.
    await queryRunner.query(
      `CREATE INDEX "ix_memberships_org_active" ON "organization_memberships" ("organization_id", "is_active");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: drop memberships (and FKs/indexes) then organizations, then enum.
    await queryRunner.query(`DROP TABLE "organization_memberships";`);
    await queryRunner.query(`DROP TABLE "organizations";`);
    await queryRunner.query(`DROP TYPE "organization_role_enum";`);
  }
}
