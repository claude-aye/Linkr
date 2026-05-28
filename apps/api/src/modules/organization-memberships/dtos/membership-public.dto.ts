import { Exclude, Expose, Type } from 'class-transformer';
import { UserPublicDto } from '../../auth/dtos/user-public.dto';
import { OrganizationRole } from '../enums/organization-role.enum';

@Exclude()
export class MembershipPublicDto {
  @Expose() id!: string;
  @Expose() organizationId!: string;
  @Expose() userId!: string;
  @Expose() role!: OrganizationRole;
  @Expose() joinedAtUtc!: Date;
  @Expose() leftAtUtc!: Date | null;
  @Expose() isActive!: boolean;

  @Expose()
  @Type(() => UserPublicDto)
  user?: UserPublicDto;
}
