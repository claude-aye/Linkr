import { SetMetadata } from '@nestjs/common';
import { OrganizationRole } from '../enums/organization-role.enum';

export const REQUIRE_ORG_ROLE_KEY = 'requireOrgRole';

// No argument → any active member; a role → membership must hold exactly that role.
export const RequireOrgRole = (role?: OrganizationRole) =>
  SetMetadata(REQUIRE_ORG_ROLE_KEY, role ?? null);
