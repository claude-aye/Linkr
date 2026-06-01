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
import { CreateServiceZoneDto } from './dto/create-service-zone.dto';
import { UpdateServiceZoneDto } from './dto/update-service-zone.dto';
import { ServiceZoneResponseDto } from './dto/service-zone-response.dto';
import { ServiceProvidersService } from './service-providers.service';

@ApiTags('service-providers')
@Controller('service-providers/:id/zones')
export class ServiceZonesController {
  constructor(private readonly providersService: ServiceProvidersService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a named service zone (owner only). GeoJSON Polygon coordinates are [lng, lat]; rings must be closed.',
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) providerId: string,
    @Body() dto: CreateServiceZoneDto,
  ): Promise<ServiceZoneResponseDto> {
    return this.providersService.createZone(user.sub, providerId, dto);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List a provider service zones (GeoJSON polygons).' })
  list(
    @Param('id', ParseUUIDPipe) providerId: string,
  ): Promise<ServiceZoneResponseDto[]> {
    return this.providersService.listZones(providerId);
  }

  @Patch(':zoneId')
  @ApiOperation({ summary: 'Update a service zone (owner only).' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) providerId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: UpdateServiceZoneDto,
  ): Promise<ServiceZoneResponseDto> {
    return this.providersService.updateZone(user.sub, providerId, zoneId, dto);
  }

  @Delete(':zoneId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a service zone (owner only).' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) providerId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
  ): Promise<void> {
    return this.providersService.deleteZone(user.sub, providerId, zoneId);
  }
}
