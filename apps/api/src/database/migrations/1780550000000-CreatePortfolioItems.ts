import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portfolio photos of a provider (P1).
 *
 * A photo is a FILE first and a row second. The row says where the file is
 * (`storage_key`), what it is after re-encoding (`content_type`, `width`,
 * `height`, `byte_size`) and where it sits in the provider's gallery
 * (`position`). The file itself never leaves the API by URL: the public read
 * streams it, and the browser only ever sees a relative web URL
 * (`/media/portfolio/{id}`).
 *
 * ⚠️ EVERY STORED VALUE DESCRIBES THE RE-ENCODED OUTPUT, NEVER THE UPLOAD.
 * Uploads are re-encoded to WebP with all metadata stripped (EXIF, GPS, XMP,
 * IPTC) before anything is written; the original bytes are never stored. So
 * `content_type` is always `image/webp` today and `width`/`height`/`byte_size`
 * are those of the file on disk — which is also what the image route sends as
 * `Content-Length`.
 *
 * ⚠️ NO UNIQUE CONSTRAINT ON `position`, ON PURPOSE. Reordering rewrites every
 * position of a provider in one transaction; a unique index would make that
 * rewrite collide with itself mid-statement and force a two-pass dance for no
 * gain. The display order is `position, created_at_utc`, so a tie (which the
 * API never produces) still reads deterministically.
 *
 * ⚠️ THE 12-PHOTO CEILING IS NOT A CONSTRAINT EITHER. A count cannot be
 * expressed as a CHECK; it is enforced by the service under a `SELECT … FOR
 * UPDATE` on the provider row, which serialises two concurrent uploads.
 *
 * Soft delete (`deleted_at_utc`) like everywhere else — BUT deleting a photo
 * also deletes the FILE in storage (Loi 25: the photo must stop existing). The
 * row survives as an inert record with a `storage_key` that points at nothing.
 *
 * `storage_key` is UNIQUE (not partial): the key embeds a fresh UUID, so a
 * collision would mean two rows claiming one file — exactly what deleting one
 * of them would turn into a broken image for the other.
 *
 * `service_provider_id` is `ON DELETE RESTRICT`, the repository's convention:
 * a provider carrying photos (even deleted ones) can no longer be hard-deleted.
 *
 * Written by hand, not generated: `migration:generate` in this repository emits
 * systematic FK-rename noise and is not trustworthy.
 *
 * `down()` drops the table. The data loss is assumed and bounded: this
 * migration is what creates the table. ⚠️ It does NOT delete the files under
 * `portfolio/` in storage — a migration has no access to storage. Reverting on
 * a database that holds photos leaves orphaned files to remove by hand.
 */
export class CreatePortfolioItems1780550000000 implements MigrationInterface {
  name = 'CreatePortfolioItems1780550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "portfolio_items" (
        "id"                   uuid          NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id"  uuid          NOT NULL,
        "storage_key"          text          NOT NULL,
        "caption"              varchar(140)  NULL,
        "position"             integer       NOT NULL,
        "content_type"         text          NOT NULL,
        "width"                integer       NOT NULL,
        "height"               integer       NOT NULL,
        "byte_size"            integer       NOT NULL,
        "created_at_utc"       timestamptz   NOT NULL DEFAULT now(),
        "updated_at_utc"       timestamptz   NOT NULL DEFAULT now(),
        "deleted_at_utc"       timestamptz   NULL,

        CONSTRAINT "pk_portfolio_items" PRIMARY KEY ("id"),

        CONSTRAINT "uq_portfolio_items_storage_key" UNIQUE ("storage_key"),

        CONSTRAINT "fk_portfolio_items_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_portfolio_items_caption_length"
          CHECK ("caption" IS NULL OR char_length("caption") BETWEEN 1 AND 140),

        CONSTRAINT "chk_portfolio_items_position"
          CHECK ("position" >= 0),

        CONSTRAINT "chk_portfolio_items_dimensions"
          CHECK ("width" > 0 AND "height" > 0 AND "byte_size" > 0)
      );
    `);

    // The one read this table exists for: a provider's live photos, in order.
    await queryRunner.query(`
      CREATE INDEX "ix_portfolio_items_provider_position_active"
        ON "portfolio_items" ("service_provider_id", "position")
        WHERE "deleted_at_utc" IS NULL;
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "portfolio_items" IS
        'Portfolio photos of a provider. Every value describes the RE-ENCODED file (WebP, metadata stripped), never the upload. At most 12 live rows per provider, enforced by the service under SELECT FOR UPDATE on the provider row (a count cannot be a CHECK). No unique constraint on position, on purpose (reordering rewrites them all). Soft-deleted, AND the file is deleted from storage at the same time (Loi 25).';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "portfolio_items"."storage_key" IS
        'Relative storage key, portfolio/{providerId}/{uuid}.webp. NEVER exposed in any response: the public read streams the file, and the browser only sees /media/portfolio/{id} on the web origin. Points at nothing once the row is soft-deleted (the file is deleted with it).';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "portfolio_items"."caption" IS
        'Trimmed before storage; an empty caption is stored as NULL, never as ''''. The CHECK mirrors PORTFOLIO_CAPTION_MAX = 140.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "portfolio_items"."position" IS
        'Display order, 0-based. Not unique on purpose; ties read by created_at_utc. A new photo goes at max + 1; reordering rewrites the provider''s live rows to 0..n-1.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "portfolio_items";`);
  }
}
