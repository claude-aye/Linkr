import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { OrganizationMembership } from '../organization-memberships/entities/organization-membership.entity';
import { OrganizationRole } from '../organization-memberships/enums/organization-role.enum';
import { Organization } from './entities/organization.entity';

export interface CreateOrganizationData {
  legalName: string;
  displayName: string;
  slug: string;
  description?: string;
  legalAddress: string;
  countryCode: string;
  subdivisionCode: string;
  billingEmail: string;
  businessNumber?: string | null;
}

export interface UpdateOrganizationData {
  legalName?: string;
  displayName?: string;
  slug?: string;
  logoUrl?: string | null;
  description?: string;
  legalAddress?: string;
  countryCode?: string;
  subdivisionCode?: string;
  billingEmail?: string;
  businessNumber?: string | null;
  isActive?: boolean;
}

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly dataSource: DataSource,
  ) {}

  findById(id: string): Promise<Organization | null> {
    return this.orgRepo.findOne({ where: { id } });
  }

  findBySlug(slug: string): Promise<Organization | null> {
    return this.orgRepo.findOne({ where: { slug } });
  }

  async create(data: CreateOrganizationData): Promise<Organization> {
    const org = this.orgRepo.create({
      legalName: data.legalName,
      displayName: data.displayName,
      slug: data.slug,
      description: data.description ?? '',
      legalAddress: data.legalAddress,
      countryCode: data.countryCode,
      subdivisionCode: data.subdivisionCode,
      billingEmail: data.billingEmail,
      businessNumber: data.businessNumber ?? null,
    });
    return this.orgRepo.save(org);
  }

  // Atomically create the org and its first OWNER membership.
  async createWithOwner(
    data: CreateOrganizationData,
    ownerUserId: string,
  ): Promise<Organization> {
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const org = qr.manager.create(Organization, {
        legalName: data.legalName,
        displayName: data.displayName,
        slug: data.slug,
        description: data.description ?? '',
        legalAddress: data.legalAddress,
        countryCode: data.countryCode,
        subdivisionCode: data.subdivisionCode,
        billingEmail: data.billingEmail,
        businessNumber: data.businessNumber ?? null,
      });
      const savedOrg = await qr.manager.save(Organization, org);

      const membership = qr.manager.create(OrganizationMembership, {
        organizationId: savedOrg.id,
        userId: ownerUserId,
        role: OrganizationRole.OWNER,
      });
      await qr.manager.save(OrganizationMembership, membership);

      await qr.commitTransaction();
      return savedOrg;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async update(
    id: string,
    data: UpdateOrganizationData,
  ): Promise<Organization | null> {
    await this.orgRepo.update(id, data);
    return this.findById(id);
  }

  // Soft-delete the org and deactivate its memberships (kept for history).
  async softDelete(id: string): Promise<void> {
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.manager.update(
        Organization,
        { id },
        { deletedAtUtc: new Date(), isActive: false },
      );
      await qr.manager.update(
        OrganizationMembership,
        { organizationId: id, isActive: true },
        { isActive: false },
      );
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
