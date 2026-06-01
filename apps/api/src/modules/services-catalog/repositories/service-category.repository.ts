import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ServiceCategory } from '../entities/service-category.entity';

export interface CreateCategoryData {
  slug: string;
  nameTranslations: Record<string, string>;
  descriptionTranslations?: Record<string, string>;
  iconUrl?: string | null;
  regulationLevel: import('../enums/regulation-level.enum').RegulationLevel;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateCategoryData {
  slug?: string;
  nameTranslations?: Record<string, string>;
  descriptionTranslations?: Record<string, string>;
  iconUrl?: string | null;
  regulationLevel?: import('../enums/regulation-level.enum').RegulationLevel;
  isActive?: boolean;
  sortOrder?: number;
}

@Injectable()
export class ServiceCategoryRepository {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly repo: Repository<ServiceCategory>,
  ) {}

  findActivePublic(): Promise<ServiceCategory[]> {
    return this.repo.find({
      where: { isActive: true, deletedAtUtc: IsNull() },
      order: { sortOrder: 'ASC', createdAtUtc: 'ASC' },
    });
  }

  findBySlug(slug: string): Promise<ServiceCategory | null> {
    return this.repo.findOne({ where: { slug, deletedAtUtc: IsNull() } });
  }

  findById(id: string): Promise<ServiceCategory | null> {
    return this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
  }

  existsActiveSlug(slug: string, excludeId?: string): Promise<boolean> {
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c.slug = :slug', { slug })
      .andWhere('c.deleted_at_utc IS NULL');
    if (excludeId) qb.andWhere('c.id != :excludeId', { excludeId });
    return qb.getExists();
  }

  async create(data: CreateCategoryData): Promise<ServiceCategory> {
    const cat = this.repo.create({
      slug: data.slug,
      nameTranslations: data.nameTranslations,
      descriptionTranslations: data.descriptionTranslations ?? {},
      iconUrl: data.iconUrl ?? null,
      regulationLevel: data.regulationLevel,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    });
    return this.repo.save(cat);
  }

  async update(id: string, data: UpdateCategoryData): Promise<ServiceCategory | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
