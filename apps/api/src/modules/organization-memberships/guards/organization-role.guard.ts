import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { OrganizationRole } from '../enums/organization-role.enum';
import { REQUIRE_ORG_ROLE_KEY } from '../decorators/require-org-role.decorator';
import { OrganizationMembershipsRepository } from '../organization-memberships.repository';

@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly membershipRepo: OrganizationMembershipsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<
      OrganizationRole | null | undefined
    >(REQUIRE_ORG_ROLE_KEY, [context.getHandler(), context.getClass()]);

    if (requiredRole === undefined) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; params: Record<string, string>; orgMembership?: unknown }>();

    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const orgId = request.params.orgId ?? request.params.id;
    if (!orgId)
      throw new ForbiddenException('Organization id missing from route');

    const membership = await this.membershipRepo.findActiveByOrgAndUser(
      orgId,
      user.sub,
    );
    if (!membership)
      throw new ForbiddenException(
        'You are not an active member of this organization',
      );

    if (requiredRole && membership.role !== requiredRole) {
      throw new ForbiddenException(
        `This action requires the ${requiredRole} role`,
      );
    }

    request.orgMembership = membership;
    return true;
  }
}
