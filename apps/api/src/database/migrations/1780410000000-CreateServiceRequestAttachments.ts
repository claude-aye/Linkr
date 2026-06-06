import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceRequestAttachments1780410000000
  implements MigrationInterface
{
  name = 'CreateServiceRequestAttachments1780410000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "service_request_attachment_kind" AS ENUM ('CLIENT_PHOTO','BEFORE','AFTER')`,
    );

    await queryRunner.query(`
      CREATE TABLE "service_request_attachments" (
        "id"                   uuid                              NOT NULL DEFAULT gen_random_uuid(),
        "service_request_id"   uuid                              NOT NULL,
        "attachment_kind"      "service_request_attachment_kind" NOT NULL,
        "file_url"             text                              NOT NULL,
        "file_mime_type"       varchar(100)                      NOT NULL,
        "file_size_bytes"      integer                           NOT NULL,
        "caption"              text,
        "uploaded_by_user_id"  uuid                              NOT NULL,
        "created_at_utc"       timestamp with time zone          NOT NULL DEFAULT now(),
        "updated_at_utc"       timestamp with time zone          NOT NULL DEFAULT now(),
        "deleted_at_utc"       timestamp with time zone,
        CONSTRAINT "pk_service_request_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_sra_attach_service_request"
          FOREIGN KEY ("service_request_id")
          REFERENCES "service_requests"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_sra_attach_uploaded_by"
          FOREIGN KEY ("uploaded_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_sra_attach_service_request_id" ON "service_request_attachments" ("service_request_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_sra_attach_uploaded_by_user_id" ON "service_request_attachments" ("uploaded_by_user_id")`,
    );
    // Composite index supporting future "Avant/Après of a request" queries.
    await queryRunner.query(
      `CREATE INDEX "idx_sra_attach_request_kind" ON "service_request_attachments" ("service_request_id", "attachment_kind")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_sra_attach_request_kind"`);
    await queryRunner.query(`DROP INDEX "idx_sra_attach_uploaded_by_user_id"`);
    await queryRunner.query(`DROP INDEX "idx_sra_attach_service_request_id"`);
    await queryRunner.query(`DROP TABLE "service_request_attachments"`);
    await queryRunner.query(`DROP TYPE "service_request_attachment_kind"`);
  }
}
