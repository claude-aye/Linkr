import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsDomain1780440000000 implements MigrationInterface {
  name = 'CreatePaymentsDomain1780440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- native enums --------------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "payment_method_type" AS ENUM ('CARD', 'BANK_ACCOUNT', 'INTERAC_DEBIT')
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_type" AS ENUM ('DEPOSIT', 'BALANCE', 'SINGLE_PAYMENT')
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_status" AS ENUM (
        'PENDING', 'PROCESSING', 'REQUIRES_ACTION', 'SUCCEEDED',
        'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'
      )
    `);

    // --- users.stripe_customer_id -------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "stripe_customer_id" varchar
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_users_stripe_customer"
        ON "users" ("stripe_customer_id")
        WHERE "stripe_customer_id" IS NOT NULL
    `);

    // --- payment_methods (created FIRST — payments FK-references it) ----------
    await queryRunner.query(`
      CREATE TABLE "payment_methods" (
        "id"                       uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_user_id"            uuid,
        "owner_organization_id"    uuid,
        "stripe_payment_method_id" varchar NOT NULL,
        "type"                     "payment_method_type" NOT NULL,
        "brand"                    varchar,
        "last4"                    varchar(4) NOT NULL,
        "exp_month"                smallint,
        "exp_year"                 smallint,
        "is_default"               boolean NOT NULL DEFAULT false,
        "created_at_utc"           timestamptz NOT NULL DEFAULT now(),
        "deleted_at_utc"           timestamptz,

        CONSTRAINT "pk_payment_methods" PRIMARY KEY ("id"),

        CONSTRAINT "fk_payment_methods_owner_user"
          FOREIGN KEY ("owner_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_payment_methods_owner_org"
          FOREIGN KEY ("owner_organization_id")
          REFERENCES "organizations" ("id") ON DELETE RESTRICT,

        CONSTRAINT "uq_payment_methods_stripe_pm"
          UNIQUE ("stripe_payment_method_id"),

        -- Exactly one owner (user XOR organization).
        CONSTRAINT "chk_payment_methods_single_owner"
          CHECK (
            (("owner_user_id" IS NOT NULL)::int
             + ("owner_organization_id" IS NOT NULL)::int) = 1
          ),
        CONSTRAINT "chk_payment_methods_exp_month"
          CHECK ("exp_month" IS NULL OR "exp_month" BETWEEN 1 AND 12)
      )
    `);

    // At most one default per owner among live (non-deleted) methods.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pm_default_user"
        ON "payment_methods" ("owner_user_id")
        WHERE "is_default" AND "deleted_at_utc" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_pm_default_org"
        ON "payment_methods" ("owner_organization_id")
        WHERE "is_default" AND "deleted_at_utc" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pm_owner_user"
        ON "payment_methods" ("owner_user_id")
        WHERE "deleted_at_utc" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pm_owner_org"
        ON "payment_methods" ("owner_organization_id")
        WHERE "deleted_at_utc" IS NULL
    `);

    // --- payments (created SECOND) ------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"                            uuid NOT NULL DEFAULT gen_random_uuid(),
        "service_request_id"            uuid NOT NULL,
        "payment_type"                  "payment_type" NOT NULL,
        "payer_user_id"                 uuid NOT NULL,
        "payer_organization_id"         uuid,
        "recipient_service_provider_id" uuid NOT NULL,
        "payment_method_id"             uuid NOT NULL,
        "stripe_payment_intent_id"      varchar,
        "status"                        "payment_status" NOT NULL DEFAULT 'PENDING',
        "gross_amount"                  decimal(12,2) NOT NULL,
        "currency"                      varchar(3) NOT NULL,
        "commission_rate_percent"       decimal(5,2),
        "platform_fee_amount"           decimal(12,2) NOT NULL DEFAULT 0,
        "tax_amount"                    decimal(12,2) NOT NULL DEFAULT 0,
        "provider_net_amount"           decimal(12,2) NOT NULL,
        "captured_at_utc"               timestamptz,
        "failed_at_utc"                 timestamptz,
        "failure_reason"                text,
        "created_at_utc"                timestamptz NOT NULL DEFAULT now(),
        "updated_at_utc"                timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "pk_payments" PRIMARY KEY ("id"),

        CONSTRAINT "fk_payments_service_request"
          FOREIGN KEY ("service_request_id")
          REFERENCES "service_requests" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_payments_payer_user"
          FOREIGN KEY ("payer_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_payments_payer_org"
          FOREIGN KEY ("payer_organization_id")
          REFERENCES "organizations" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_payments_recipient_provider"
          FOREIGN KEY ("recipient_service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_payments_payment_method"
          FOREIGN KEY ("payment_method_id")
          REFERENCES "payment_methods" ("id") ON DELETE RESTRICT,

        -- One DEPOSIT and one BALANCE per request (capture idempotency guard).
        CONSTRAINT "uq_payments_request_type"
          UNIQUE ("service_request_id", "payment_type"),

        CONSTRAINT "chk_payments_gross_positive"
          CHECK ("gross_amount" > 0),
        CONSTRAINT "chk_payments_nonneg_amounts"
          CHECK ("platform_fee_amount" >= 0 AND "tax_amount" >= 0 AND "provider_net_amount" >= 0),
        CONSTRAINT "chk_payments_commission_range"
          CHECK ("commission_rate_percent" IS NULL OR "commission_rate_percent" BETWEEN 0 AND 100),
        -- Strict accounting invariant.
        CONSTRAINT "chk_payments_net_invariant"
          CHECK ("provider_net_amount" = "gross_amount" - "platform_fee_amount" - "tax_amount")
      )
    `);

    // A PaymentIntent maps to at most one payment row (idempotent webhook sync).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_payments_stripe_intent"
        ON "payments" ("stripe_payment_intent_id")
        WHERE "stripe_payment_intent_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_payments_request" ON "payments" ("service_request_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_methods"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_stripe_customer"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "stripe_customer_id"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "payment_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_type"`);
  }
}
