import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records that someone looked for a trade in an area and found nobody.
 *
 * Until now a search that returned zero left NO trace at all. The platform could
 * see what it had, never what it was missing — and on a marketplace starting
 * cold, what it is missing is the only thing that says where to go recruit.
 *
 * ⚠️ THIS TABLE HAS NO USER REFERENCE, AND THAT ABSENCE IS THE FEATURE. There is
 * no `user_id`, not even a nullable one, no foreign key to `users`, no IP, no
 * session fingerprint. A nullable column « we promise not to fill » is a promise;
 * a column that does not exist is a guarantee. As long as no link exists, a row
 * here is not personal information — which is precisely what lets the signal be
 * kept indefinitely with no retention clock to arbitrate, no access right to
 * tool, and no purge to write. DO NOT ADD ONE. Attaching an identity later is not
 * an increment of this table; it is a different table, with consent, under a
 * retention policy (tranche 2b).
 *
 * ⚠️ `numeric(4,2)` / `numeric(5,2)` ARE LOAD-BEARING, NOT COSMETIC. The scale of
 * 2 is what makes the coarseness STRUCTURAL: at scale 2 the column CANNOT hold a
 * finer value — PostgreSQL rounds on the way in — so even a caller that sent an
 * exact coordinate could not store one here. The service rounds explicitly as
 * well; this is the backstop under it, in the same spirit as the absent user
 * column. 0.01° is about 1.1 km north-south and about 0.76 km east-west at
 * Quebec's latitude, i.e. a neighbourhood-sized cell. Storing the exact point
 * would re-identify: one plumber searched at one address at one minute names a
 * person. A recruitment map wants a neighbourhood, never an address.
 *
 * The precision-4/5 figures are the range, not a second decision: latitude needs
 * 2 integer digits (-90..90), longitude needs 3 (-180..180), plus the 2 decimals.
 *
 * NO `deleted_at_utc` and NO `updated_at_utc`, and this is NOT an oversight of
 * the soft-delete-everywhere rule (CLAUDE.md §13). Nothing ever updates a row,
 * and there is no owner who could ask for one to be erased — the same
 * append-only-history reasoning already documented for `payments` and `refunds`.
 * Adding either by reflex would suggest a lifecycle that does not exist.
 *
 * ONE index, for the one query this table exists to answer: signals per trade
 * over a window. The precedent is `CreateNotifications1780390000000`, which also
 * shipped indexes for its intended read pattern at creation time.
 *
 * Written by hand, not generated: `migration:generate` in this repository emits
 * systematic FK-rename noise and is not trustworthy.
 *
 * `down()` drops the table. The data loss is assumed and bounded: this migration
 * is what creates the table, so nothing that predates it is destroyed. It is also
 * the one honest option here — the reverted schema has nowhere to put a row.
 */
export class CreateDemandSignals1780510000000 implements MigrationInterface {
  name = 'CreateDemandSignals1780510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "demand_signals" (
        "id"                    uuid          NOT NULL DEFAULT gen_random_uuid(),
        "service_category_id"   uuid          NOT NULL,
        "sector_lat"            numeric(4,2)  NOT NULL,
        "sector_lng"            numeric(5,2)  NOT NULL,
        "created_at_utc"        timestamptz   NOT NULL DEFAULT now(),

        CONSTRAINT "pk_demand_signals" PRIMARY KEY ("id"),

        CONSTRAINT "fk_demand_signals_service_category"
          FOREIGN KEY ("service_category_id")
          REFERENCES "service_categories" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_demand_signals_sector_lat"
          CHECK ("sector_lat" >= -90 AND "sector_lat" <= 90),

        CONSTRAINT "chk_demand_signals_sector_lng"
          CHECK ("sector_lng" >= -180 AND "sector_lng" <= 180)
      );
    `);

    // The only read pattern: signals for a trade over a period.
    await queryRunner.query(`
      CREATE INDEX "ix_demand_signals_category_created"
        ON "demand_signals" ("service_category_id", "created_at_utc" DESC);
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "demand_signals" IS
        'Anonymous demand signal: a search that returned zero providers. Deliberately carries NO user reference, no IP and no session id — the absence of any link is what keeps a row from being personal information, and what lets it be kept with no retention clock. Do not add one: an identified follow-up ("notify me") is a different table, with consent.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "demand_signals"."sector_lat" IS
        'Coarse sector, NOT the searched point. numeric(4,2) is load-bearing: at scale 2 the column cannot hold a finer value, so the coarseness survives a caller that sends an exact coordinate (~1.1 km cell).';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "demand_signals"."sector_lng" IS
        'Coarse sector, NOT the searched point. numeric(5,2) is load-bearing: at scale 2 the column cannot hold a finer value, so the coarseness survives a caller that sends an exact coordinate (~0.76 km at Quebec latitude).';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "demand_signals";`);
  }
}
