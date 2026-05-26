import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationRole } from './enums/organization-role.enum';

@Injectable()
export class OrganizationMembershipsRepository {
  constructor(
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepo: Repository<OrganizationMembership>,
  ) {}

  // Active roster of an organization (joined, not left).
  findActiveByOrgId(organizationId: string): Promise<OrganizationMembership[]> {
    return this.membershipRepo.find({
      where: { organizationId, leftAtUtc: IsNull(), isActive: true },
      relations: { user: true },
      order: { joinedAtUtc: 'ASC' },
    });
  }

  // Active memberships of a user, with their organizations (for "my orgs").
  findActiveByUserIdWithOrg(userId: string): Promise<OrganizationMembership[]> {
    return this.membershipRepo.find({
      where: { userId, isActive: true },
      relations: { organization: true },
      order: { joinedAtUtc: 'ASC' },
    });
  }

  findActiveByOrgAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | null> {
    return this.membershipRepo
      .createQueryBuilder('m')
      .where('m.organization_id = :organizationId', { organizationId })
      .andWhere('m.user_id = :userId', { userId })
      .andWhere('m.left_at_utc IS NULL')
      .andWhere('m.is_active = true')
      .getOne();
  }

  findById(id: string): Promise<OrganizationMembership | null> {
    return this.membershipRepo.findOne({ where: { id } });
  }

  async create(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMembership> {
    const membership = this.membershipRepo.create({
      organizationId,
      userId,
      role,
    });
    return this.membershipRepo.save(membership);
  }

  async updateRole(
    id: string,
    role: OrganizationRole,
  ): Promise<OrganizationMembership | null> {
    await this.membershipRepo.update(id, { role });
    return this.findById(id);
  }

  // Count active OWNERs of an organization (last-OWNER protection).
  countActiveOwners(organizationId: string): Promise<number> {
    return this.membershipRepo.count({
      where: {
        organizationId,
        role: OrganizationRole.OWNER,
        isActive: true,
      },
    });
  }

  // Soft-leave: preserve the row, mark as left/inactive.
  async softLeave(id: string): Promise<void> {
    await this.membershipRepo.update(id, {
      leftAtUtc: new Date(),
      isActive: false,
    });
  }
}
