import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RequireOrgRole } from './decorators/require-org-role.decorator';
import { AddMemberDto } from './dtos/add-member.dto';
import { ChangeMemberRoleDto } from './dtos/change-member-role.dto';
import { MembershipPublicDto } from './dtos/membership-public.dto';
import { OrganizationRole } from './enums/organization-role.enum';
import { OrganizationRoleGuard } from './guards/organization-role.guard';
import { OrganizationMembershipsService } from './organization-memberships.service';

@Controller('organizations/:orgId/members')
@UseGuards(OrganizationRoleGuard)
export class OrganizationMembershipsController {
  constructor(
    private readonly membershipsService: OrganizationMembershipsService,
  ) {}

  @Get()
  @RequireOrgRole()
  listMembers(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<MembershipPublicDto[]> {
    return this.membershipsService.listMembers(orgId);
  }

  @Post()
  @RequireOrgRole(OrganizationRole.OWNER)
  addMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: AddMemberDto,
  ): Promise<MembershipPublicDto> {
    return this.membershipsService.addMember(orgId, dto);
  }

  @Put(':membershipId/role')
  @RequireOrgRole(OrganizationRole.OWNER)
  changeRole(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: ChangeMemberRoleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<MembershipPublicDto> {
    return this.membershipsService.changeRole(orgId, membershipId, dto, user.sub);
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgRole(OrganizationRole.OWNER)
  removeMember(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.membershipsService.removeMember(orgId, membershipId, user.sub);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireOrgRole()
  leaveOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    return this.membershipsService.leaveOrganization(orgId, user.sub);
  }
}
