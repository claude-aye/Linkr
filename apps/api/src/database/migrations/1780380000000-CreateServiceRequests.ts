import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceRequests1780380000000 implements MigrationInterface {
  name = 'CreateServiceRequests1780380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostGIS already enabled in phase 3.3 — do not recreate the extension.

    // ── Enums ─────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "service_request_type" AS ENUM ('DIRECT_BOOKING', 'PROJECT_TENDER');`,
    );
    await queryRunner.query(
      `CREATE TYPE "service_request_status" AS ENUM (
        'DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS',
        'COMPLETED', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED'
      );`,
    );

    // ── service_requests ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "service_requests" (
        "id"                              uuid                      NOT NULL DEFAULT gen_random_uuid(),

        "client_user_id"                  uuid                      NOT NULL,
        "request_type"                    "service_request_type"    NOT NULL,
        "status"                          "service_request_status"  NOT NULL,

        "service_category_id"             uuid                      NOT NULL,
        "service_item_id"                 uuid,
        "requested_service_provider_id"   uuid,
        "assigned_service_provider_id"    uuid,

        "title"                           varchar(200)              NOT NULL,
        "description"                     text                      NOT NULL,
        "service_address"                 varchar(500)              NOT NULL,
        "service_location"                geometry(Point, 4326)     NOT NULL,

        "desired_start_at_utc"            timestamptz,
        "desired_end_at_utc"              timestamptz,
        "scheduled_at_utc"                timestamptz,

        "estimated_amount"                numeric(12, 2),
        "estimated_currency"              char(3),
        "final_amount"                    numeric(12, 2),
        "final_currency"                  char(3),

        "response_deadline_utc"           timestamptz,
        "quotes_deadline_utc"             timestamptz,

        "accepted_at_utc"                 timestamptz,
        "completed_at_utc"                timestamptz,
        "paid_at_utc"                     timestamptz,
        "cancelled_at_utc"                timestamptz,
        "cancellation_reason"             text,
        "cancelled_by_user_id"            uuid,

        "created_at_utc"                  timestamptz               NOT NULL DEFAULT now(),
        "updated_at_utc"                  timestamptz               NOT NULL DEFAULT now(),
        "deleted_at_utc"                  timestamptz,

        CONSTRAINT "pk_service_requests" PRIMARY KEY ("id"),

        -- Monetary amounts must always be paired with their currency.
        CONSTRAINT "chk_service_requests_estimated_pair"
          CHECK (
            (estimated_amount IS NULL AND estimated_currency IS NULL)
            OR
            (estimated_amount IS NOT NULL AND estimated_currency IS NOT NULL)
          ),
        CONSTRAINT "chk_service_requests_final_pair"
          CHECK (
            (final_amount IS NULL AND final_currency IS NULL)
            OR
            (final_amount IS NOT NULL AND final_currency IS NOT NULL)
          ),

        CONSTRAINT "fk_service_requests_client_user"
          FOREIGN KEY ("client_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_service_requests_service_category"
          FOREIGN KEY ("service_category_id")
          REFERENCES "service_categories" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_service_requests_service_item"
          FOREIGN KEY ("service_item_id")
          REFERENCES "service_items" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_service_requests_requested_provider"
          FOREIGN KEY ("requested_service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_service_requests_assigned_provider"
          FOREIGN KEY ("assigned_service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_service_requests_cancelled_by_user"
          FOREIGN KEY ("cancelled_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      );
    `);

    // ── Spatial index (GIST) ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_service_location"
        ON "service_requests" USING GIST ("service_location");
    `);

    // ── B-tree indexes ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_client_user_id"
        ON "service_requests" ("client_user_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_status"
        ON "service_requests" ("status");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_request_type"
        ON "service_requests" ("request_type");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_service_category_id"
        ON "service_requests" ("service_category_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_requested_provider_id"
        ON "service_requests" ("requested_service_provider_id")
        WHERE "requested_service_provider_id" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_assigned_provider_id"
        ON "service_requests" ("assigned_service_provider_id")
        WHERE "assigned_service_provider_id" IS NOT NULL;
    `);

    // Partial index for soft-delete filtering (consistent with rest of the schema).
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_active"
        ON "service_requests" ("status", "request_type")
        WHERE "deleted_at_utc" IS NULL;
    `);

    // Composite index used by the expiry cron to find OPEN requests past their deadline.
    await queryRunner.query(`
      CREATE INDEX "ix_service_requests_expiry_scan"
        ON "service_requests" ("status", "request_type", "response_deadline_utc", "quotes_deadline_utc")
        WHERE "deleted_at_utc" IS NULL AND "status" = 'OPEN';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "service_requests";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_request_status";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_request_type";`);
  }
}
