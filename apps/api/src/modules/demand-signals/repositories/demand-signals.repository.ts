import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemandSignal } from '../entities/demand-signal.entity';

/**
 * Everything a demand signal row is made of. There is no recipient, no author
 * and no owner — see the entity and migration 1780510000000 for why that absence
 * is the design and not a gap.
 *
 * `sectorLat` / `sectorLng` are ALREADY ROUNDED by the caller. The service
 * rounds; this interface only carries the result. Passing an exact coordinate
 * here would still be caught by the column scale, but the intent belongs
 * upstream, next to the coordinate's only other use.
 */
export interface CreateDemandSignalData {
  serviceCategoryId: string;
  sectorLat: number;
  sectorLng: number;
}

/**
 * One cell of the recruitment map: a trade, a coarse sector, a count, and the
 * span of days it covers.
 *
 * ⚠️ THERE IS NO RECORD OF AN INDIVIDUAL SIGNAL IN THIS FILE, AND THERE MUST NOT
 * BE ONE. Session 6 made anonymity structural by giving the table no user
 * reference; a read layer can undo that without touching a single column, and
 * that is the only real risk of exposing this table. A `findAll()` returning raw
 * rows — even « just to debug » — would put microsecond timestamps (`created_at_utc`
 * is precise to `16:54:01.099401`) next to a trade on the wire, and a microsecond
 * timestamp is a correlation key: cross-referenced with a server log or a known
 * session it re-attaches the row to the person the missing `user_id` protected.
 * The aggregation therefore happens IN SQL, before anything leaves the database.
 *
 * It is also the shape the use needs: « twelve searches for esthetics around
 * 48.45 / -68.53 this month » is actionable; twelve timestamped rows are not.
 */
export interface DemandSignalSummaryRecord {
  serviceCategoryId: string;
  serviceCategoryNameTranslations: Record<string, string>;
  sectorLat: number;
  sectorLng: number;
  signalCount: number;
  /** UTC day, `YYYY-MM-DD`. Never a clock time. */
  firstSeenDate: string;
  /** UTC day, `YYYY-MM-DD`. Never a clock time. */
  lastSeenDate: string;
}

interface RawSummaryRow {
  service_category_id: string;
  service_category_name_translations: Record<string, string>;
  sector_lat: number;
  sector_lng: number;
  signal_count: number;
  first_seen_date: string;
  last_seen_date: string;
  total_sectors: number;
  total_signals: number;
}

@Injectable()
export class DemandSignalsRepository {
  constructor(
    @InjectRepository(DemandSignal)
    private readonly repo: Repository<DemandSignal>,
  ) {}

  /**
   * Appends one signal. No transaction: a single row is already atomic and,
   * unlike a fan-out, it has no sibling row it must land with.
   *
   * Raw SQL with an explicit column list, like the rest of this codebase —
   * which also sidesteps the `numeric`-is-a-string dance TypeORM would impose
   * on a typed insert for a column nothing reads.
   */
  async insertOne(data: CreateDemandSignalData): Promise<void> {
    await this.repo.query(
      `INSERT INTO demand_signals (service_category_id, sector_lat, sector_lng)
       VALUES ($1, $2, $3)`,
      [data.serviceCategoryId, data.sectorLat, data.sectorLng],
    );
  }
  /**
   * The recruitment map, aggregated in the database.
   *
   * ONE round trip, and one row per (trade × sector) cell — never one per
   * signal. Read the comment on {@link DemandSignalSummaryRecord} before
   * loosening anything here.
   *
   * ⚠️ THE DAY TRUNCATION IS EXPLICIT AND UTC-PINNED. `AT TIME ZONE 'UTC'`
   * rather than a bare `date_trunc`: `created_at_utc` is a `timestamptz`, so
   * truncating it without naming a zone silently follows the session `TimeZone`
   * and would drift between a developer machine and the server. `to_char` then
   * yields a plain `YYYY-MM-DD` string, which is also what the DTO promises —
   * no `Date` object can carry a clock time back into the response by accident.
   *
   * ⚠️ `totalSectors` / `totalSignals` ride along as WINDOW FUNCTIONS, which are
   * evaluated after `GROUP BY` but BEFORE `LIMIT` — so both describe the whole
   * map, not the page, and the cap cannot make them lie. Zero rows ⇒ no row to
   * read them from ⇒ both are 0, which is the right answer. Same pattern as
   * `NotificationsRepository.findForRecipient`.
   *
   * ⚠️ THE JOIN IS NOT FILTERED ON `sc.deleted_at_utc`, deliberately. The FK is
   * `ON DELETE RESTRICT` and the column is NOT NULL, so the category row always
   * exists and an INNER JOIN can never make a cell vanish; but a trade retired
   * from the catalogue keeps its history here, and how many people looked for it
   * is exactly the kind of thing a recruitment map exists to answer.
   *
   * Ordering: busiest cell first, then most recent, then a stable tiebreaker on
   * the group key itself — cells with equal counts and equal last-seen days must
   * not shuffle between two loads of the same page.
   */
  async findSectorSummary(limit: number): Promise<{
    items: DemandSignalSummaryRecord[];
    totalSectors: number;
    totalSignals: number;
  }> {
    const rows: RawSummaryRow[] = await this.repo.query(
      `SELECT
         sc.id                        AS service_category_id,
         sc.name_translations         AS service_category_name_translations,
         (ds.sector_lat)::float8      AS sector_lat,
         (ds.sector_lng)::float8      AS sector_lng,
         (COUNT(*))::int              AS signal_count,
         to_char(MIN(ds.created_at_utc) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS first_seen_date,
         to_char(MAX(ds.created_at_utc) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_seen_date,
         (COUNT(*) OVER ())::int      AS total_sectors,
         (SUM(COUNT(*)) OVER ())::int AS total_signals
       FROM demand_signals ds
       JOIN service_categories sc ON sc.id = ds.service_category_id
       GROUP BY sc.id, ds.sector_lat, ds.sector_lng
       ORDER BY COUNT(*) DESC,
                MAX(ds.created_at_utc) DESC,
                sc.id,
                ds.sector_lat,
                ds.sector_lng
       LIMIT $1`,
      [limit],
    );

    return {
      items: rows.map((row) => ({
        serviceCategoryId: row.service_category_id,
        serviceCategoryNameTranslations: row.service_category_name_translations,
        sectorLat: row.sector_lat,
        sectorLng: row.sector_lng,
        signalCount: row.signal_count,
        firstSeenDate: row.first_seen_date,
        lastSeenDate: row.last_seen_date,
      })),
      totalSectors: rows.length ? rows[0].total_sectors : 0,
      totalSignals: rows.length ? rows[0].total_signals : 0,
    };
  }
}
