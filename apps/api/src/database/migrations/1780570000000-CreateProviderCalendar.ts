import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Provider calendar: opening hours, blocked periods and the iCal feed token.
 *
 * Two tables. APPOINTMENTS ARE NOT STORED HERE: they are read live from
 * `service_requests` (and the accepted quote of a tender), so the calendar can
 * never disagree with the dashboard about what a provider has to do.
 *
 * ── `provider_calendars` — one row per provider, created on first write ──────
 *
 * `weekly_hours` is the published weekly schedule, a JSONB array of
 * `{ weekday, startMinute, endMinute }` in WALL TIME of `time_zone` (ISO
 * weekday, 1 = Monday; minutes after local midnight, quarter-hours). JSONB and
 * not a child table, on purpose: the schedule is always read and replaced as a
 * WHOLE, so a row per range would only buy a delete-and-reinsert on every save
 * — and « never hard DELETE » (§13) would turn that into a pile of dead rows.
 * An UPDATE of one row is an edit, like editing a bio. The service validates
 * the content (`normaliseWeeklyHours`); the CHECK only pins the JSON type.
 *
 * `time_zone` is an IANA NAME, never an offset: « America/Toronto » is UTC−5
 * half the year and UTC−4 the other half, and a stored offset would publish
 * every summer opening hour one hour late.
 *
 * ⚠️ `feed_token_hash` IS A SHA-256, NEVER THE TOKEN. The feed URL is a bearer
 * secret (a calendar app cannot send a session), so it is treated like the
 * reset and verification tokens: shown ONCE when generated, stored hashed.
 * Regenerating replaces the hash, which is what kills the old URL. The unique
 * index is what makes the lookup by hash a single-row read.
 *
 * NO `deleted_at_utc`, and that is not an oversight: the row is a settings row,
 * 1:1 with its provider, mutated in place and never removed. Every read joins
 * the provider and requires it to be live — a soft-deleted provider has no
 * calendar, no availability and no feed, without anything to cascade.
 *
 * ── `provider_time_off` — blocked periods ───────────────────────────────────
 *
 * A period during which the provider takes no appointment (vacation, a
 * personal errand). Soft-deleted like everything else. `label` is PRIVATE: it
 * is the provider's own note and is never part of the public availability,
 * which only ever exposes free time.
 *
 * The ceiling on upcoming periods (TIME_OFF_MAX_UPCOMING) is not a constraint:
 * a count cannot be a CHECK. It is enforced by the service under `SELECT … FOR
 * UPDATE` on the provider row, the same lock the portfolio uses.
 *
 * Both FKs are `ON DELETE RESTRICT`, the repository's convention.
 *
 * Written by hand, not generated: `migration:generate` in this repository
 * emits systematic FK-rename noise and is not trustworthy.
 *
 * `down()` drops both tables. The data loss is assumed and bounded: this
 * migration is what creates them, nothing earlier is destroyed.
 */
export class CreateProviderCalendar1780570000000 implements MigrationInterface {
  name = 'CreateProviderCalendar1780570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "provider_calendars" (
        "id"                         uuid          NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id"        uuid          NOT NULL,
        "time_zone"                  varchar(64)   NOT NULL DEFAULT 'America/Toronto',
        "weekly_hours"               jsonb         NOT NULL DEFAULT '[]'::jsonb,
        "feed_token_hash"            char(64)      NULL,
        "feed_token_created_at_utc"  timestamptz   NULL,
        "created_at_utc"             timestamptz   NOT NULL DEFAULT now(),
        "updated_at_utc"             timestamptz   NOT NULL DEFAULT now(),

        CONSTRAINT "pk_provider_calendars" PRIMARY KEY ("id"),

        CONSTRAINT "uq_provider_calendars_provider" UNIQUE ("service_provider_id"),

        CONSTRAINT "fk_provider_calendars_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_provider_calendars_weekly_hours_array"
          CHECK (jsonb_typeof("weekly_hours") = 'array'),

        CONSTRAINT "chk_provider_calendars_feed_token_paired"
          CHECK (("feed_token_hash" IS NULL) = ("feed_token_created_at_utc" IS NULL))
      );
    `);

    // The feed lookup: one row by token hash. Partial — most rows have no feed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_provider_calendars_feed_token_hash"
        ON "provider_calendars" ("feed_token_hash")
        WHERE "feed_token_hash" IS NOT NULL;
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "provider_calendars" IS
        'Calendar settings of a provider, one row each, created on first write: time zone, published weekly opening hours, iCal feed token hash. Appointments are NOT stored here: they are read live from service_requests. No deleted_at_utc on purpose (settings row mutated in place); every read requires the provider to be live.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "provider_calendars"."time_zone" IS
        'IANA zone NAME (never an offset): the wall clock weekly_hours is expressed in.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "provider_calendars"."weekly_hours" IS
        'Published weekly schedule: JSON array of {weekday, startMinute, endMinute}. ISO weekday (1 = Monday), minutes after local midnight in time_zone, quarter-hours, no overlap within a day. Validated by the service (normaliseWeeklyHours); an empty array means no schedule is published.';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "provider_calendars"."feed_token_hash" IS
        'SHA-256 (hex) of the iCal feed token. The token itself is shown once and never stored. NULL = no feed. Replaced on regeneration, which revokes the previous URL.';
    `);

    await queryRunner.query(`
      CREATE TABLE "provider_time_off" (
        "id"                   uuid          NOT NULL DEFAULT gen_random_uuid(),
        "service_provider_id"  uuid          NOT NULL,
        "starts_at_utc"        timestamptz   NOT NULL,
        "ends_at_utc"          timestamptz   NOT NULL,
        "label"                varchar(80)   NULL,
        "created_at_utc"       timestamptz   NOT NULL DEFAULT now(),
        "updated_at_utc"       timestamptz   NOT NULL DEFAULT now(),
        "deleted_at_utc"       timestamptz   NULL,

        CONSTRAINT "pk_provider_time_off" PRIMARY KEY ("id"),

        CONSTRAINT "fk_provider_time_off_service_provider"
          FOREIGN KEY ("service_provider_id")
          REFERENCES "service_providers" ("id") ON DELETE RESTRICT,

        CONSTRAINT "chk_provider_time_off_period"
          CHECK ("ends_at_utc" > "starts_at_utc"),

        CONSTRAINT "chk_provider_time_off_label_length"
          CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 80)
      );
    `);

    // The reads this table exists for: a provider's live periods overlapping a
    // window, which is a filter on the END first (« not over yet »).
    await queryRunner.query(`
      CREATE INDEX "ix_provider_time_off_provider_ends_active"
        ON "provider_time_off" ("service_provider_id", "ends_at_utc")
        WHERE "deleted_at_utc" IS NULL;
    `);

    await queryRunner.query(`
      COMMENT ON TABLE "provider_time_off" IS
        'Blocked periods of a provider (no appointment taken). Soft-deleted. At most 50 live periods not yet over per provider, enforced by the service under SELECT FOR UPDATE on the provider row (a count cannot be a CHECK).';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "provider_time_off"."label" IS
        'PRIVATE note of the provider. Never part of the public availability, which exposes free time only. Trimmed; an empty label is stored as NULL. The CHECK mirrors TIME_OFF_LABEL_MAX = 80.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_time_off";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_calendars";`);
  }
}
