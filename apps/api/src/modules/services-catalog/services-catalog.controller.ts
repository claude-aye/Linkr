import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceItem } from './entities/service-item.entity';
import { RegulatoryRequirement } from './entities/regulatory-requirement.entity';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';
import { CreateServiceItemDto } from './dto/create-service-item.dto';
import { UpdateServiceItemDto } from './dto/update-service-item.dto';
import { RejectServiceItemDto } from './dto/reject-service-item.dto';
import { CreateRegulatoryRequirementDto } from './dto/create-regulatory-requirement.dto';
import { UpdateRegulatoryRequirementDto } from './dto/update-regulatory-requirement.dto';
import { ServicesCatalogService } from './services-catalog.service';
import { SuggestServiceItemDto } from './dto/suggest-service-item.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// ── Pro suggestion endpoint (any authenticated user) ──────────────────────────

@ApiTags('services-catalog')
@Controller('service-items')
export class ServiceItemSuggestionController {
  constructor(private readonly catalogService: ServicesCatalogService) {}

  @Post('suggest')
  @ApiOperation({ summary: 'Suggest a new service item (authenticated pro); always starts as PENDING' })
  suggestItem(
    @Body() dto: SuggestServiceItemDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceItem> {
    return this.catalogService.suggestItem(dto, user.sub);
  }
}

// ── Admin CRUD ────────────────────────────────────────────────────────────────

@ApiTags('admin — services-catalog')
@Controller('admin')
@UseGuards(AdminGuard)
export class ServicesCatalogController {
  constructor(private readonly catalogService: ServicesCatalogService) {}

  // ── Service categories ────────────────────────────────────────────────────

  @Post('service-categories')
  @ApiOperation({ summary: 'Create a service category (admin)' })
  createCategory(
    @Body() dto: CreateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    return this.catalogService.createCategory(dto);
  }

  @Patch('service-categories/:id')
  @ApiOperation({ summary: 'Update a service category (admin)' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceCategoryDto,
  ): Promise<ServiceCategory> {
    return this.catalogService.updateCategory(id, dto);
  }

  @Delete('service-categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a service category (admin)' })
  deleteCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.catalogService.deleteCategory(id);
  }

  // ── Service items ─────────────────────────────────────────────────────────

  @Post('service-items')
  @ApiOperation({ summary: 'Create a service item (admin; born APPROVED by default)' })
  createItem(@Body() dto: CreateServiceItemDto): Promise<ServiceItem> {
    return this.catalogService.adminCreateItem(dto);
  }

  @Patch('service-items/:id')
  @ApiOperation({ summary: 'Update a service item (admin)' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceItemDto,
  ): Promise<ServiceItem> {
    return this.catalogService.updateItem(id, dto);
  }

  @Post('service-items/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a pending service item (admin)' })
  approveItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ServiceItem> {
    return this.catalogService.approveItem(id, user.sub);
  }

  @Post('service-items/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending service item (admin)' })
  rejectItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectServiceItemDto,
  ): Promise<ServiceItem> {
    return this.catalogService.rejectItem(id, dto);
  }

  @Delete('service-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a service item (admin)' })
  deleteItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.catalogService.deleteItem(id);
  }

  // ── Regulatory requirements ───────────────────────────────────────────────

  @Post('regulatory-requirements')
  @ApiOperation({ summary: 'Create a regulatory requirement (admin)' })
  createRequirement(
    @Body() dto: CreateRegulatoryRequirementDto,
  ): Promise<RegulatoryRequirement> {
    return this.catalogService.createRequirement(dto);
  }

  @Patch('regulatory-requirements/:id')
  @ApiOperation({ summary: 'Update a regulatory requirement (admin)' })
  updateRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegulatoryRequirementDto,
  ): Promise<RegulatoryRequirement> {
    return this.catalogService.updateRequirement(id, dto);
  }

  @Delete('regulatory-requirements/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a regulatory requirement (admin)' })
  deleteRequirement(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.catalogService.deleteRequirement(id);
  }
}
