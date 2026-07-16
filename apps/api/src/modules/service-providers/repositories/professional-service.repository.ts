import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ServiceItem } from '../../services-catalog/entities/service-item.entity';
import { ServiceCategory } from '../../services-catalog/entities/service-category.entity';
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

/**
 * Label-enriched public view of a bookable service, backing
 * {@link ProfessionalServiceRepository.findPublicCatalogByProviderId}. Carries
 * the catalog trade id (`service_categories.id`, via `service_items`) plus the
 * joined i18n names — deliberately NO junction id, NO audit timestamps, NO geo.
 */
export interface PsCatalogRecord {
  id: string;
  serviceItemId: string;
  serviceCategoryId: string;
  serviceItemNameTranslations: Record<string, string>;
  serviceCategoryNameTranslations: Record<string, string>;
  pricingModel: PricingModel;
  priceAmount: number | null;
  priceCurrency: string;
  estimatedDurationMinutes: number | null;
  descriptionOverride: string | null;
}

interface PsCatalogRawRow {
  id: string;
  service_item_id: string;
  service_category_id: string;
  service_item_name_translations: Record<string, string> | null;
  service_category_name_translations: Record<string, string> | null;
  pricing_model: PricingModel;
  price_amount: string | null;
  price_currency: string;
  estimated_duration_minutes: number | null;
  description_override: string | null;
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

  /**
   * Label-enriched sibling of {@link findPublicByProviderId}. The visibility
   * predicate is copied verbatim from that method — a service whose category is
   * not VERIFIED/NOT_REQUIRED (or is inactive / soft-deleted, or whose provider
   * is paused / deleted) MUST never surface (trust-cascade bypass). The extra
   * `service_items` / `service_categories` joins are label-only (equality on the
   * FK, no `deleted_at_utc` / `is_active` filter) so the result SET is identical
   * — FK RESTRICT guarantees both rows always exist. No geo column is read.
   */
  async findPublicCatalogByProviderId(
    serviceProviderId: string,
  ): Promise<PsCatalogRecord[]> {
    const rows: PsCatalogRawRow[] = await this.repo
      .createQueryBuilder('ps')
      .innerJoin('ps.professionalServiceCategory', 'psc')
      .innerJoin('psc.serviceProvider', 'sp')
      .innerJoin(ServiceItem, 'si', 'si.id = ps.service_item_id')
      .innerJoin(ServiceCategory, 'sc', 'sc.id = si.service_category_id')
      .select('ps.id', 'id')
      .addSelect('ps.serviceItemId', 'service_item_id')
      .addSelect('si.serviceCategoryId', 'service_category_id')
      .addSelect('si.nameTranslations', 'service_item_name_translations')
      .addSelect('sc.nameTranslations', 'service_category_name_translations')
      .addSelect('ps.pricingModel', 'pricing_model')
      .addSelect('ps.priceAmount', 'price_amount')
      .addSelect('ps.priceCurrency', 'price_currency')
      .addSelect('ps.estimatedDurationMinutes', 'estimated_duration_minutes')
      .addSelect('ps.descriptionOverride', 'description_override')
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
      .getRawMany<PsCatalogRawRow>();
    return rows.map((r) => this.toCatalogRecord(r));
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

  private toCatalogRecord(row: PsCatalogRawRow): PsCatalogRecord {
    return {
      id: row.id,
      serviceItemId: row.service_item_id,
      serviceCategoryId: row.service_category_id,
      serviceItemNameTranslations: row.service_item_name_translations ?? {},
      serviceCategoryNameTranslations: row.service_category_name_translations ?? {},
      pricingModel: row.pricing_model,
      priceAmount: row.price_amount !== null ? Number(row.price_amount) : null,
      priceCurrency: row.price_currency,
      estimatedDurationMinutes:
        row.estimated_duration_minutes !== null
          ? Number(row.estimated_duration_minutes)
          : null,
      descriptionOverride: row.description_override,
    };
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
