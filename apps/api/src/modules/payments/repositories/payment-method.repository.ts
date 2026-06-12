import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentMethod } from '../entities/payment-method.entity';
import { PaymentMethodType } from '../enums/payment-method-type.enum';

/** Domain record — snake_case columns mapped to camelCase. */
export interface PaymentMethodRecord {
  id: string;
  ownerUserId: string | null;
  ownerOrganizationId: string | null;
  stripePaymentMethodId: string;
  type: PaymentMethodType;
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAtUtc: Date;
  deletedAtUtc: Date | null;
}

export interface CreateUserPaymentMethodData {
  ownerUserId: string;
  stripePaymentMethodId: string;
  type: PaymentMethodType;
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

interface RawRow {
  id: string;
  owner_user_id: string | null;
  owner_organization_id: string | null;
  stripe_payment_method_id: string;
  type: PaymentMethodType;
  brand: string | null;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
  created_at_utc: Date;
  deleted_at_utc: Date | null;
}

const SELECT_COLUMNS = `
  id, owner_user_id, owner_organization_id, stripe_payment_method_id, type,
  brand, last4, exp_month, exp_year, is_default, created_at_utc, deleted_at_utc
`;

function mapRow(row: RawRow): PaymentMethodRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerOrganizationId: row.owner_organization_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
    type: row.type,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    isDefault: row.is_default,
    createdAtUtc: row.created_at_utc,
    deletedAtUtc: row.deleted_at_utc,
  };
}

@Injectable()
export class PaymentMethodRepository {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly repo: Repository<PaymentMethod>,
    private readonly dataSource: DataSource,
  ) {}

  /** A single live (non-deleted) method by id. */
  async findLiveById(id: string): Promise<PaymentMethodRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM payment_methods
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** The user's current default method (live), if any. */
  async findDefaultByUserId(userId: string): Promise<PaymentMethodRecord | null> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM payment_methods
       WHERE owner_user_id = $1 AND is_default = true AND deleted_at_utc IS NULL
       LIMIT 1`,
      [userId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** All of the user's live methods, default first then newest. */
  async listByUserId(userId: string): Promise<PaymentMethodRecord[]> {
    const rows: RawRow[] = await this.repo.query(
      `SELECT ${SELECT_COLUMNS} FROM payment_methods
       WHERE owner_user_id = $1 AND deleted_at_utc IS NULL
       ORDER BY is_default DESC, created_at_utc DESC`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async countByUserId(userId: string): Promise<number> {
    const rows: Array<{ count: string }> = await this.repo.query(
      `SELECT COUNT(*) AS count FROM payment_methods
       WHERE owner_user_id = $1 AND deleted_at_utc IS NULL`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  }

  /**
   * Insert a user-owned method. When `isDefault`, the existing default (if any)
   * is unset in the same transaction so the partial-unique default index holds.
   */
  async createForUser(
    data: CreateUserPaymentMethodData,
  ): Promise<PaymentMethodRecord> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      if (data.isDefault) {
        await qr.manager.query(
          `UPDATE payment_methods SET is_default = false
           WHERE owner_user_id = $1 AND is_default = true AND deleted_at_utc IS NULL`,
          [data.ownerUserId],
        );
      }
      const rows: RawRow[] = await qr.manager.query(
        `INSERT INTO payment_methods
           (owner_user_id, stripe_payment_method_id, type, brand, last4,
            exp_month, exp_year, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SELECT_COLUMNS}`,
        [
          data.ownerUserId,
          data.stripePaymentMethodId,
          data.type,
          data.brand,
          data.last4,
          data.expMonth,
          data.expYear,
          data.isDefault,
        ],
      );
      await qr.commitTransaction();
      return mapRow(rows[0]);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  /**
   * Make `pmId` the user's default and unset every sibling, atomically.
   * Both statements are scoped to the owner so the operation is a no-op if the
   * method is not the user's. Returns the updated record (null if not found).
   */
  async setDefaultForUser(
    userId: string,
    pmId: string,
  ): Promise<PaymentMethodRecord | null> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.manager.query(
        `UPDATE payment_methods SET is_default = false
         WHERE owner_user_id = $1 AND is_default = true AND deleted_at_utc IS NULL`,
        [userId],
      );
      await qr.manager.query(
        `UPDATE payment_methods SET is_default = true
         WHERE id = $1 AND owner_user_id = $2 AND deleted_at_utc IS NULL`,
        [pmId, userId],
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
    return this.findLiveById(pmId);
  }

  /** Soft-delete a live method (idempotent). */
  async softDelete(id: string): Promise<void> {
    await this.repo.query(
      `UPDATE payment_methods SET deleted_at_utc = now()
       WHERE id = $1 AND deleted_at_utc IS NULL`,
      [id],
    );
  }
}
