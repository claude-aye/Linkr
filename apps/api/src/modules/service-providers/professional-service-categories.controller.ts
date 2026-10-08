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
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AddProviderCategoryDto } from './dto/add-provider-category.dto';
import { UpdateProviderCategoryDto } from './dto/update-provider-category.dto';
import { ProviderCategoryResponseDto } from './dto/provider-category-response.dto';
import { ProviderServicesService } from './provider-services.service';

@ApiTags('provider-services')
@Controller('service-providers/:providerId/categories')
export class ProfessionalServiceCategoriesController {
  constructor(private readonly providerServicesService: ProviderServicesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Add a service category to a provider (owner only). ' +
      'INFORMAL → verification_status=NOT_REQUIRED; REGULATED → PENDING.',
  })
  addCategory(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: AddProviderCategoryDto,
  ): Promise<ProviderCategoryResponseDto> {
    return this.providerServicesService.addCategory(user.sub, providerId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all service categories for a provider (owner view — all statuses).' })
  listCategories(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ): Promise<ProviderCategoryResponseDto[]> {
    return this.providerServicesService.listCategories(user.sub, providerId);
  }

  @Patch(':pscId')
  @ApiOperation({ summary: 'Toggle a provider category active/inactive (owner only).' })
  // Any @ApiResponse REPLACES Swagger's default response: the 200 is restated
  // exactly as it was generated before, or the contract would lose it.
  @ApiResponse({ status: 200, description: '' })
  @ApiResponse({ status: 400, description: 'isActive is missing or not a boolean, or an id is malformed' })
  @ApiResponse({
    status: 409,
    description: 'Pausing a trade whose verification is PENDING or REJECTED is not allowed',
  })
  updateCategory(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('pscId', ParseUUIDPipe) pscId: string,
    @Body() dto: UpdateProviderCategoryDto,
  ): Promise<ProviderCategoryResponseDto> {
    return this.providerServicesService.updateCategory(user.sub, providerId, pscId, dto);
  }

  @Delete(':pscId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a provider category (owner only).' })
  // Same reason as above: the 204 is restated as it was generated before.
  @ApiResponse({ status: 204, description: '' })
  @ApiResponse({ status: 400, description: 'An id is malformed' })
  @ApiResponse({
    status: 409,
    description: 'The trade still has ASSIGNED or IN_PROGRESS jobs for this provider',
  })
  deleteCategory(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('pscId', ParseUUIDPipe) pscId: string,
  ): Promise<void> {
    return this.providerServicesService.deleteCategory(user.sub, providerId, pscId);
  }
}
