import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { UsersRepository } from '../users/users.repository';
import { AddMemberDto } from './dtos/add-member.dto';
import { ChangeMemberRoleDto } from './dtos/change-member-role.dto';
import { MembershipPublicDto } from './dtos/membership-public.dto';
import { OrganizationRole } from './enums/organization-role.enum';
import { OrganizationMembershipsRepository } from './organization-memberships.repository';

@Injectable()
export class OrganizationMembershipsService {
  constructor(
    private readonly membershipRepo: OrganizationMembershipsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async listMembers(orgId: string): Promise<MembershipPublicDto[]> {
    const memberships = await this.membershipRepo.findActiveByOrgId(orgId);
    return memberships.map((m) => this.toDto(m));
  }

  /**
   * Neutral by design: unknown email, already-active member and successful add
   * are indistinguishable to the caller (no return value, no exception, no
   * error-level log). The OWNER checks the outcome with `listMembers`.
   * Timing difference between the paths is NOT masked (same choice as
   * forgot-password).
   */
  async addMember(orgId: string, dto: AddMemberDto): Promise<void> {
    const user = await this.usersRepository.findByEmail(dto.email);
    if (!user) return;

    const existing = await this.membershipRepo.findActiveByOrgAndUser(
      orgId,
      user.id,
    );
    if (existing) return;

    try {
      await this.membershipRepo.create(orgId, user.id, OrganizationRole.WORKER);
    } catch (err) {
      // Concurrent add: the partial unique index already holds the membership.
      if ((err as { code?: string }).code === '23505') return;
      throw err;
    }
  }

  async changeRole(
    orgId: string,
    membershipId: string,
    dto: ChangeMemberRoleDto,
    requestingUserId: string,
  ): Promise<MembershipPublicDto> {
    const membership = await this.membershipRepo.findById(membershipId);
    if (!membership || membership.organizationId !== orgId || !membership.isActive)
      throw new NotFoundException('Membership not found');

    if (
      dto.role === OrganizationRole.WORKER &&
      membership.role === OrganizationRole.OWNER
    ) {
      const ownerCount = await this.membershipRepo.countActiveOwners(orgId);
      if (ownerCount <= 1)
        throw new ConflictException(
          'Cannot demote the last OWNER. Promote another member first.',
        );
    }

    const updated = await this.membershipRepo.updateRole(membershipId, dto.role);
    if (!updated) throw new NotFoundException('Membership not found');
    return this.toDto(updated);
  }

  async removeMember(
    orgId: string,
    membershipId: string,
    requestingUserId: string,
  ): Promise<void> {
    const membership = await this.membershipRepo.findById(membershipId);
    if (!membership || membership.organizationId !== orgId || !membership.isActive)
      throw new NotFoundException('Membership not found');

    if (membership.role === OrganizationRole.OWNER) {
      const ownerCount = await this.membershipRepo.countActiveOwners(orgId);
      if (ownerCount <= 1)
        throw new ConflictException(
          'Cannot remove the last OWNER. Transfer ownership first.',
        );
    }

    await this.membershipRepo.softLeave(membershipId);
  }

  async leaveOrganization(
    orgId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.membershipRepo.findActiveByOrgAndUser(
      orgId,
      userId,
    );
    if (!membership) throw new NotFoundException('You are not a member of this organization');

    if (membership.role === OrganizationRole.OWNER) {
      const ownerCount = await this.membershipRepo.countActiveOwners(orgId);
      if (ownerCount <= 1)
        throw new ConflictException(
          'Cannot leave as the last OWNER. Transfer ownership or delete the organization first.',
        );
    }

    await this.membershipRepo.softLeave(membership.id);
  }

  private toDto(membership: object): MembershipPublicDto {
    return plainToInstance(MembershipPublicDto, membership, {
      excludeExtraneousValues: true,
    });
  }
}
