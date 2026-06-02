import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVerificationDocuments1780370000000
  implements MigrationInterface
{
  name = 'CreateVerificationDocuments1780370000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "verification_document_review_status" AS ENUM ('PENDING','APPROVED','REJECTED','EXPIRED')`,
    );

    // document_type reuses the existing regulatory_required_document_type enum.
    await queryRunner.query(`
      CREATE TABLE "verification_documents" (
        "id"                                 uuid                                   NOT NULL DEFAULT gen_random_uuid(),
        "professional_service_category_id"   uuid                                   NOT NULL,
        "regulatory_requirement_id"          uuid                                   NOT NULL,
        "document_type"                      "regulatory_required_document_type"    NOT NULL,
        "document_number"                    varchar(120),
        "file_url"                           text                                   NOT NULL,
        "file_mime_type"                     varchar(100)                           NOT NULL,
        "file_size_bytes"                    integer                                NOT NULL,
        "issued_at_utc"                      timestamp with time zone,
        "expires_at_utc"                     timestamp with time zone,
        "review_status"                      "verification_document_review_status"  NOT NULL DEFAULT 'PENDING',
        "reviewed_at_utc"                    timestamp with time zone,
        "reviewed_by_user_id"                uuid,
        "rejection_reason"                   text,
        "created_at_utc"                     timestamp with time zone               NOT NULL DEFAULT now(),
        "updated_at_utc"                     timestamp with time zone               NOT NULL DEFAULT now(),
        "deleted_at_utc"                     timestamp with time zone,
        CONSTRAINT "pk_verification_documents" PRIMARY KEY ("id"),
        CONSTRAINT "fk_vd_psc"
          FOREIGN KEY ("professional_service_category_id")
          REFERENCES "professional_service_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_vd_regulatory_requirement"
          FOREIGN KEY ("regulatory_requirement_id")
          REFERENCES "regulatory_requirements"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_vd_reviewed_by"
          FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_vd_psc_id" ON "verification_documents" ("professional_service_category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vd_regulatory_requirement_id" ON "verification_documents" ("regulatory_requirement_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vd_review_status" ON "verification_documents" ("review_status")`,
    );
    // Composite index supporting the nightly expiry scan.
    await queryRunner.query(
      `CREATE INDEX "idx_vd_review_status_expires_at" ON "verification_documents" ("review_status", "expires_at_utc")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_vd_review_status_expires_at"`);
    await queryRunner.query(`DROP INDEX "idx_vd_review_status"`);
    await queryRunner.query(`DROP INDEX "idx_vd_regulatory_requirement_id"`);
    await queryRunner.query(`DROP INDEX "idx_vd_psc_id"`);
    await queryRunner.query(`DROP TABLE "verification_documents"`);
    // Does NOT drop regulatory_required_document_type (owned by services-catalog).
    await queryRunner.query(`DROP TYPE "verification_document_review_status"`);
  }
}
