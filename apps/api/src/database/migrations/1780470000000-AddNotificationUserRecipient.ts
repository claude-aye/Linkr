import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opens `notifications` to a second kind of recipient: a user.
 *
 * Until now the table only ever described "a provider was notified" — its sole
 * writer is `broadcastTenderMatch()`, a geographic fan-out for PROJECT_TENDER.
 * A DIRECT_BOOKING targets one provider that the client picked by hand, so it
 * needs a targeted row rather than a broadcast. That row is still addressed to
 * a provider today, but the recipient column is generalised here so the table
 * does not have to be reshaped again the first time a client must be told
 * something (quote received, job started, balance released).
 *
 * Four moves, in this order:
 *
 *  1. `notification_type` gains NEW_DIRECT_BOOKING. It is a *native PG enum*
 *     (verified: `\dT+ notification_type` → Internal name `notification_type`,
 *     Elements `NEW_TENDER_MATCH`), and `ALTER TYPE … ADD VALUE` cannot be
 *     followed by a use of the new value inside the same transaction — which
 *     is exactly what TypeORM gives us, since it wraps every migration in one.
 *     Hence the rename-recreate recipe below, which is fully transactional.
 *  2. `recipient_user_id` is added, nullable, FK → users(id). Its ON DELETE is
 *     RESTRICT, aligned on `fk_notifications_recipient_provider` (verified:
 *     `confdeltype = 'r'`); both existing FKs on this table agree, so there was
 *     no divergence to arbitrate.
 *  3. `recipient_service_provider_id` drops NOT NULL. Safe without a backfill:
 *     `SELECT count(*) … WHERE recipient_service_provider_id IS NULL` = 0.
 *  4. A CHECK keeps exactly one recipient set, so "addressed to nobody" and
 *     "addressed to both" are unrepresentable rather than merely unwritten.
 *
 * `read_at_utc` is NOT added here — it already exists, from the table's own
 * creation migration (1780390000000, line 20), and is already mirrored on the
 * entity.
 *
 * The CHECK and the column comment are mirrored on the entity (`@Check()` and
 * the `comment` option on `data`); without those mirrors the next
 * `migration:generate` would propose dropping them.
 */
export class AddNotificationUserRecipient1780470000000
  implements MigrationInterface
{
  name = 'AddNotificationUserRecipient1780470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Enum: rename-recreate (see header) ─────────────────────────────
    await queryRunner.query(
      `ALTER TYPE "notification_type" RENAME TO "notification_type_old";`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM ('NEW_TENDER_MATCH', 'NEW_DIRECT_BOOKING');`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "type" TYPE "notification_type"
        USING "type"::text::"notification_type";
    `);
    await queryRunner.query(`DROP TYPE "notification_type_old";`);

    // ── 2. Second recipient ───────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD COLUMN "recipient_user_id" uuid;
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "fk_notifications_recipient_user"
        FOREIGN KEY ("recipient_user_id")
        REFERENCES "users" ("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_recipient_user"
        ON "notifications" ("recipient_user_id")
        WHERE "recipient_user_id" IS NOT NULL;
    `);

    // ── 3. The provider recipient becomes optional ────────────────────────
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "recipient_service_provider_id" DROP NOT NULL;
    `);

    // ── 4. Exactly one recipient, enforced by the database ────────────────
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "chk_notifications_single_recipient"
        CHECK (num_nonnulls("recipient_user_id", "recipient_service_provider_id") = 1);
    `);

    // ── data: what belongs in it, and what does not ───────────────────────
    await queryRunner.query(`
      COMMENT ON COLUMN "notifications"."data" IS 'Identifiers live in columns, not here: the recipient and the service request are real FKs, and readers join on them. Reserve this for what cannot be joined — a rendering hint, a snapshot of a value that will legitimately drift from its source. An id duplicated here is a second source of truth that nothing keeps in sync.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      COMMENT ON COLUMN "notifications"."data" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        DROP CONSTRAINT "chk_notifications_single_recipient";
    `);

    // Rows addressed to a user have no representation once the provider
    // recipient is mandatory again, and rows typed NEW_DIRECT_BOOKING have none
    // once the label is gone. This revert therefore discards them — the single
    // place where the soft-delete rule (CLAUDE.md §13.1) cannot apply, because
    // the reverted schema has nowhere to put the row at all. Both deletes are
    // no-ops on a database that never ran the code this migration enables.
    await queryRunner.query(`
      DELETE FROM "notifications" WHERE "recipient_service_provider_id" IS NULL;
    `);
    await queryRunner.query(`
      DELETE FROM "notifications" WHERE "type" = 'NEW_DIRECT_BOOKING';
    `);

    await queryRunner.query(`DROP INDEX "ix_notifications_recipient_user";`);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        DROP CONSTRAINT "fk_notifications_recipient_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications" DROP COLUMN "recipient_user_id";
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "recipient_service_provider_id" SET NOT NULL;
    `);

    await queryRunner.query(
      `ALTER TYPE "notification_type" RENAME TO "notification_type_old";`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_type" AS ENUM ('NEW_TENDER_MATCH');`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ALTER COLUMN "type" TYPE "notification_type"
        USING "type"::text::"notification_type";
    `);
    await queryRunner.query(`DROP TYPE "notification_type_old";`);
  }
}
