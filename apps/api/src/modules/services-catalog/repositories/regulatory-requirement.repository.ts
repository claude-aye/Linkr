import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InputType } from '../enums/input-type.enum';
import { RequiredDocumentType } from '../enums/required-document-type.enum';
import { RegulatoryRequirement } from '../entities/regulatory-requirement.entity';

export interface CreateRequirementData {
  serviceCategoryId: string;
  countryCode: string;
  subdivisionCode?: string | null;
  authorityCode: string;
  authorityFullNameTranslations: Record<string, string>;
  validationEndpointUrl?: string | null;
  requiredDocumentType: RequiredDocumentType;
  inputType: InputType;
  isRequired?: boolean;
}

export interface UpdateRequirementData {
  authorityFullNameTranslations?: Record<string, string>;
  validationEndpointUrl?: string | null;
  requiredDocumentType?: RequiredDocumentType;
  inputType?: InputType;
  isRequired?: boolean;
}

@Injectable()
export class RegulatoryRequirementRepository {
  constructor(
    @InjectRepository(RegulatoryRequirement)
    private readonly repo: Repository<RegulatoryRequirement>,
  ) {}

  findByCategory(serviceCategoryId: string): Promise<RegulatoryRequirement[]> {
    return this.repo.find({
      where: { serviceCategoryId, deletedAtUtc: IsNull() },
      order: { authorityCode: 'ASC' },
    });
  }

  // Geo-scoped lookup: exact subdivision match OR country-wide (subdivision NULL).
  findByZone(
    serviceCategoryId: string,
    countryCode: string,
    subdivisionCode?: string,
  ): Promise<RegulatoryRequirement[]> {
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.service_category_id = :serviceCategoryId', { serviceCategoryId })
      .andWhere('r.country_code = :countryCode', { countryCode })
      .andWhere('r.deleted_at_utc IS NULL')
      .andWhere(
        subdivisionCode
          ? '(r.subdivision_code = :subdivisionCode OR r.subdivision_code IS NULL)'
          : 'r.subdivision_code IS NULL',
        subdivisionCode ? { subdivisionCode } : {},
      )
      .orderBy('r.authority_code', 'ASC');
    return qb.getMany();
  }

  findById(id: string): Promise<RegulatoryRequirement | null> {
    return this.repo.findOne({ where: { id, deletedAtUtc: IsNull() } });
  }

  existsActiveRule(
    serviceCategoryId: string,
    countryCode: string,
    subdivisionCode: string | null,
    authorityCode: string,
    excludeId?: string,
  ): Promise<boolean> {
    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.service_category_id = :serviceCategoryId', { serviceCategoryId })
      .andWhere('r.country_code = :countryCode', { countryCode })
      .andWhere('r.authority_code = :authorityCode', { authorityCode })
      .andWhere('r.deleted_at_utc IS NULL');

    if (subdivisionCode !== null && subdivisionCode !== undefined) {
      qb.andWhere('r.subdivision_code = :subdivisionCode', { subdivisionCode });
    } else {
      qb.andWhere('r.subdivision_code IS NULL');
    }

    if (excludeId) qb.andWhere('r.id != :excludeId', { excludeId });
    return qb.getExists();
  }

  async create(data: CreateRequirementData): Promise<RegulatoryRequirement> {
    const req = this.repo.create({
      serviceCategoryId: data.serviceCategoryId,
      countryCode: data.countryCode,
      subdivisionCode: data.subdivisionCode ?? null,
      authorityCode: data.authorityCode,
      authorityFullNameTranslations: data.authorityFullNameTranslations,
      validationEndpointUrl: data.validationEndpointUrl ?? null,
      requiredDocumentType: data.requiredDocumentType,
      inputType: data.inputType,
      isRequired: data.isRequired ?? true,
    });
    return this.repo.save(req);
  }

  async update(
    id: string,
    data: UpdateRequirementData,
  ): Promise<RegulatoryRequirement | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }
}
