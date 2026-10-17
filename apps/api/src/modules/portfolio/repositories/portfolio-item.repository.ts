import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PORTFOLIO_MAX_ITEMS } from '../constants';
import { PortfolioItem } from '../entities/portfolio-item.entity';

/** A live portfolio photo, as the service needs it. `storageKey` never leaves the API. */
export interface PortfolioItemRecord {
  id: string;
  serviceProviderId: string;
  storageKey: string;
  caption: string | null;
  position: number;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

/** What the service hands over once the file is processed AND stored. */
export interface CreatePortfolioItemData {
  serviceProviderId: string;
  storageKey: string;
  caption: string | null;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}

/** Outcome of the capped insert: the row, or the cap that refused it. */
export type InsertUnderCapResult =
  | { inserted: true; item: PortfolioItemRecord }
  | { inserted: false; reason: 'LIMIT_REACHED' | 'PROVIDER_GONE' };

interface RawRow {
  id: string;
  service_provider_id: string;
  storage_key: string;
  caption: string | null;
  position: number;
  content_type: string;
  width: number;
  height: number;
  byte_size: number;
  created_at_utc: Date;
  updated_at_utc: Date;
}

const SELECT_COLUMNS = `
  id, service_provider_id, storage_key, caption, position, content_type,
  width, height, byte_size, created_at_utc, updated_at_utc`;

/** Display order — `position` first, `created_at_utc` breaks the (never produced) ties, `id` makes it total. */
const DISPLAY_ORDER = `position ASC, created_at_utc ASC, id ASC`;

/**
 * The `[rows, affected]` quirk of TypeORM's raw `.query()` on an `UPDATE …
 * RETURNING` under the postgres driver — a local copy, like the six others in
 * this repository (`updateReturningRows`, chore tracked in §6). Without it,
 * `rows.length` is 2 on ZERO rows touched, and « not yours » would read as
 * « deleted ».
 */
function updateReturningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

@Injectable()
export class PortfolioItemRepository {
  constructor(
    @InjectRepository(PortfolioItem)
    private readonly repo: Repository<PortfolioItem>,
  ) {}

  private static map(row: RawRow): PortfolioItemRecord {
    return {
      id: row.id,
      serviceProviderId: row.service_provider_id,
      storageKey: row.storage_key,
      caption: row.caption,
      position: Number(row.position),
      contentType: row.content_type,
      width: Number(row.width),
      height: Number(row.height),
      byteSize: Number(row.byte_size),
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
    };
  }

  /** A provider's live photos, in display order. */
  async findLiveByProvider(providerId: string): Promise<PortfolioItemRecord[]> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM portfolio_items
       WHERE service_provider_id = $1 AND deleted_at_utc IS NULL
       ORDER BY ${DISPLAY_ORDER}`,
      [providerId],
    );
    return rows.map((r) => PortfolioItemRepository.map(r));
  }

  /** A live photo by id, whoever owns it (public image route, admin). */
  async findLiveById(id: string): Promise<PortfolioItemRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM portfolio_items
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? PortfolioItemRepository.map(rows[0]) : null;
  }

  /**
   * A live photo by id, ONLY if it belongs to this provider. Someone else's
   * photo reads exactly like a missing one — the caller answers 404, never 403.
   */
  async findLiveByIdForProvider(
    id: string,
    providerId: string,
  ): Promise<PortfolioItemRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM portfolio_items
       WHERE id = $1 AND service_provider_id = $2 AND deleted_at_utc IS NULL`,
      [id, providerId],
    );
    return rows.length ? PortfolioItemRepository.map(rows[0]) : null;
  }

  /** Live photo count, unlocked — the cheap early refusal before any processing. */
  async countLive(providerId: string): Promise<number> {
    const rows: Array<{ count: string }> = await this.repo.query(
      `SELECT count(*)::text AS count FROM portfolio_items
       WHERE service_provider_id = $1 AND deleted_at_utc IS NULL`,
      [providerId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Locks the PROVIDER row for the rest of the transaction.
   *
   * ⚠️ THIS IS WHAT MAKES THE 12-PHOTO CEILING HOLD UNDER CONCURRENCY. Counting
   * the photos is not enough: two transactions at 11 both count 11, both insert,
   * and the provider ends at 13 — a count is not a lock, and there is no row to
   * lock that does not exist yet. So every writer of this provider's portfolio
   * (insert, reorder) first takes `FOR UPDATE` on the one row they all share:
   * the provider. The second upload waits, then counts 12, then refuses.
   *
   * It reads `service_providers` from this module — a lock on the owner row,
   * not a second avis on providers: nothing is decided from what it returns
   * besides « it still exists ».
   */
  private async lockProvider(
    manager: EntityManager,
    providerId: string,
  ): Promise<boolean> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM service_providers
       WHERE id = $1 AND deleted_at_utc IS NULL
       FOR UPDATE`,
      [providerId],
    );
    return rows.length > 0;
  }

  /**
   * Inserts one photo at `max(position) + 1`, refusing past PORTFOLIO_MAX_ITEMS.
   * Lock, count, position and insert happen in ONE transaction: the count read
   * after the lock is the count the insert is decided on.
   */
  async insertUnderCap(data: CreatePortfolioItemData): Promise<InsertUnderCapResult> {
    return this.repo.manager.transaction(async (manager) => {
      if (!(await this.lockProvider(manager, data.serviceProviderId))) {
        return { inserted: false, reason: 'PROVIDER_GONE' } as const;
      }

      const stats: Array<{ count: string; next_position: string }> = await manager.query(
        `SELECT count(*)::text AS count,
                COALESCE(MAX(position) + 1, 0)::text AS next_position
         FROM portfolio_items
         WHERE service_provider_id = $1 AND deleted_at_utc IS NULL`,
        [data.serviceProviderId],
      );
      if (Number(stats[0].count) >= PORTFOLIO_MAX_ITEMS) {
        return { inserted: false, reason: 'LIMIT_REACHED' } as const;
      }

      const rows: RawRow[] = await manager.query(
        `INSERT INTO portfolio_items
           (service_provider_id, storage_key, caption, position, content_type,
            width, height, byte_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLUMNS}`,
        [
          data.serviceProviderId,
          data.storageKey,
          data.caption,
          Number(stats[0].next_position),
          data.contentType,
          data.width,
          data.height,
          data.byteSize,
        ],
      );
      return { inserted: true, item: PortfolioItemRepository.map(rows[0]) } as const;
    });
  }

  /** Sets the caption of a live photo of this provider. Null if none matched. */
  async updateCaption(
    id: string,
    providerId: string,
    caption: string | null,
  ): Promise<PortfolioItemRecord | null> {
    const result: unknown = await this.repo.query(
      `UPDATE portfolio_items
       SET caption = $3, updated_at_utc = now()
       WHERE id = $1 AND service_provider_id = $2 AND deleted_at_utc IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [id, providerId, caption],
    );
    const rows = updateReturningRows<RawRow>(result);
    return rows.length ? PortfolioItemRepository.map(rows[0]) : null;
  }

  /**
   * Rewrites the provider's positions to 0..n-1 following `ids`, ONLY if `ids`
   * is exactly the set of its live photos. Under the same provider lock as the
   * insert, so a reorder and an upload cannot interleave (an upload landing
   * between the check and the write would otherwise keep a stale position).
   *
   * Returns false — and writes nothing — when the set does not match.
   */
  async reorder(providerId: string, ids: string[]): Promise<boolean> {
    return this.repo.manager.transaction(async (manager) => {
      if (!(await this.lockProvider(manager, providerId))) return false;

      const live: Array<{ id: string }> = await manager.query(
        `SELECT id FROM portfolio_items
         WHERE service_provider_id = $1 AND deleted_at_utc IS NULL`,
        [providerId],
      );
      const liveIds = new Set(live.map((r) => r.id));
      const requested = new Set(ids);
      const exactSet =
        ids.length === liveIds.size &&
        requested.size === ids.length &&
        ids.every((id) => liveIds.has(id));
      if (!exactSet) return false;

      if (ids.length > 0) {
        await manager.query(
          `UPDATE portfolio_items AS p
           SET position = v.ord - 1, updated_at_utc = now()
           FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, ord)
           WHERE p.id = v.id AND p.service_provider_id = $2
             AND p.deleted_at_utc IS NULL`,
          [ids, providerId],
        );
      }
      return true;
    });
  }

  /**
   * Soft-deletes a live photo and returns it (with its storage key, so the
   * caller can delete the FILE). Null if it was not live — already deleted,
   * unknown, or (with `providerId`) someone else's.
   */
  async softDelete(id: string, providerId?: string): Promise<PortfolioItemRecord | null> {
    const params: string[] = [id];
    let ownerClause = '';
    if (providerId !== undefined) {
      params.push(providerId);
      ownerClause = 'AND service_provider_id = $2';
    }
    const result: unknown = await this.repo.query(
      `UPDATE portfolio_items
       SET deleted_at_utc = now(), updated_at_utc = now()
       WHERE id = $1 ${ownerClause} AND deleted_at_utc IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      params,
    );
    const rows = updateReturningRows<RawRow>(result);
    return rows.length ? PortfolioItemRepository.map(rows[0]) : null;
  }
}
