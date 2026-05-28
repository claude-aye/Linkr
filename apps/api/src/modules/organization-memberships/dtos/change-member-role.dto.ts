import { IsEnum } from 'class-validator';
import { OrganizationRole } from '../enums/organization-role.enum';

export class ChangeMemberRoleDto {
  @IsEnum(OrganizationRole)
  role!: OrganizationRole;
}
