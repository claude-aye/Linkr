import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reviews — the first object in this project whose SUBJECT IS NOT ITS AUTHOR.
 *
 * Everything stored so far described the person who produced it: their request,
 * their profile, their payment method. A review is personal data ABOUT A THIRD
 * PARTY, it is near-irreversible in its effects (deleted, it has already been
 * read), and it is asymmetric — an unhappy client costs a tradesperson weeks of
 * revenue in thirty seconds, and the tradesperson is the side of the marketplace
 * that has to be recruited first. Every choice below is governed by that.
 *
 * ⚠️ A REVIEW IS UNFALSIFIABLE BY CONSTRUCTION, AND THAT IS WHY THIS TABLE NEEDS
 * NO MODERATION. Decision D-1: only the client of a request that reached
 * COMPLETED may write one, and only about the provider of that request. Both
 * ends are FKs onto a row the reviewer cannot fabricate — reaching COMPLETED
 * takes an assignment, a provider marking the job done, and a state machine that
 * refuses shortcuts. A fake review cannot exist, so no filter has to be invented
 * to remove one. Do not "improve" this into a free-standing review table keyed
 * by (client, provider): that is the version that needs moderation.
 *
 * ⚠️ `rating` IS `smallint` WITH A `CHECK` — NEVER A FLOAT (D-5). Same reasoning
 * as `demand_signals`' `numeric(4,2)`: what cannot be represented cannot happen.
 * One honest nuance, measured rather than assumed: the CHECK rejects 0 and 6,
 * but PostgreSQL COERCES `3.5` into a smallint (rounding it to 4) before any
 * CHECK runs, so the column alone does not reject a fractional rating — the API
 * DTO's `@IsInt()` does, with a 400. Both layers are exercised in the PR. A
 * `numeric` column with a scale CHECK would reject 3.5 in the database, and is
 * exactly the float this decision forbids.
 *
 * ⚠️ THE PROVIDER'S REPLY IS A COLUMN ON THIS ROW, NOT A SECOND ENTITY (D-2),
 * AND IT IS POSED NOW EVEN THOUGH NOTHING WRITES IT UNTIL TRANCHE 2. Two
 * properties become facts of the schema instead of rules someone has to enforce:
 * "at most one reply" is `NULL`-or-a-value on a single column, and "deleting a
 * review takes its reply with it" (D-3) is a property of soft-deleting the ROW —
 * there is no cascade to write, and therefore none to forget. Posing the column
 * later would have made that second property a claim in a comment for as long as
 * the column was missing; posing it now makes it true of every row that ever
 * exists. It is deliberately absent from the response DTOs until tranche 2 adds
 * the endpoint — a contract should not carry a field that nothing can fill.
 *
 * ⚠️ THE UNIQUE INDEX IS PARTIAL ON `deleted_at_utc IS NULL` — THE EXACT SHAPE
 * THAT PRODUCED THE `REJECTED` DEAD-END MEASURED IN SESSION 4
 * (`ux_psc_provider_category_active`), AND HERE IT IS THE RIGHT ONE. What
 * differs is not the index, it is whether an exit exists. There, a claim turned
 * `REJECTED` can never be re-claimed because soft-deleting it is offered to
 * nobody, so the 409 is a dead end. Here, deletion is A RIGHT OF THE AUTHOR,
 * exposed as `DELETE /reviews/:id` in this same PR — so "delete, then write a
 * new one" is the path that replaces the editing D-3 forbids, and the 409 is a
 * door rather than a wall. That is also why the brief refuses to ship the write
 * without the delete: shipping them apart would open a window in which the same
 * index IS the session-4 trap.
 *
 * ⚠️ THE KEY IS THE REQUEST, NOT THE (CLIENT, PROVIDER) PAIR. A client who books
 * the same hairdresser five times rates them five times; each transaction is its
 * own object, and the request is the natural key.
 *
 * The average and the count are NOT stored here and must not be added to
 * `service_providers` (D-4 / brief §5): they are computed at read time, in SQL,
 * with the soft-deleted rows excluded inside the aggregate rather than by a
 * filter the caller could forget. A denormalized counter drifts the moment an
 * exclusion is added to it — and there already is one.
 *
 * ⚠️ CONSEQUENCE TO STATE OUT LOUD: both FKs are `ON DELETE RESTRICT` (the
 * repository's convention), so a COMPLETED request carrying a review, and the
 * provider it names, can never be hard-deleted again. That is coherent with the
 * rest of the codebase — soft delete everywhere, §13 — and it adds two more
 * members to the family of locked rows (`SONDE-*` / `SMOKE-*` notifications
 * already live there).
 *
 * Written by hand, not generated: `migration:generate` in this repository emits
 * systematic FK-rename noise and is not trustworthy.
 *
 * `down()` drops the table. The data loss is assumed and bounded: this migration
 * is what creates the table, so nothing that predates it is destroyed, and the
 * reverted schema has nowhere to put a row.
 */
export class CreateReviews1780520000000 implements MigrationInterface {
  name = 'CreateReviews1780520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "id"                        uuid          NOT NULL DEFAULT gen_random_uuid(),
        "service_request_id"        uuid          NOT NULL,
        "service_provider_id"       uuid          NOT NULL,
        "author_user_id"            uuid          NOT NULL,
        "rating"                    smallint      NOT NULL,
        "comment"                   text          NULL,
        "provider_response"         text          NULL,
        "provider_responded_at_utc" timestamptz   NULL,
        "created_at_utc"            timestamptz   NOT NULL DEFAULT now(),
        "updated_at_utc"            timestamptz   NOT NULL DEFAULT now(),
        "deleted_at_utc"            timestamptz   NULL,

        CONSTRAINT "pk_reviews" PRIMARY KEY ("id"),

        CONSTRAINT "fk_reviews_service_request"
          FOREIGN KEY ("service_request_id")
          REFERENCES "service_requests" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_reviews_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "fk_reviews_author_user"
          FOREIGN KEY ("author_user_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_reviews_rating_range"
          CHECK ("rating" >= 1 AND "rating" <= 5),

        CONSTRAINT "chk_reviews_comment_length"
          CHECK ("comment" IS NULL OR char_length(btrim("comment")) BETWEEN 1 AND 2000),

        CONSTRAINT "chk_reviews_response_length"
          CHECK ("provider_response" IS NULL OR char_length(btrim("provider_response")) BETWEEN 1 AND 2000),

        CONSTRAINT "chk_reviews_response_paired"
          CHECK (num_nonnulls("provider_response", "provider_responded_at_utc") <> 1)
      );
    `);

    // One live review per request (D-1 / brief §4). PARTIAL on the soft-delete
    // column, so the author's own deletion frees the slot — the exit that makes
    // this shape safe here and a dead end in `ux_psc_provider_category_active`.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_reviews_request_active"
        ON "reviews" ("service_request_id")
        WHERE "deleted_at_utc" IS NULL;
    `);

    // The one read this table exists for: a provider's reviews, newest first,
    // deleted rows excluded — the aggregate runs over exactly this set.
    await queryRunner.query(`
      CREATE INDEX "ix_reviews_provider_active"
        ON "reviews" ("service_provider_id", "created_at_utc" DESC)
        WHERE "deleted_at_utc" IS NULL;
    `);

    // The author's own reviews — the predicate behind DELETE /reviews/:id.
    await queryRunner.query(`
      CREATE INDEX "ix_reviews_author_active"
        ON "reviews" ("author_user_id")
        WHERE "deleted_at_utc" IS NULL;
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "reviews" IS
        'One review per COMPLETED service request, written by that request''s client about that request''s provider (D-1). Unfalsifiable by construction: both ends are FKs onto a row the reviewer cannot fabricate, which is why no moderation surface exists. Soft-deleted by its author (D-3); the provider reply is a column on this row (D-2), so deleting the review takes the reply with it with no cascade to write. The rating average and count are NEVER stored — they are computed at read time with deleted rows excluded inside the aggregate (D-4).';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "reviews"."rating" IS
        'Integer 1..5, never a float (D-5). The CHECK rejects 0 and 6; note that PostgreSQL COERCES a fractional input into smallint (3.5 becomes 4) BEFORE any CHECK runs, so a non-integer is rejected one layer up, by the DTO''s @IsInt() (400). No sub-ratings: not a column, not a table, not a preparation.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "reviews"."service_provider_id" IS
        'The provider being reviewed. Resolved SERVER-SIDE from service_requests.assigned_service_provider_id at write time and never accepted from the request body. This is not a denormalized label in the sense CLAUDE.md forbids: it records WHO WAS REVIEWED, an immutable historical fact, so it must not follow a later re-assignment of the request.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "reviews"."provider_response" IS
        'The provider''s single reply (D-2). A COLUMN, never a second entity: "at most one reply" is then a property of the schema, and "deleting a review takes its reply with it" (D-3) is a property of soft-deleting the row. Posed by migration 1780520000000; nothing writes it until tranche 2, and it is deliberately absent from the response DTOs until then.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "reviews"."deleted_at_utc" IS
        'Soft delete, exercised by the AUTHOR (D-3). Load-bearing twice over: it is the predicate of the partial unique index (deleting frees the slot, so "delete then rewrite" replaces the editing D-3 forbids), and it is what the rating aggregate excludes.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "reviews";`);
  }
}
