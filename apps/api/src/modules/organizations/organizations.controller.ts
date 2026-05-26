import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RequireOrgRole } from '../organization-memberships/decorators/require-org-role.decorator';
import { OrganizationRoleGuard } from '../organization-memberships/guards/organization-role.guard';
import { OrganizationRole } from '../organization-memberships/enums/organization-role.enum';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { OrganizationPublicDto } from './dtos/organization-public.dto';
import { UpdateOrganizationDto } from './dtos/update-organization.dto';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    return this.organizationsService.create(dto, user.sub);
  }

  @Get(':id')
  @UseGuards(OrganizationRoleGuard)
  @RequireOrgRole()
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrganizationPublicDto> {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(OrganizationRoleGuard)
  @RequireOrgRole(OrganizationRole.OWNER)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationPublicDto> {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationRoleGuard)
  @RequireOrgRole(OrganizationRole.OWNER)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organizationsService.remove(id);
  }
}
