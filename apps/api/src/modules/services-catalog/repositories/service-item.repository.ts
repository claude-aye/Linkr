import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApprovalStatus } from '../enums/approval-status.enum';
import { ServiceItem, PriceRange } from '../entities/service-item.entity';

export interface CreateItemData {
  serviceCategoryId: string;
  slug: string;
  nameTranslations: Record<string, string>;
  descriptionTranslations?: Record<string, string>;
  typicalDurationMinutes?: number | null;
  suggestedPriceRange?: PriceRange | null;
  suggestedByUserId?: string | null;
  approvalStatus?: ApprovalStatus;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateItemData {
  slug?: string;
  nameTranslations?: Record<string, string>;
  descriptionTranslations?: Record<string, string>;
  typicalDurationMinutes?: number | null;
  suggestedPriceRange?: PriceRange | null;
  isActive?: boolean;
  sortOrder?: number;
}

@Injectable()
export class ServiceItemRepository {
  constructor(
    @InjectRepository(ServiceItem)
    private readonly repo: Repository<ServiceItem>,
  ) {}

  findApprovedByCategoryId(serviceCategoryId: string): Promise<ServiceItem[]> {
    return this.repo.find({
      where: {
        serviceCategoryId,
        approvalStatus: ApprovalStatus.APPROVED,
        isActive: true,
        deletedAtUtc: IsNull(),
      },
      order: { sortOrder: 'ASC', createdAtUtc: 'ASC' },
    });
  }

  findById(id: string): Promise<ServiceItem | null> {
    return this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
  }

  existsActiveSlugInCategory(
    serviceCategoryId: string,
    slug: string,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.repo
      .createQueryBuilder('i')
      .where('i.service_category_id = :serviceCategoryId', { serviceCategoryId })
      .andWhere('i.slug = :slug', { slug })
      .andWhere('i.deleted_at_utc IS NULL');
    if (excludeId) qb.andWhere('i.id != :excludeId', { excludeId });
    return qb.getExists();
  }

  async create(data: CreateItemData): Promise<ServiceItem> {
    const item = this.repo.create({
      serviceCategoryId: data.serviceCategoryId,
      slug: data.slug,
      nameTranslations: data.nameTranslations,
      descriptionTranslations: data.descriptionTranslations ?? {},
      typicalDurationMinutes: data.typicalDurationMinutes ?? null,
      suggestedPriceRange: data.suggestedPriceRange ?? null,
      suggestedByUserId: data.suggestedByUserId ?? null,
      approvalStatus: data.approvalStatus ?? ApprovalStatus.PENDING,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    });
    return this.repo.save(item);
  }

  async update(id: string, data: UpdateItemData): Promise<ServiceItem | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async approve(id: string, approvedByUserId: string): Promise<ServiceItem | null> {
    await this.repo.update(id, {
      approvalStatus: ApprovalStatus.APPROVED,
      approvedAtUtc: new Date(),
      approvedByUserId,
      rejectionReason: null,
    });
    return this.findById(id);
  }

  async reject(id: string, rejectionReason: string): Promise<ServiceItem | null> {
    await this.repo.update(id, {
      approvalStatus: ApprovalStatus.REJECTED,
      rejectionReason,
      approvedAtUtc: null,
      approvedByUserId: null,
    });
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
