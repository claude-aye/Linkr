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
import { CreateServiceProviderDto } from './dto/create-service-provider.dto';
import { UpdateServiceProviderDto } from './dto/update-service-provider.dto';
import { ServiceProviderResponseDto } from './dto/service-provider-response.dto';
import { ServiceProvidersService } from './service-providers.service';

@ApiTags('service-providers')
@Controller('service-providers')
export class ServiceProvidersController {
  constructor(private readonly providersService: ServiceProvidersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a service provider (polymorphic). INDIVIDUAL derives user_id from JWT; ORGANIZATION requires organizationId and active OWNER role. GeoJSON Point coordinates are [lng, lat].',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.createProvider(user.sub, dto);
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Public provider profile; geo returned as GeoJSON, business_name resolved.',
  })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.getPublicById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update editable provider fields (owner only).' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceProviderDto,
  ): Promise<ServiceProviderResponseDto> {
    return this.providersService.updateProvider(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a provider (owner only).' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.providersService.deleteProvider(user.sub, id);
  }
}
