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

  async addMember(
    orgId: string,
    dto: AddMemberDto,
  ): Promise<MembershipPublicDto> {
    const user = await this.usersRepository.findByEmail(dto.email);
    if (!user) throw new NotFoundException('No Linkr account found for that email');

    const existing = await this.membershipRepo.findActiveByOrgAndUser(
      orgId,
      user.id,
    );
    if (existing)
      throw new ConflictException('User is already an active member of this organization');

    const membership = await this.membershipRepo.create(
      orgId,
      user.id,
      OrganizationRole.WORKER,
    );
    return this.toDto({ ...membership, user });
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
