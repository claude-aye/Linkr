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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateProfessionalServiceDto } from './dto/create-professional-service.dto';
import { UpdateProfessionalServiceDto } from './dto/update-professional-service.dto';
import { ProfessionalServiceResponseDto } from './dto/professional-service-response.dto';
import { ProviderServicesService } from './provider-services.service';

/**
 * Handles POST /service-providers/:providerId/categories/:pscId/services
 * (creation is scoped to a specific PSC).
 */
@ApiTags('provider-services')
@Controller('service-providers/:providerId/categories/:pscId/services')
export class PscServicesController {
  constructor(private readonly providerServicesService: ProviderServicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a service offering within a provider category (owner only).' })
  createService(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('pscId', ParseUUIDPipe) pscId: string,
    @Body() dto: CreateProfessionalServiceDto,
  ): Promise<ProfessionalServiceResponseDto> {
    return this.providerServicesService.createService(
      user.sub,
      providerId,
      pscId,
      dto,
    );
  }
}

/**
 * Handles flat service listing and management under
 * /service-providers/:providerId/services[/:serviceId].
 */
@ApiTags('provider-services')
@Controller('service-providers/:providerId/services')
export class ProviderServicesController {
  constructor(private readonly providerServicesService: ProviderServicesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'List bookable services for a provider (public). ' +
      'Only returns services where category is VERIFIED/NOT_REQUIRED and everything is active.',
  })
  listPublicServices(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ): Promise<ProfessionalServiceResponseDto[]> {
    return this.providerServicesService.listPublicServices(providerId);
  }

  @Get('owner')
  @ApiOperation({ summary: 'List all services for a provider (owner view — includes PENDING).' })
  listOwnerServices(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ): Promise<ProfessionalServiceResponseDto[]> {
    return this.providerServicesService.listOwnerServices(user.sub, providerId);
  }

  @Patch(':serviceId')
  @ApiOperation({ summary: 'Update a service offering (owner only, immutable fields excluded).' })
  updateService(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateProfessionalServiceDto,
  ): Promise<ProfessionalServiceResponseDto> {
    return this.providerServicesService.updateService(
      user.sub,
      providerId,
      serviceId,
      dto,
    );
  }

  @Delete(':serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a service offering (owner only).' })
  deleteService(
    @CurrentUser() user: JwtPayload,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<void> {
    return this.providerServicesService.deleteService(
      user.sub,
      providerId,
      serviceId,
    );
  }
}
