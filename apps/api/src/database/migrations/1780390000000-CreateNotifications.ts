import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1780390000000 implements MigrationInterface {
  name = 'CreateNotifications1780390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum ──────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM ('NEW_TENDER_MATCH');`,
    );

    // ── notifications ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"                              uuid                  NOT NULL DEFAULT gen_random_uuid(),
        "recipient_service_provider_id"   uuid                  NOT NULL,
        "type"                            "notification_type"   NOT NULL,
        "service_request_id"              uuid,
        "data"                            jsonb,
        "read_at_utc"                     timestamptz,
        "created_at_utc"                  timestamptz           NOT NULL DEFAULT now(),
        "updated_at_utc"                  timestamptz           NOT NULL DEFAULT now(),
        "deleted_at_utc"                  timestamptz,

        CONSTRAINT "pk_notifications" PRIMARY KEY ("id"),

        CONSTRAINT "fk_notifications_recipient_provider"
          FOREIGN KEY ("recipient_service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_notifications_service_request"
          FOREIGN KEY ("service_request_id")
          REFERENCES "service_requests" ("id") ON DELETE RESTRICT
      );
    `);

    // ── Indexes ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_recipient"
        ON "notifications" ("recipient_service_provider_id");
    `);
    // Composite for unread-count queries (future notification bell).
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_recipient_read"
        ON "notifications" ("recipient_service_provider_id", "read_at_utc")
        WHERE "deleted_at_utc" IS NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_service_request_id"
        ON "notifications" ("service_request_id")
        WHERE "service_request_id" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_created_at"
        ON "notifications" ("created_at_utc");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type";`);
  }
}
