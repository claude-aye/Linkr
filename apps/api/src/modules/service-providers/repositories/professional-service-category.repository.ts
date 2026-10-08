import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProfessionalServiceCategory } from '../entities/professional-service-category.entity';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

/**
 * Request statuses that BLOCK retiring a trade (`deleteCategory`).
 *
 * ⚠️ SAME LIST as `ACTIVE_JOB_STATUSES` in
 * `apps/web/src/lib/provider-trades/trade-lifecycle.ts`, which disables
 * « Retirer ce métier » on the same jobs. The two must move together: a status
 * blocked here but not there gives a button that 409s; the reverse lets a
 * direct API call through what the screen refuses.
 *
 * `COMPLETED` is deliberately absent (decision rendered in Métiers — PR B):
 * nothing after completion reads the trade (balance, contest, auto-release,
 * deposit retry), and a contest can hold a request in COMPLETED indefinitely.
 *
 * String literals on purpose: this module must not import anything from
 * `service-requests` (ServiceProvidersModule is a sink; importing back cascades
 * cycles). They are the labels of the PG enum `service_request_status`.
 */
export const TRADE_RETIREMENT_BLOCKING_JOB_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;

export interface PscRecord {
  id: string;
  serviceProviderId: string;
  serviceCategoryId: string;
  verificationStatus: PscVerificationStatus;
  requestedAtUtc: Date;
  verifiedAtUtc: Date | null;
  rejectionReason: string | null;
  isActive: boolean;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

@Injectable()
export class ProfessionalServiceCategoryRepository {
  constructor(
    @InjectRepository(ProfessionalServiceCategory)
    private readonly repo: Repository<ProfessionalServiceCategory>,
  ) {}

  async findById(id: string): Promise<PscRecord | null> {
    const row = await this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
    return row ? this.toRecord(row) : null;
  }

  async findByProviderId(serviceProviderId: string): Promise<PscRecord[]> {
    const rows = await this.repo.find({
      where: { serviceProviderId, deletedAtUtc: IsNull() },
      order: { createdAtUtc: 'ASC' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async existsActive(
    serviceProviderId: string,
    serviceCategoryId: string,
  ): Promise<boolean> {
    return this.repo
      .createQueryBuilder('psc')
      .where('psc.service_provider_id = :serviceProviderId', { serviceProviderId })
      .andWhere('psc.service_category_id = :serviceCategoryId', { serviceCategoryId })
      .andWhere('psc.deleted_at_utc IS NULL')
      .getExists();
  }

  /**
   * True when the provider may currently practice (and thus quote/serve) in a
   * category: an active, non-deleted practice row whose verification is
   * satisfied (VERIFIED for regulated, NOT_REQUIRED for informal).
   *
   * ⚠️ MIRRORED IN SQL by `QuoteRepository.findReceivedForRequest` (its
   * `provider_eligible_for_category` EXISTS), so the client's list and `accept`
   * cannot disagree. Change one, change the other — `quote-eligibility.probe.ts`
   * compares the two case by case.
   *
   * Optional `manager` so `QuotesService.accept` can read inside its
   * transaction (same connection) — same shape as `updateVerification`.
   */
  async isEligibleForCategory(
    serviceProviderId: string,
    serviceCategoryId: string,
    manager?: import('typeorm').EntityManager,
  ): Promise<boolean> {
    const repo = manager
      ? manager.getRepository(ProfessionalServiceCategory)
      : this.repo;
    return repo
      .createQueryBuilder('psc')
      .where('psc.service_provider_id = :serviceProviderId', { serviceProviderId })
      .andWhere('psc.service_category_id = :serviceCategoryId', { serviceCategoryId })
      .andWhere('psc.is_active = true')
      .andWhere('psc.deleted_at_utc IS NULL')
      .andWhere('psc.verification_status IN (:...statuses)', {
        statuses: [PscVerificationStatus.VERIFIED, PscVerificationStatus.NOT_REQUIRED],
      })
      .getExists();
  }

  async create(data: {
    serviceProviderId: string;
    serviceCategoryId: string;
    verificationStatus: PscVerificationStatus;
  }): Promise<PscRecord> {
    const row = this.repo.create({
      serviceProviderId: data.serviceProviderId,
      serviceCategoryId: data.serviceCategoryId,
      verificationStatus: data.verificationStatus,
      requestedAtUtc: new Date(),
      verifiedAtUtc: null,
      rejectionReason: null,
      isActive: true,
    });
    const saved = await this.repo.save(row);
    return this.toRecord(saved);
  }

  async update(id: string, data: { isActive?: boolean }): Promise<PscRecord | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  /**
   * Updates the verification state of a PSC. Used by the verifications domain
   * for the auto VERIFIED cascade and the expiry downgrade. Accepts an optional
   * QueryRunner manager so it can participate in a multi-table transaction.
   */
  async updateVerification(
    id: string,
    data: {
      verificationStatus: PscVerificationStatus;
      verifiedAtUtc?: Date | null;
      rejectionReason?: string | null;
    },
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(ProfessionalServiceCategory)
      : this.repo;
    await repo.update(id, {
      verificationStatus: data.verificationStatus,
      verifiedAtUtc: data.verifiedAtUtc,
      rejectionReason: data.rejectionReason,
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  /**
   * Number of live jobs this provider holds in a catalogue category — the
   * requests ASSIGNED to it, in one of `TRADE_RETIREMENT_BLOCKING_JOB_STATUSES`,
   * not soft-deleted. Read by `deleteCategory` before retiring a trade.
   *
   * `serviceCategoryId` is the CATALOGUE id (`service_categories.id`), which
   * requests and trade claims share — never the claim's own id.
   *
   * Raw SQL on `service_requests` read through this module's connection: no
   * entity, repository or module from `service-requests` is imported (cycle).
   * A plain SELECT returns its rows directly — none of the `UPDATE … RETURNING`
   * `[rows, affected]` quirk applies here.
   */
  async countActiveJobsForTrade(
    serviceProviderId: string,
    serviceCategoryId: string,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await this.repo.query(
      `SELECT COUNT(*) AS count
         FROM service_requests sr
        WHERE sr.assigned_service_provider_id = $1
          AND sr.service_category_id = $2
          AND sr.status = ANY($3::service_request_status[])
          AND sr.deleted_at_utc IS NULL`,
      [serviceProviderId, serviceCategoryId, [...TRADE_RETIREMENT_BLOCKING_JOB_STATUSES]],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  private toRecord(row: ProfessionalServiceCategory): PscRecord {
    return {
      id: row.id,
      serviceProviderId: row.serviceProviderId,
      serviceCategoryId: row.serviceCategoryId,
      verificationStatus: row.verificationStatus,
      requestedAtUtc: row.requestedAtUtc,
      verifiedAtUtc: row.verifiedAtUtc,
      rejectionReason: row.rejectionReason,
      isActive: row.isActive,
      createdAtUtc: row.createdAtUtc,
      updatedAtUtc: row.updatedAtUtc,
    };
  }
}
