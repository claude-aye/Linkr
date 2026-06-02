import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ProfessionalService } from '../entities/professional-service.entity';
import { PricingModel } from '../enums/pricing-model.enum';
import { PscVerificationStatus } from '../enums/psc-verification-status.enum';

export interface PsRecord {
  id: string;
  professionalServiceCategoryId: string;
  serviceItemId: string;
  pricingModel: PricingModel;
  priceAmount: number | null;
  priceCurrency: string;
  estimatedDurationMinutes: number | null;
  descriptionOverride: string | null;
  isActive: boolean;
  createdAtUtc: Date;
  updatedAtUtc: Date;
}

@Injectable()
export class ProfessionalServiceRepository {
  constructor(
    @InjectRepository(ProfessionalService)
    private readonly repo: Repository<ProfessionalService>,
  ) {}

  async findById(id: string): Promise<PsRecord | null> {
    const row = await this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
    return row ? this.toRecord(row) : null;
  }

  async findPublicByProviderId(serviceProviderId: string): Promise<PsRecord[]> {
    const rows = await this.repo
      .createQueryBuilder('ps')
      .innerJoin('ps.professionalServiceCategory', 'psc')
      .innerJoin('psc.serviceProvider', 'sp')
      .where('psc.service_provider_id = :serviceProviderId', { serviceProviderId })
      .andWhere('ps.is_active = true')
      .andWhere('ps.deleted_at_utc IS NULL')
      .andWhere('psc.is_active = true')
      .andWhere('psc.deleted_at_utc IS NULL')
      .andWhere('psc.verification_status IN (:...statuses)', {
        statuses: [PscVerificationStatus.VERIFIED, PscVerificationStatus.NOT_REQUIRED],
      })
      .andWhere('sp.is_active = true')
      .andWhere('sp.deleted_at_utc IS NULL')
      .orderBy('ps.created_at_utc', 'ASC')
      .getMany();
    return rows.map((r) => this.toRecord(r));
  }

  async findAllByProviderId(serviceProviderId: string): Promise<PsRecord[]> {
    const rows = await this.repo
      .createQueryBuilder('ps')
      .innerJoin('ps.professionalServiceCategory', 'psc')
      .where('psc.service_provider_id = :serviceProviderId', { serviceProviderId })
      .andWhere('ps.deleted_at_utc IS NULL')
      .orderBy('ps.created_at_utc', 'ASC')
      .getMany();
    return rows.map((r) => this.toRecord(r));
  }

  async existsActive(
    professionalServiceCategoryId: string,
    serviceItemId: string,
  ): Promise<boolean> {
    return this.repo
      .createQueryBuilder('ps')
      .where(
        'ps.professional_service_category_id = :professionalServiceCategoryId',
        { professionalServiceCategoryId },
      )
      .andWhere('ps.service_item_id = :serviceItemId', { serviceItemId })
      .andWhere('ps.deleted_at_utc IS NULL')
      .getExists();
  }

  async create(data: {
    professionalServiceCategoryId: string;
    serviceItemId: string;
    pricingModel: PricingModel;
    priceAmount: number | null;
    priceCurrency: string;
    estimatedDurationMinutes?: number | null;
    descriptionOverride?: string | null;
  }): Promise<PsRecord> {
    const row = this.repo.create({
      professionalServiceCategoryId: data.professionalServiceCategoryId,
      serviceItemId: data.serviceItemId,
      pricingModel: data.pricingModel,
      priceAmount: data.priceAmount !== null ? String(data.priceAmount) : null,
      priceCurrency: data.priceCurrency,
      estimatedDurationMinutes: data.estimatedDurationMinutes ?? null,
      descriptionOverride: data.descriptionOverride ?? null,
      isActive: true,
    });
    const saved = await this.repo.save(row);
    return this.toRecord(saved);
  }

  async update(
    id: string,
    data: {
      pricingModel?: PricingModel;
      priceAmount?: number | null;
      priceCurrency?: string;
      estimatedDurationMinutes?: number | null;
      descriptionOverride?: string | null;
      isActive?: boolean;
    },
  ): Promise<PsRecord | null> {
    const patch: Partial<ProfessionalService> = {};
    if (data.pricingModel !== undefined) patch.pricingModel = data.pricingModel;
    if (data.priceAmount !== undefined) {
      patch.priceAmount = data.priceAmount !== null ? String(data.priceAmount) : null;
    }
    if (data.priceCurrency !== undefined) patch.priceCurrency = data.priceCurrency;
    if (data.estimatedDurationMinutes !== undefined) {
      patch.estimatedDurationMinutes = data.estimatedDurationMinutes;
    }
    if (data.descriptionOverride !== undefined) {
      patch.descriptionOverride = data.descriptionOverride;
    }
    if (data.isActive !== undefined) patch.isActive = data.isActive;

    if (Object.keys(patch).length > 0) {
      await this.repo.update(id, patch);
    }
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  private toRecord(row: ProfessionalService): PsRecord {
    return {
      id: row.id,
      professionalServiceCategoryId: row.professionalServiceCategoryId,
      serviceItemId: row.serviceItemId,
      pricingModel: row.pricingModel,
      priceAmount: row.priceAmount !== null ? Number(row.priceAmount) : null,
      priceCurrency: row.priceCurrency,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      descriptionOverride: row.descriptionOverride,
      isActive: row.isActive,
      createdAtUtc: row.createdAtUtc,
      updatedAtUtc: row.updatedAtUtc,
    };
  }
}
