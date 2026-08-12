import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records WHERE a service request's coordinate came from.
 *
 * The client-side request form degrades the location through three tiers and
 * never blocks the submit — geocoded address › search area › fixed Quebec
 * placeholder — and until now NOTHING in the database told the three apart. A
 * request sent behind "Envoyer quand même" was indistinguishable from one whose
 * address the client typed, saw geocoded, and picked from a candidate list.
 * Neither the client nor the provider could know.
 *
 * An enum rather than a boolean: the two fallbacks call for two different
 * sentences on screen, and a boolean would recreate in the database the very
 * flaw being repaired. The labels name the coordinate's PROVENANCE, not its
 * metric accuracy (see the enum's own doc, and CLAUDE.md §6).
 *
 * `DEFAULT 'UNKNOWN'` is deliberate: the default never claims precision. It is
 * what lets this ADD COLUMN be NOT NULL over existing rows, and it is the
 * safety net for any INSERT that omits the column. Note that the entity's
 * `default:` option is NOT that safety net and never executes — every read and
 * the INSERT go through raw SQL in `ServiceRequestRepository`, which bypasses
 * TypeORM's entity defaults entirely. Do not drop this PG default believing the
 * entity declaration covers it; it does not.
 *
 * Backfill: the existing rows are set to SEARCH_AREA. Their point came from the
 * URL coordinates (the area that was searched). Some of them may in fact have
 * been geocoded, but nothing on the row distinguishes them, so the pessimistic
 * label is chosen — never one that flatters the platform. On a fresh database
 * this UPDATE is a no-op.
 *
 * Written by hand, not generated: `migration:generate` in this repository emits
 * systematic FK-rename noise and is not trustworthy.
 *
 * `down()` drops the column and the type. The data loss is assumed and bounded:
 * this migration is what creates them, so nothing that predates it is
 * destroyed.
 */
export class AddServiceLocationPrecision1780500000000
  implements MigrationInterface
{
  name = 'AddServiceLocationPrecision1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "service_request_location_precision" AS ENUM (
        'GEOCODED',
        'SEARCH_AREA',
        'UNKNOWN'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ADD COLUMN "service_location_precision" "service_request_location_precision"
        NOT NULL DEFAULT 'UNKNOWN'
    `);

    // No-op on a fresh database; relabels the pre-existing rows otherwise.
    await queryRunner.query(`
      UPDATE "service_requests"
      SET "service_location_precision" = 'SEARCH_AREA'
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "service_requests"."service_location_precision" IS
        'Provenance of service_location, not its metric accuracy. GEOCODED does not mean exact (a city-level geocode is still GEOCODED). This DEFAULT is load-bearing: every read and the INSERT use raw SQL, so the TypeORM entity default never runs.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_requests"
      DROP COLUMN "service_location_precision"
    `);

    await queryRunner.query(`
      DROP TYPE "service_request_location_precision"
    `);
  }
}
