import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { RequiredDocumentType } from '../../services-catalog/enums/required-document-type.enum';
import { VerificationDocument } from '../entities/verification-document.entity';
import { VerificationDocumentReviewStatus } from '../enums/verification-document-review-status.enum';

export interface CreateVerificationDocumentData {
  professionalServiceCategoryId: string;
  regulatoryRequirementId: string;
  documentType: RequiredDocumentType;
  documentNumber?: string | null;
  fileUrl: string;
  fileMimeType: string;
  fileSizeBytes: number;
  issuedAtUtc?: Date | null;
  expiresAtUtc?: Date | null;
}

@Injectable()
export class VerificationDocumentRepository {
  constructor(
    @InjectRepository(VerificationDocument)
    private readonly repo: Repository<VerificationDocument>,
  ) {}

  findById(id: string): Promise<VerificationDocument | null> {
    return this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
  }

  findByPscId(
    professionalServiceCategoryId: string,
  ): Promise<VerificationDocument[]> {
    return this.repo.find({
      where: { professionalServiceCategoryId, deletedAtUtc: IsNull() },
      order: { createdAtUtc: 'DESC' },
    });
  }

  findByStatus(
    reviewStatus: VerificationDocumentReviewStatus,
  ): Promise<VerificationDocument[]> {
    return this.repo.find({
      where: { reviewStatus, deletedAtUtc: IsNull() },
      order: { createdAtUtc: 'ASC' },
    });
  }

  /**
   * Admin review-queue read enriched with the relations the labelled DTO needs:
   * the practised category (for its i18n name), the satisfied regulatory
   * requirement (for its authority code), and the polymorphic provider with its
   * user / organization (for the display name). Same filter and ordering as
   * `findByStatus` but kept as a SEPARATE method so the cascade-critical
   * `findByStatus` (used by recompute / expiry) stays byte-for-byte untouched.
   *
   * Geo note: ServiceProvider.serviceBaseLocation is `select: false`, so TypeORM
   * omits it from this load — no raw geography (WKB) is read and no ST_AsGeoJSON
   * gymnastics are needed.
   */
  findByStatusWithRelations(
    reviewStatus: VerificationDocumentReviewStatus,
  ): Promise<VerificationDocument[]> {
    return this.repo.find({
      where: { reviewStatus, deletedAtUtc: IsNull() },
      relations: {
        professionalServiceCategory: {
          serviceCategory: true,
          serviceProvider: { organization: true, user: true },
        },
        regulatoryRequirement: true,
      },
      order: { createdAtUtc: 'ASC' },
    });
  }

  /**
   * Whether the given requirement is currently satisfied for a PSC:
   * at least one APPROVED, non-expired, non-deleted document exists.
   * Accepts an optional manager to read within a transaction.
   */
  async isRequirementSatisfied(
    professionalServiceCategoryId: string,
    regulatoryRequirementId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager
      ? manager.getRepository(VerificationDocument)
      : this.repo;
    return repo
      .createQueryBuilder('vd')
      .where('vd.professional_service_category_id = :pscId', {
        pscId: professionalServiceCategoryId,
      })
      .andWhere('vd.regulatory_requirement_id = :reqId', {
        reqId: regulatoryRequirementId,
      })
      .andWhere('vd.review_status = :status', {
        status: VerificationDocumentReviewStatus.APPROVED,
      })
      .andWhere('vd.deleted_at_utc IS NULL')
      .andWhere('(vd.expires_at_utc IS NULL OR vd.expires_at_utc > now())')
      .getExists();
  }

  /** APPROVED documents past their expiry — the nightly/expiry scan target. */
  findExpiredApproved(manager?: EntityManager): Promise<VerificationDocument[]> {
    const repo = manager
      ? manager.getRepository(VerificationDocument)
      : this.repo;
    return repo
      .createQueryBuilder('vd')
      .where('vd.review_status = :status', {
        status: VerificationDocumentReviewStatus.APPROVED,
      })
      .andWhere('vd.expires_at_utc IS NOT NULL')
      .andWhere('vd.expires_at_utc < now()')
      .andWhere('vd.deleted_at_utc IS NULL')
      .getMany();
  }

  async create(
    data: CreateVerificationDocumentData,
  ): Promise<VerificationDocument> {
    const doc = this.repo.create({
      professionalServiceCategoryId: data.professionalServiceCategoryId,
      regulatoryRequirementId: data.regulatoryRequirementId,
      documentType: data.documentType,
      documentNumber: data.documentNumber ?? null,
      fileUrl: data.fileUrl,
      fileMimeType: data.fileMimeType,
      fileSizeBytes: data.fileSizeBytes,
      issuedAtUtc: data.issuedAtUtc ?? null,
      expiresAtUtc: data.expiresAtUtc ?? null,
      reviewStatus: VerificationDocumentReviewStatus.PENDING,
    });
    return this.repo.save(doc);
  }

  async approve(
    id: string,
    reviewedByUserId: string,
  ): Promise<VerificationDocument | null> {
    await this.repo.update(id, {
      reviewStatus: VerificationDocumentReviewStatus.APPROVED,
      reviewedAtUtc: new Date(),
      reviewedByUserId,
      rejectionReason: null,
    });
    return this.findById(id);
  }

  async reject(
    id: string,
    reviewedByUserId: string,
    rejectionReason: string,
  ): Promise<VerificationDocument | null> {
    await this.repo.update(id, {
      reviewStatus: VerificationDocumentReviewStatus.REJECTED,
      reviewedAtUtc: new Date(),
      reviewedByUserId,
      rejectionReason,
    });
    return this.findById(id);
  }

  /** Marks a document EXPIRED within the given transaction. */
  async markExpired(id: string, manager: EntityManager): Promise<void> {
    await manager
      .getRepository(VerificationDocument)
      .update(id, { reviewStatus: VerificationDocumentReviewStatus.EXPIRED });
  }
}
