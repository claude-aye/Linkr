import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProfessionalServiceCategory } from '../entities/professional-service-category.entity';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

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

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
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
