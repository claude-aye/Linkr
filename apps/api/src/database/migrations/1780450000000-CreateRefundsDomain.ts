import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 3.10c — Refunds domain + the COMPLETED "awaiting-release" freeze flag.
 *
 *  • `refund_status` native enum + `refunds` table (admin-initiated, partial-
 *    capable; immutable history, NO soft-delete — mirrors `payments`).
 *  • `service_requests.contested_at_utc` — set by the client's /contest endpoint
 *    to freeze the balance auto-release timer and route the request to admin.
 */
export class CreateRefundsDomain1780450000000 implements MigrationInterface {
  name = 'CreateRefundsDomain1780450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "refund_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
    `);

    // Freezes the balance auto-release timer (Part 4) and signals admin review.
    await queryRunner.query(`
      ALTER TABLE "service_requests" ADD COLUMN "contested_at_utc" timestamptz
    `);

    await queryRunner.query(`
      CREATE TABLE "refunds" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "payment_id"            uuid NOT NULL,
        "amount"                decimal(12,2) NOT NULL,
        "currency"              varchar(3) NOT NULL,
        "reason"                text NOT NULL,
        "initiated_by_user_id"  uuid NOT NULL,
        "status"                "refund_status" NOT NULL DEFAULT 'PENDING',
        "stripe_refund_id"      varchar,
        "failure_reason"        text,
        "created_at_utc"        timestamptz NOT NULL DEFAULT now(),
        "updated_at_utc"        timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "pk_refunds" PRIMARY KEY ("id"),

        CONSTRAINT "fk_refunds_payment"
          FOREIGN KEY ("payment_id")
          REFERENCES "payments" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_refunds_initiated_by"
          FOREIGN KEY ("initiated_by_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_refunds_amount_positive" CHECK ("amount" > 0)
      )
    `);

    // A Stripe refund maps to at most one row (idempotent webhook sync).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_refunds_stripe_refund"
        ON "refunds" ("stripe_refund_id")
        WHERE "stripe_refund_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_refunds_payment" ON "refunds" ("payment_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in dependency order: the table (which uses the enum) first, then the
    // added column, then the now-unreferenced enum type.
    await queryRunner.query(`DROP TABLE IF EXISTS "refunds"`);
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "contested_at_utc"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "refund_status"`);
  }
}
